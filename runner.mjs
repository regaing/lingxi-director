/**
 * 图执行引擎：拓扑排序 + 节点 handler + 状态推送。
 *
 * 设计要点：
 *  - 同一工作流同时只允许 1 个 run（防重复计费）
 *  - dryRun 只算不提交，返回将执行的节点与预估成本
 *  - single=true 只跑选中的那一个节点，输入复用上一次成功运行的输出（不重跑上游、不重复扣费）
 *  - logic.condition 走分支门：命中那条分支通电，没命中的分支下游整段跳过
 *  - 任一节点失败 → run 失败，并取消该 run 已创建的未终态任务（全额退款）
 */
import { randomUUID } from 'node:crypto';
import { readFile, copyFile } from 'node:fs/promises';
import path from 'node:path';
import {
  makeWorkDir, cleanDir, downloadTo, extractFrame, fitImage, concatVideos,
  probe, toDataUri, dataUriToFile, toLocalPath, saveThumb,
} from './lib/media-tools.mjs';

const TERMINAL = ['succeeded', 'failed', 'cancelled'];
/* 网关实际接受的画面比例（实测 2026-10-22）：adaptive 不在其中，且不传也会被拒 */
const VALID_RATIOS = ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'];
const DEFAULT_RATIO = '16:9';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** 秘塔单价（元/秒），见 plan 2.4.1 */
const PRICE = { '480p': 0.06, '512p': 0.06, '768P': 0.09, '1080p': 0.14, '2K': 0.15 };

/** 素材扩展名 → data URI 的 MIME。视频/音频绝不能拼成 image/*：网关按 MIME 校验，塞错就是 2013 */
const ASSET_DATA_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg',
};

function topoSort(nodes, edges) {
  const ids = new Set(nodes.map((n) => n.id));
  const indeg = new Map(nodes.map((n) => [n.id, 0]));
  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) {
    if (!ids.has(e.source) || !ids.has(e.target)) continue;
    adj.get(e.source).push(e.target);
    indeg.set(e.target, indeg.get(e.target) + 1);
  }
  const q = nodes.filter((n) => indeg.get(n.id) === 0).map((n) => n.id);
  const order = [];
  while (q.length) {
    const id = q.shift();
    order.push(id);
    for (const nx of adj.get(id)) {
      indeg.set(nx, indeg.get(nx) - 1);
      if (indeg.get(nx) === 0) q.push(nx);
    }
  }
  if (order.length !== nodes.length) throw new Error('图中存在环，无法执行');
  return order;
}

/** 取目标节点 + 全部上游依赖 */
function upstreamClosure(nodes, edges, nodeIds) {
  if (!nodeIds || !nodeIds.length) return new Set(nodes.map((n) => n.id));
  const byTarget = new Map();
  for (const e of edges) {
    if (!byTarget.has(e.target)) byTarget.set(e.target, []);
    byTarget.get(e.target).push(e.source);
  }
  const keep = new Set();
  const walk = (id) => {
    if (keep.has(id)) return;
    keep.add(id);
    for (const s of byTarget.get(id) || []) walk(s);
  };
  nodeIds.forEach(walk);
  return keep;
}

/**
 * 文本端口 → 一条 content。
 * 平台没有独立负向词字段：负向词必须并进同一条 text 且放末尾（AGENTS.md 硬约定），
 * 所以按 __negative 拆两段，正文在前、负向词在后。
 */
function joinTexts(list) {
  const items = (list || [])
    .map((v) => (typeof v === 'string' ? { text: v } : v))
    .filter((v) => v && typeof v.text === 'string' && v.text.trim());
  const body = items.filter((v) => !v.__negative).map((v) => v.text.trim()).join('\n\n');
  const neg = items.filter((v) => v.__negative).map((v) => v.text.trim()).join(', ');
  return [body, neg].filter(Boolean).join('\n\n');
}

/** 解析 text.vars 的多行配置：每行 key=value，空行和没有等号的忽略 */
function parseVarPairs(raw) {
  const map = {};
  String(raw || '').split('\n').forEach((line) => {
    const i = line.indexOf('=');
    if (i <= 0) return;
    const key = line.slice(0, i).trim();
    const value = line.slice(i + 1).trim();
    if (key) map[key] = value;
  });
  return map;
}

export function createRunner({ gateway, unwrap, saveMedia, HttpError, sse, assetsDir, downloadDir, thumbsDir, notifications, runsStore }) {
  const runs = new Map();      // runId -> run 状态
  const activeByWf = new Map(); // wfId -> runId
  /** wfId -> Map(nodeId -> 上次成功输出)：单步运行拿它当上游输入，不重跑、不重复扣费 */
  const outputsByWf = new Map();

  /**
   * 把视频来源统一变成「本地可读文件」：
   *  - /downloads/xxx（拼接/下载产物）→ 直接从 downloads 目录复制，不走网络
   *  - http(s) 网关签名链接 → 下载到临时目录
   *  - 其它 → 当成已经是本地路径
   * ffmpeg 只认文件路径，这三种来源必须先归一。
   */
  async function localMedia(url, dir, ctx) {
    const s = String(url ?? '');
    if (s.startsWith('/downloads/')) {
      const name = decodeURIComponent(s.slice('/downloads/'.length));
      const src = path.join(ctx.downloadDir || downloadDir || 'downloads', name);
      const dst = path.join(dir, path.basename(name));
      await copyFile(src, dst);
      return dst;
    }
    if (/^https?:\/\//i.test(s)) {
      const ext = path.extname(new URL(s).pathname) || '.mp4';
      return downloadTo(s, path.join(dir, `src${ext}`));
    }
    return toLocalPath(s);
  }

  function notify(payload) {
    try { notifications?.add(payload); } catch { /* 通知写失败不能影响运行 */ }
  }

  /**
   * 给工作流卡片留一张缩略图（产物首帧）。
   * 优先本地已落盘的文件（output.download / video.concat 都在 downloads/），
   * 其次才用 CDN 链接——签名会过期，所以只在 run 成功那一刻抽一次。
   * **失败必须静默**：缩略图不该让一次成功的运行变成失败。
   */
  async function makeThumb(run) {
    if (!thumbsDir || run.dryRun) return;
    const outs = Object.values(run.outputs || {}).filter((o) => o && typeof o === 'object');
    let source = null;
    // 1) 本地文件（downloads/ 下）
    for (const o of outs) {
      const f = o.file;
      if (typeof f === 'string' && f && !f.startsWith('dryrun') && downloadDir) {
        source = path.join(downloadDir, f);
        break;
      }
    }
    // 2) 远端链接或 /downloads/ 引用
    if (!source) {
      for (const o of outs) {
        const u = o.video_url;
        if (typeof u === 'string' && (/^https?:/i.test(u) || u.startsWith('/downloads/'))) { source = u; break; }
      }
    }
    if (!source) return;
    await saveThumb(source, path.join(thumbsDir, `${run.wfId}.jpg`));
  }

  /**
   * 落库快照：run.nodes 里混着网关原始 task（体积大），落库前裁成状态 + 耗时。
   * 落库失败绝不能影响运行本身。
   */
  function persist(run) {
    if (!runsStore) return;
    try {
      runsStore.save({
        ...run,
        nodes: Object.fromEntries(Object.entries(run.nodes || {}).map(([k, v]) => [k, {
          status: v.status,
          error: v.error,
          ms: v.ms,
          taskStatus: v.task?.status,
        }])),
      });
    } catch { /* 落库失败不影响运行 */ }
  }

  /** 记住本次输出：全量运行覆盖，单步运行合并（保留其它节点的旧结果） */
  function rememberOutputs(run, outputs) {
    const prev = outputsByWf.get(run.wfId) || new Map();
    outputsByWf.set(run.wfId, run.single ? new Map([...prev, ...outputs]) : new Map(outputs));
  }

  async function assetUrl(file) {
    if (!file) return null;
    const full = path.join(assetsDir, path.basename(file));
    const buf = await readFile(full);
    const ext = path.extname(full).slice(1).toLowerCase();
    const mime = ASSET_DATA_MIME[ext] || 'application/octet-stream';
    return `data:${mime};base64,${buf.toString('base64')}`;
  }


  /* ── 节点 handler 注册表：新增节点类型只改这里 ── */
  const HANDLERS = {
    'text.prompt': ({ node }) => ({ text: String(node.data?.text || '') }),
    // __negative 标记一路带到 gen.*，由它们统一「并进同一条 text、放末尾」
    'text.negative': ({ node }) => ({ text: String(node.data?.text || ''), __negative: true }),

    /* 文本合并：把多条文本按分隔符拼成一条，不依赖 gen.* 的隐式拼接 */
    'text.merge': ({ node, inputs }) => {
      const parts = (inputs.text || [])
        .map((v) => (typeof v === 'string' ? v : v?.text))
        .map((s) => (typeof s === 'string' ? s.trim() : ''))
        .filter(Boolean);
      return { text: parts.join(String(node.data?.separator ?? '\n\n')) };
    },

    /* 文本变量：把 {{占位符}} 换成配置里的值；没配到的原样保留，不静默吞掉 */
    'text.vars': ({ node, inputs }) => {
      const body = (inputs.text || [])
        .map((v) => (typeof v === 'string' ? v : v?.text))
        .filter((s) => typeof s === 'string' && s.trim())
        .join('\n\n');
      const map = parseVarPairs(node.data?.vars);
      const text = body.replace(/\{\{\s*([\w.-]+)\s*\}\}/g, (whole, key) => (key in map ? map[key] : whole));
      return { text };
    },
    'media.image': async ({ node }) => ({
      image: await Promise.all(
        (node.data?.assets || []).map(async (a) => ({
          role: node.data?.role || 'reference_image',
          dataUrl: await assetUrl(a.asset ?? a.name),
        }))
      ),
    }),
    'media.video': async ({ node }) => ({
      video: await Promise.all((node.data?.assets || []).map(async (a) => ({ dataUrl: await assetUrl(a.asset ?? a.name) }))),
    }),
    'media.audio': async ({ node }) => ({
      audio: await Promise.all((node.data?.assets || []).map(async (a) => ({ dataUrl: await assetUrl(a.asset ?? a.name) }))),
    }),

    'param.video': ({ node }) => ({
      duration: Number(node.data?.duration),
      resolution: node.data?.resolution,
      ratio: node.data?.ratio,
      watermark: node.data?.watermark ?? '',
    }),

    'task.source': ({ node }) => ({ task_id: String(node.data?.taskId || '') }),

    /* 条件分支门：命中 pass 那条线通电，另一条的整段下游会被跳过 */
    'logic.condition': ({ node, inputs }) => {
      const raw = (inputs.value || [])
        .map((v) => (typeof v === 'string' ? v : v?.text ?? v?.status ?? ''))
        .filter((v) => v !== undefined && v !== null)
        .join(' ')
        .trim();
      const op = String(node.data?.op || 'notEmpty');
      const target = String(node.data?.compare ?? '');
      const num = Number(node.data?.number ?? 0);
      let pass;
      switch (op) {
        case 'empty': pass = raw === ''; break;
        case 'contains': pass = target !== '' && raw.includes(target); break;
        case 'notContains': pass = target === '' || !raw.includes(target); break;
        case 'equals': pass = raw === target; break;
        case 'notEquals': pass = raw !== target; break;
        case 'gt': pass = Number(raw) > num; break;
        case 'gte': pass = Number(raw) >= num; break;
        case 'lt': pass = Number(raw) < num; break;
        case 'lte': pass = Number(raw) <= num; break;
        case 'notEmpty':
        default: pass = raw !== ''; break;
      }
      return { value: raw, bool: pass, __branch: pass ? 'pass' : 'fail' };
    },

    'gen.video': async ({ node, inputs }, ctx) => {
      const duration = inputs.duration?.[0];
      const resolution = inputs.resolution?.[0];
      if (resolution == null) throw new Error('缺少 resolution（请连一个视频参数节点）');
      if (duration == null) throw new Error('缺少 duration（请连一个视频参数节点）');

      const text = joinTexts(inputs.text);
      if (!text) throw new Error('content 至少需要 1 个非空 text');

      const content = [{ type: 'text', text }];
      for (const img of inputs.image || []) {
        content.push({ type: 'image_url', role: img.role, image_url: { url: img.dataUrl } });
      }
      for (const v of inputs.video || []) content.push({ type: 'video_url', role: 'reference_video', video_url: { url: v.dataUrl } });
      for (const a of inputs.audio || []) content.push({ type: 'audio_url', role: 'reference_audio', audio_url: { url: a.dataUrl } });

      const body = { model: 'MiniMax-H3', content, duration: Number(duration), resolution: String(resolution) };
      // ratio 必须显式给：实测网关既不接受 adaptive，也不接受“不传”（两者都回 2013）。
      // 老图里可能还留着 adaptive，这里做白名单兜底，别让一个过期字段把整次运行搞挂。
      const rawRatio = String(inputs.ratio?.[0] ?? '');
      body.ratio = VALID_RATIOS.includes(rawRatio) ? rawRatio : DEFAULT_RATIO;
      const wm = inputs.watermark?.[0];
      if (wm === true || wm === 'true') body.aigc_watermark = true;
      else if (wm === false || wm === 'false') body.aigc_watermark = false;

      if (ctx.dryRun) return { task_id: `dryrun_${node.id}` };
      const { status, data } = await ctx.gateway('/v2/video_generation', { method: 'POST', body });
      return { task_id: ctx.unwrap({ status, data }).task_id };
    },

    'gen.context': async ({ node, inputs }, ctx) => {
      const text = joinTexts(inputs.text);
      if (!text) throw new Error('content 至少需要 1 个非空 text');
      // MINIMAX-H3-API.md 第 42 行：h3_context_ir 只接受 text，塞图片/duration 会被 400
      const body = { model: 'MiniMax-H3', content: [{ type: 'text', text }] };
      if (ctx.dryRun) return { task_id: `dryrun_${node.id}` };
      const { status, data } = await ctx.gateway('/v2/h3_context_ir', { method: 'POST', body });
      return { task_id: ctx.unwrap({ status, data }).task_id };
    },

    'gen.regen': async ({ node, inputs }, ctx) => {
      const source = inputs.task_id?.[0];
      const text = joinTexts(inputs.text);
      // 恰好一个：source_task_id 与 content 互斥
      if (source && text) throw new Error('source_task_id 与 content 只能二选一');
      if (!source && !text) throw new Error('需要 source_task_id 或 content 之一');
      const body = { model: 'MiniMax-H3' };
      if (source) body.source_task_id = String(source);
      else body.content = [{ type: 'text', text }];
      if (ctx.dryRun) return { task_id: `dryrun_${node.id}` };
      const { status, data } = await ctx.gateway('/v2/video_regeneration', { method: 'POST', body });
      return { task_id: ctx.unwrap({ status, data }).task_id };
    },

    'task.watch': async ({ node, inputs }, ctx) => {
      const taskId = inputs.task_id?.[0];
      if (!taskId) throw new Error('缺少 task_id');
      if (ctx.dryRun) return { status: 'succeeded', video_url: `dryrun://${taskId}`, task_id: taskId };

      // pollMs 字段现为「秒」（默认 4）；旧图存的是毫秒（4000），>120 视为旧值
      const rawPoll = Number(node.data?.pollMs);
      const pollSec = !rawPoll || rawPoll <= 0 ? 4 : rawPoll > 120 ? rawPoll / 1000 : rawPoll;
      const timeoutMin = Math.max(1, Number(node.data?.timeoutMin) || 45);
      const deadline = Date.now() + timeoutMin * 60 * 1000;
      while (Date.now() < deadline) {
        const { status, data } = await ctx.gateway(`/v2/query/video_generation/${encodeURIComponent(taskId)}`);
        const payload = ctx.unwrap({ status, data });
        const task = payload.task || payload;
        ctx.progress(node.id, task.status, task);
        if (TERMINAL.includes(task.status)) {
          if (task.status !== 'succeeded') {
            const e = task.error || {};
            throw new Error(`上游任务 ${task.status}：${e.code || ''} ${e.message || ''}`.trim());
          }
          return { status: task.status, video_url: task.content?.url, task_id: taskId, task };
        }
        await sleep(pollSec * 1000);
      }
      throw new Error(`等待超时（${timeoutMin} 分钟）`);
    },

    /* ── 媒体处理：抽帧 / 加边 / 拼接 / 探针 ── */
    'video.frame': async ({ node, inputs }, ctx) => {
      const url = inputs.video_url?.[0];
      if (!url) throw new Error('缺少 video_url');
      const role = node.data?.role || 'first_frame';
      if (ctx.dryRun) return { image: [{ role, dataUrl: 'dryrun://frame' }] };
      const dir = await makeWorkDir('vframe');
      try {
        const file = await localMedia(url, dir, ctx);
        const buf = await extractFrame(file, {
          position: node.data?.position || 'last',
          atSec: Number(node.data?.atSec) || 0,
          quality: Number(node.data?.quality) || 3,
        });
        return { image: [{ role, dataUrl: toDataUri(buf, 'image/jpeg') }] };
      } finally {
        await cleanDir(dir);
      }
    },

    'image.fit': async ({ node, inputs }, ctx) => {
      const imgs = (inputs.image || []).filter(Boolean);
      if (!imgs.length) throw new Error('缺少图片输入');
      const out = [];
      for (const img of imgs) {
        const dataUrl = typeof img === 'string' ? img : img?.dataUrl;
        if (!dataUrl) continue;
        const role = (typeof img === 'object' && img.role) || 'reference_image';
        if (ctx.dryRun) { out.push({ role, dataUrl }); continue; }
        const mime = (/^data:([^;,]+)/.exec(dataUrl) || [])[1] || 'image/png';
        const dir = await makeWorkDir('fit');
        try {
          const file = await dataUriToFile(dataUrl, path.join(dir, 'in.img'));
          const r = await fitImage(file, { color: node.data?.color || 'black' });
          // 没被改动的图原样返回，避免无谓重编码掉画质
          out.push({ role, dataUrl: r.padded ? toDataUri(r.buffer, 'image/png') : dataUrl });
        } finally {
          await cleanDir(dir);
        }
      }
      if (!out.length) throw new Error('图片输入为空');
      return { image: out };
    },

    'video.info': async ({ inputs }, ctx) => {
      const url = inputs.video_url?.[0];
      if (!url) throw new Error('缺少 video_url');
      if (ctx.dryRun) return { duration: 0, resolution: '', size: 0 };
      const dir = await makeWorkDir('vinfo');
      try {
        const file = await localMedia(url, dir, ctx);
        const info = await probe(file);
        return {
          duration: Math.round(info.duration * 100) / 100,
          resolution: `${info.width}x${info.height}`,
          size: info.size,
        };
      } finally {
        await cleanDir(dir);
      }
    },

    'video.concat': async ({ node, inputs }, ctx) => {
      const urls = (inputs.video_url || []).filter(Boolean);
      if (!urls.length) throw new Error('缺少 video_url');
      if (ctx.dryRun) return { video_url: 'dryrun://joined', file: 'dryrun_joined.mp4' };
      // 只有一段就没必要重封装，直接透传
      if (urls.length === 1) return { video_url: urls[0], file: null };
      const prefix = String(node.data?.namePrefix || 'joined').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'joined';
      const filename = `${prefix}_${Date.now()}.mp4`;
      await concatVideos(urls, path.join(ctx.downloadDir || downloadDir, filename));
      return { video_url: `/downloads/${encodeURIComponent(filename)}`, file: filename };
    },

    'output.preview': ({ inputs }) => ({ video_url: inputs.video_url?.[0] || null }),

    'output.download': async ({ node, inputs }, ctx) => {
      const url = inputs.video_url?.[0];
      if (!url) throw new Error('缺少 video_url');
      if (ctx.dryRun) return { file: `dryrun_${node.id}.mp4` };
      // 拼接节点的产物已经在 downloads 里了，再抓一次只会存两份
      if (String(url).startsWith('/downloads/')) {
        return { file: decodeURIComponent(String(url).slice('/downloads/'.length)) };
      }
      const saved = await ctx.saveMedia(url, node.data?.namePrefix || node.data?.name || 'video');
      return { file: saved.file || saved.path || saved.name };
    },
  };

  function estimateCost(nodes) {
    let cost = 0;
    let counted = 0;
    for (const n of nodes) {
      if (!n.type?.startsWith('gen.')) continue;
      const d = Number(n.__duration ?? 0);
      if (!d) continue;
      // 按该节点实际的分辨率计价，不能统一套 768P
      const res = n.__resolution || '768P';
      cost += d * (PRICE[res] ?? PRICE['768P']);
      counted += 1;
    }
    // 没接参数节点时按 15 秒 768P 给保守上界
    if (!counted) cost = 15 * PRICE['768P'];
    return Math.round(cost * 100) / 100;
  }

  /** 起一个 run（异步执行，状态走 SSE） */
  async function start({ wfId, graph, nodeIds = null, dryRun = false, single = false }) {
    if (activeByWf.has(wfId)) {
      throw new HttpError(409, `工作流 ${wfId} 已有运行中的任务（${activeByWf.get(wfId)}），请等待或先取消`);
    }

    const nodes = graph.nodes || [];
    const edges = graph.edges || [];
    if (!nodes.length) throw new HttpError(400, '图为空，没有可执行的节点');

    // 单步：只跑选中的那一个节点，上游输入取上次成功运行的缓存
    let keep;
    let seed = null;
    let order = null;
    if (single) {
      if (!nodeIds || nodeIds.length !== 1) throw new HttpError(400, '单步运行需要且只能传 1 个 nodeId');
      const targetId = nodeIds[0];
      if (!nodes.some((n) => n.id === targetId)) throw new HttpError(404, `节点不存在：${targetId}`);
      const upstreamIds = edges.filter((e) => e.target === targetId).map((e) => e.source);
      const cached = outputsByWf.get(wfId);
      const missing = upstreamIds.filter((sid) => !cached?.has(sid));
      if (missing.length) {
        throw new HttpError(409, `单步运行缺少上游结果（${missing.join(', ')}）：请先整体运行一次，或改用「运行到此处」`);
      }
      keep = new Set([targetId, ...upstreamIds]);
      seed = new Map(upstreamIds.map((sid) => [sid, cached.get(sid)]));
      order = [targetId];
    } else {
      keep = upstreamClosure(nodes, edges, nodeIds);
    }

    const byId = new Map(nodes.map((n) => [n.id, n]));
    const subNodes = nodes.filter((n) => keep.has(n.id));
    const subEdges = edges.filter((e) => keep.has(e.source) && keep.has(e.target));
    if (!order) order = topoSort(subNodes, subEdges); // 有环直接抛

    // 给成本估算补上 duration / resolution（只看真正要跑的节点）
    const execNodes = order.map((id) => byId.get(id)).filter(Boolean);
    for (const n of execNodes) {
      if (!n.type?.startsWith('gen.')) continue;
      const p = subEdges.filter((e) => e.target === n.id && e.targetHandle === 'duration')
        .map((e) => byId.get(e.source)).find(Boolean);
      n.__duration = p?.data?.duration;
      n.__resolution = p?.data?.resolution;
    }

    const run = {
      id: `run_${randomUUID().slice(0, 8)}`,
      wfId,
      dryRun,
      single,
      status: 'running',
      startedAt: new Date().toISOString(),
      nodes: {},
      outputs: {},
      order,
      error: null,
    };

    if (dryRun) {
      run.status = 'dryrun';
      run.plan = order.map((id) => ({ id, type: byId.get(id)?.type }));
      run.estimate = estimateCost(execNodes);
      const genCount = execNodes.filter((n) => n.type?.startsWith('gen.')).length;
      run.summary = `将执行 ${order.length} 个节点，其中 ${genCount} 个会产生计费，预估 ≈ ${run.estimate} 元`;
      return run;
    }

    runs.set(run.id, run);
    activeByWf.set(wfId, run.id);
    runLoop(run, { byId, subEdges, order, seed }).catch(() => { /* 已在内部处理 */ });
    return run;
  }

  async function runLoop(run, { byId, subEdges, order, seed }) {
    sse.push(run.id, 'run:start', { runId: run.id, order, at: new Date().toISOString() });
    persist(run); // 先落一条 running，刷新时也能看到「正在跑」
    const outputs = new Map(seed || []);
    /** 被条件分支掐断的连线：下游既拿不到输入，也不该被执行 */
    const deadEdges = new Set();

    const ctx = {
      dryRun: false,
      gateway,
      unwrap,
      saveMedia,
      progress: (nodeId, status, task) => {
        // task.watch 轮询心跳：保留已记的 ms，避免心跳把耗时冲掉
        const ms = run.nodes[nodeId]?.ms;
        run.nodes[nodeId] = { status, task, ms };
        sse.push(run.id, 'run:node', { runId: run.id, nodeId, status, task, ms, at: new Date().toISOString() });
      },
    };

    try {
      for (const id of order) {
        const node = byId.get(id);
        const handler = HANDLERS[node.type];
        const t0 = Date.now();
        const elapsed = () => Date.now() - t0;
        if (!handler) {
          run.nodes[id] = { status: 'skipped', ms: 0 };
          sse.push(run.id, 'run:node', { runId: run.id, nodeId: id, status: 'skipped', ms: 0, reason: `无 handler：${node.type}` });
          persist(run);
          continue;
        }

        const inEdges = subEdges.filter((e) => e.target === id);
        // 入边全被条件分支掐断 → 整段跳过，并把跳过状态继续往下游传
        if (inEdges.length && inEdges.every((e) => deadEdges.has(e.id))) {
          run.nodes[id] = { status: 'skipped', ms: 0, reason: 'branch' };
          sse.push(run.id, 'run:node', { runId: run.id, nodeId: id, status: 'skipped', ms: 0, reason: 'branch' });
          for (const e of subEdges) if (e.source === id) deadEdges.add(e.id);
          persist(run);
          continue;
        }
        // 收集入参（跳过被掐断的连线）
        const inputs = {};
        for (const e of inEdges) {
          if (deadEdges.has(e.id)) continue;
          const src = outputs.get(e.source) || {};
          const v = src[e.sourceHandle];
          if (v === undefined || v === null) continue;
          const list = inputs[e.targetHandle] || (inputs[e.targetHandle] = []);
          if (Array.isArray(v)) list.push(...v);
          else list.push(v);
        }

        run.nodes[id] = { status: 'running' };
        sse.push(run.id, 'run:node', { runId: run.id, nodeId: id, status: 'running', ms: 0, at: new Date().toISOString() });
        persist(run);

        let out;
        try {
          out = await handler({ node, inputs }, ctx);
        } catch (nodeErr) {
          // 把失败钉在具体节点上，否则画布上会一直停在 running
          run.nodes[id] = { status: 'error', error: nodeErr.message, ms: elapsed() };
          sse.push(run.id, 'run:node', { runId: run.id, nodeId: id, status: 'error', error: nodeErr.message, ms: elapsed() });
          throw nodeErr;
        }
        outputs.set(id, out || {});
        run.outputs[id] = out;

        // 条件门：没命中的那条出边整体断电
        if (out && out.__branch) {
          for (const e of subEdges) {
            if (e.source === id && e.sourceHandle !== out.__branch) deadEdges.add(e.id);
          }
        }

        run.nodes[id] = { status: 'success', ms: elapsed() };
        sse.push(run.id, 'run:node', { runId: run.id, nodeId: id, status: 'success', output: out, ms: elapsed() });
        persist(run);
      }

      run.status = 'succeeded';
      rememberOutputs(run, outputs);
      notify({ kind: 'run.succeeded', level: 'success', wfId: run.wfId, body: `${run.id} · ${order.length} 个节点` });
      sse.push(run.id, 'run:done', { runId: run.id, status: 'succeeded', outputs: run.outputs });
      // 卡片缩略图：不 await——抽帧要读视频（远端链接还得拉数据），
      // 不该让已经成功的运行多等几秒。失败只记日志。
      makeThumb(run).catch((err) => console.warn(`[thumb] ${run.wfId}: ${err.message}`));
    } catch (err) {
      run.status = 'failed';
      run.error = err.message || String(err);
      notify({ kind: 'run.failed', level: 'error', wfId: run.wfId, body: `${run.id} · ${run.error}` });
      sse.push(run.id, 'run:done', { runId: run.id, status: 'failed', error: run.error });
      // 清理未终态的网关任务（failed/cancelled 全额退款）
      for (const [nodeId, out] of Object.entries(run.outputs)) {
        const taskId = out?.task_id;
        if (!taskId || String(taskId).startsWith('dryrun')) continue;
        try { await gateway(`/v2/video_generation/${encodeURIComponent(taskId)}`, { method: 'DELETE' }); } catch { /* ignore */ }
        sse.push(run.id, 'run:node', { runId: run.id, nodeId, status: 'cancelled', reason: 'run 失败，已取消并退款' });
      }
    } finally {
      run.endedAt = new Date().toISOString();
      activeByWf.delete(run.wfId);
      persist(run); // 终态（含 outputs）落库：刷新/重启后仍可回看结果
    }
  }

  function get(id) {
    const run = runs.get(id);
    if (!run) throw new HttpError(404, `run 不存在：${id}`);
    return run;
  }

  async function cancel(id) {
    const run = get(id);
    for (const out of Object.values(run.outputs)) {
      const taskId = out?.task_id;
      if (!taskId || String(taskId).startsWith('dryrun')) continue;
      try { await gateway(`/v2/video_generation/${encodeURIComponent(taskId)}`, { method: 'DELETE' }); } catch { /* ignore */ }
    }
    run.status = 'cancelled';
    run.endedAt = new Date().toISOString();
    activeByWf.delete(run.wfId);
    persist(run);
    sse.push(id, 'run:done', { runId: id, status: 'cancelled' });
    return run;
  }

  return { start, get, cancel, attachSse: (req, res, id, lastEventId) => sse.attach(req, res, id, lastEventId) };
}
