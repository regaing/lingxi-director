#!/usr/bin/env node
/**
 * 视频工作台后端 —— MiniMax-H3 网关的本地薄代理。
 *
 * 职责：
 *   - 静态托管 public/（工作台页面）
 *   - 代理网关接口（Token 只存在本地，绝不下发到浏览器之外的第三方）
 *   - 把生成好的产物下载到 downloads/ 落盘
 *
 * 不做的事：不缓存任务、不做队列、不做业务校验之外的改写（校验以网关为准）。
 */
import { createServer } from 'node:http';
import { createWriteStream } from 'node:fs';
import { mkdir, readFile, writeFile, stat } from 'node:fs/promises';

import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { createWorkflowStore } from './lib/workflows.mjs';
import { createSse } from './lib/sse.mjs';
import { createRunner } from './runner.mjs';
import { createLlm } from './lib/llm.mjs';
import { openDb } from './lib/db.mjs';
import { createNotificationStore } from './lib/notifications.mjs';
import { createRunStore } from './lib/runs.mjs';
import { completeGraph } from './lib/graph-complete.mjs';
import { packBundle, unpackBundle, importBundle, safeFileName } from './lib/bundle.mjs';
import { listTemplates, instantiateTemplate, readTemplateCover, isValidTemplateId } from './lib/templates.mjs';

const ROOT = path.dirname(fileURLToPath(import.meta.url));
const PUBLIC_DIR = path.join(ROOT, 'public');
const DOWNLOAD_DIR = path.join(ROOT, 'downloads');
const CONFIG_FILE = path.join(ROOT, 'config.json');
const ASSETS_DIR = path.join(ROOT, 'assets');
const TEMPLATES_DIR = path.join(ROOT, 'templates');
const DATA_DIR = path.join(ROOT, 'data');
const DB_FILE = path.join(DATA_DIR, 'workbench.db');
/** 工作流卡片缩略图（产物首帧），文件名 <wfId>.jpg */
const THUMBS_DIR = path.join(DATA_DIR, 'thumbs');

const API_BASE_DEFAULT = (process.env.MINIMAX_BASE_URL || 'https://metaso.cn/api/minimax').replace(/\/+$/, '');

/** 网关地址优先级：config.json 的 baseUrl > 环境变量 MINIMAX_BASE_URL > 内置默认 */
async function getApiBase() {
  const cfg = await readConfig();
  return String(cfg.baseUrl || API_BASE_DEFAULT).replace(/\/+$/, '');
}
const MODEL = 'MiniMax-H3';
const PORT = Number(process.env.PORT || 8070);
const MAX_BODY = 200 * 1024 * 1024; // 参考视频走 base64 data URI，body 会很大

/** 创建任务类型 → 网关路径 */
const CREATE_ROUTES = {
  generation: '/v2/video_generation',
  context_ir: '/v2/h3_context_ir',
  regeneration: '/v2/video_regeneration',
};

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'application/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.mp4': 'video/mp4',
  '.webm': 'video/webm',
  '.mp3': 'audio/mpeg',
};

/**
 * 素材（assets/）的 mime ↔ 扩展名：上传按 mime 定扩展名，读取按扩展名回 mime。
 * 两边必须成对，否则落成 .bin —— 浏览器不能预览、网关也不认这个素材。
 * 视频/音频也要在这张表里：它们的后缀就是前端判断「能否用 <img> 出画面」的依据。
 */
const ASSET_MIME_TO_EXT = {
  'image/png': 'png', 'image/jpeg': 'jpg', 'image/webp': 'webp', 'image/gif': 'gif', 'image/avif': 'avif',
  'video/mp4': 'mp4', 'video/webm': 'webm', 'video/quicktime': 'mov',
  'audio/mpeg': 'mp3', 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/mp4': 'm4a', 'audio/ogg': 'ogg',
};

const ASSET_EXT_TO_MIME = {
  png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', webp: 'image/webp', gif: 'image/gif', avif: 'image/avif',
  mp4: 'video/mp4', webm: 'video/webm', mov: 'video/quicktime',
  mp3: 'audio/mpeg', wav: 'audio/wav', m4a: 'audio/mp4', ogg: 'audio/ogg',
};

class HttpError extends Error {
  /** code 是给前端翻译用的错误码（如导入包的 badZip）；message 只当技术信息看 */
  constructor(status, message, code) {
    super(message);
    this.status = status;
    if (code) this.code = code;
  }
}

/** 只回显首尾各 4 位，避免把完整 key 发到浏览器 */
function maskSecret(s) {
  if (!s) return '';
  return s.length <= 8 ? '****' : s.slice(0, 4) + '****' + s.slice(-4);
}

/** 生成短且可读的工作流 id（时间戳 + 随机后缀，避免碰撞） */
function newWfId() {
  return 'wf_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 5);
}

/* ── 存储 + SSE 推送 + 运行器 ── */
const db = openDb(DB_FILE);
const sse = createSse();
const wfStore = createWorkflowStore({ db, HttpError });
const notifications = createNotificationStore({ db });
const runsStore = createRunStore({ db });
const llm = createLlm({ getConfig: readConfig, HttpError });
const runner = createRunner({
  gateway, unwrap, saveMedia, HttpError, sse, notifications, runsStore,
  assetsDir: ASSETS_DIR,
  downloadDir: DOWNLOAD_DIR,
  thumbsDir: THUMBS_DIR,
});

/** 图被改动后推 SSE：编辑器自己保存的标 origin=editor，前端据此不提示「外部改动」 */
function broadcastChange(id, graph, req, extra = {}) {
  const origin = req?.headers?.['x-wb-origin'] === 'editor' ? 'editor' : 'external';
  sse.push('workflows', 'wf:changed', {
    id, revision: graph?.revision ?? 0, name: graph?.name ?? '',
    updatedAt: graph?.updatedAt ?? '', origin, ...extra,
  });
}

/* ── 配置（Token 落盘在 config.json，已 gitignore） ── */

async function readConfig() {
  try {
    return JSON.parse(await readFile(CONFIG_FILE, 'utf8'));
  } catch {
    return {};
  }
}

async function getToken() {
  const token = (await readConfig()).token || process.env.MINIMAX_TOKEN || '';
  if (!token) throw new HttpError(401, '未配置 Token，请点右上角「设置」填写');
  return token;
}

/* ── 网关请求 ── */

async function gateway(pathname, { method = 'GET', body } = {}) {
  const token = await getToken();
  let res;
  try {
    res = await fetch((await getApiBase()) + pathname, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        ...(body ? { 'Content-Type': 'application/json' } : {}),
      },
      body: body ? JSON.stringify(body) : undefined,
    });
  } catch (err) {
    throw new HttpError(502, `无法连接网关：${err.message}`);
  }
  const raw = await res.text();
  let data;
  try {
    data = raw ? JSON.parse(raw) : {};
  } catch {
    data = { raw };
  }
  return { status: res.status, data };
}

/** 网关非 2xx 时把它翻译成本地错误，前端直接显示 message */
function unwrap({ status, data }, okStatuses = [200]) {
  if (okStatuses.includes(status)) return data;
  const message =
    data?.message || data?.error?.message || data?.error_code || JSON.stringify(data).slice(0, 400);
  throw new HttpError(status, message);
}

/* ── HTTP 工具 ── */

function sendJson(res, status, data) {
  const buf = Buffer.from(JSON.stringify(data));
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Content-Length': buf.length });
  res.end(buf);
}

function readBody(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, '请求体过大（上限 200MB）'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      const raw = Buffer.concat(chunks).toString('utf8');
      if (!raw) return resolve({});
      try {
        resolve(JSON.parse(raw));
      } catch {
        reject(new HttpError(400, '请求体不是合法 JSON'));
      }
    });
    req.on('error', reject);
  });
}

/** 二进制体（导入 .zip 用）：不走 JSON 解析 */
function readRaw(req) {
  return new Promise((resolve, reject) => {
    const chunks = [];
    let size = 0;
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(new HttpError(413, '请求体过大（上限 200MB）'));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => resolve(Buffer.concat(chunks)));
    req.on('error', reject);
  });
}

async function serveStatic(res, urlPath) {
  const isDownload = urlPath.startsWith('/downloads/');
  const baseDir = isDownload ? DOWNLOAD_DIR : PUBLIC_DIR;
  const rel = decodeURIComponent(isDownload ? urlPath.slice('/downloads/'.length) : urlPath === '/' ? 'index.html' : urlPath.slice(1));
  const filePath = path.resolve(baseDir, rel);

  if (!filePath.startsWith(baseDir + path.sep) && filePath !== path.resolve(baseDir, 'index.html')) {
    return sendJson(res, 403, { message: '禁止访问' });
  }

  let buf;
  try {
    buf = await readFile(filePath);
  } catch {
    return sendJson(res, 404, { message: '文件不存在' });
  }
  res.writeHead(200, {
    'Content-Type': MIME[path.extname(filePath).toLowerCase()] || 'application/octet-stream',
    'Content-Length': buf.length,
    'Cache-Control': 'no-store',
  });
  res.end(buf);
}

/* ── API ── */

async function handleApi(req, res, url) {
  const route = `${req.method} ${url.pathname}`;
  // ── 工作流图：CRUD + 语义化 patch（供画布与 AI 共用） ──
  // wfStore 是模块级单例（见文件顶部），供文件监听与路由共用

  if (url.pathname === '/api/workflows/events' && req.method === 'GET') {
    return sse.attach(req, res, 'workflows', req.headers['last-event-id']);
  }

  /* ── 分类：一部剧一个分类 ── */
  if (url.pathname === '/api/categories') {
    if (req.method === 'GET') return sendJson(res, 200, wfStore.listCategories());
    if (req.method === 'POST') return sendJson(res, 201, wfStore.createCategory(await readBody(req)));
  }

  if (url.pathname === '/api/categories/reorder' && req.method === 'POST') {
    const { ids } = await readBody(req);
    return sendJson(res, 200, wfStore.reorderCategories(ids));
  }

  const catMatch = url.pathname.match(/^\/api\/category\/([^/]+)$/);
  if (catMatch) {
    const cid = decodeURIComponent(catMatch[1]);
    if (req.method === 'PATCH' || req.method === 'PUT') return sendJson(res, 200, wfStore.updateCategory(cid, await readBody(req)));
    if (req.method === 'DELETE') return sendJson(res, 200, wfStore.removeCategory(cid));
  }

  // 列表：?categoryId=<id> 只出该分类；?categoryId=none 只出未分类
  if (url.pathname === '/api/workflows' && req.method === 'GET') {
    const categoryId = url.searchParams.has('categoryId')
      ? (url.searchParams.get('categoryId') || null)
      : undefined;
    const items = wfStore.list({ categoryId });
    // 缩略图（产物首帧）：有就带上，前端据此铺卡片背景；没有就退回色块
    for (const it of items) {
      try {
        await stat(path.join(THUMBS_DIR, `${it.id}.jpg`));
        it.thumb = `/api/workflows/${encodeURIComponent(it.id)}/thumb`;
      } catch { /* 没缩略图很正常（没跑过） */ }
    }
    return sendJson(res, 200, { items });
  }

  // 工作流卡片缩略图（产物首帧）。id 走 store 校验过的格式，basename 防穿越
  const thumbMatch = url.pathname.match(/^\/api\/workflows\/([^/]+)\/thumb$/);
  if (thumbMatch && req.method === 'GET') {
    const id = decodeURIComponent(thumbMatch[1]);
    if (!/^[\w.-]+$/.test(id) || id.includes('..')) throw new HttpError(404, '缩略图不存在', 'noThumb');
    let data;
    try {
      data = await readFile(path.join(THUMBS_DIR, `${id}.jpg`));
    } catch {
      throw new HttpError(404, '缩略图不存在', 'noThumb');
    }
    res.writeHead(200, { 'content-type': 'image/jpeg', 'cache-control': 'public, max-age=300' });
    return res.end(data);
  }

  // 新建空白工作流
  if (url.pathname === '/api/workflows' && req.method === 'POST') {
    const { name, categoryId, graph } = await readBody(req);
    const id = newWfId();
    const created = wfStore.put(id, {
      name: String(name || 'Untitled'),
      categoryId: categoryId || null,
      nodes: graph && graph.nodes ? graph.nodes : [],
      edges: graph && graph.edges ? graph.edges : [],
    });
    return sendJson(res, 201, created);
  }

  // 批量改归属（首页多选移动）
  if (url.pathname === '/api/workflows/move' && req.method === 'POST') {
    const { ids, categoryId } = await readBody(req);
    return sendJson(res, 200, wfStore.moveToCategory(ids, categoryId || null));
  }

  // 复制工作流（首页卡片菜单用）
  const dupMatch = url.pathname.match(/^\/api\/workflow\/([^/]+)\/duplicate$/);
  if (dupMatch && req.method === 'POST') {
    const src = await wfStore.get(decodeURIComponent(dupMatch[1]));
    const copy = wfStore.put(newWfId(), {
      nodes: src.nodes || [],
      edges: src.edges || [],
      name: (src.name || 'Untitled') + ' (copy)',
      categoryId: src.categoryId || null,
    });
    return sendJson(res, 201, copy);
  }

  const wfMatch = url.pathname.match(/^\/api\/workflow\/([^/]+)(\/patch|\/ai)?$/);
  if (wfMatch) {
    const id = decodeURIComponent(wfMatch[1]);
    const isPatch = wfMatch[2] === '/patch'; // 注意：不能写 Boolean(wfMatch[2])，否则 /ai 会被 patch 分支抢走
    if (isPatch && req.method === 'POST') {
      const { ops } = await readBody(req);
      if (!Array.isArray(ops)) throw new HttpError(400, 'ops 必须是数组');
      const updated = wfStore.patch(id, ops);
      broadcastChange(id, updated, req);
      return sendJson(res, 200, updated);
    }
    // ── AI 改图：一句自然语言 → ops → 校验 → 落盘 → 结构性补齐 ──
    if (wfMatch[2] === '/ai' && req.method === 'POST') {
      const { instruction, schema, dryRun = false } = await readBody(req);
      if (!instruction || !String(instruction).trim()) throw new HttpError(400, '缺少 instruction');
      const graph = await wfStore.get(id);
      const plan = await llm.planEdit({ graph, instruction: String(instruction).trim(), schema });

      // 干跑：只预览「会改什么 + 会补什么」，一个字都不写
      if (dryRun) {
        const preview = completeGraph({ nodes: graph.nodes, edges: graph.edges, schema });
        return sendJson(res, 200, { ...plan, applied: false, autoFill: preview.added, revision: graph.revision });
      }

      try {
        const applied = plan.ops.length ? wfStore.patch(id, plan.ops) : graph;
        // 模型只保证内容，可运行性由代码兜底：缺 watch / 出口 / 负向词就补上
        const fill = completeGraph({ nodes: applied.nodes, edges: applied.edges, schema });
        const final = fill.ops.length ? wfStore.patch(id, fill.ops) : applied;
        if (final !== graph) broadcastChange(id, final, req, { ai: true });
        return sendJson(res, 200, { ...plan, applied: final !== graph, autoFilled: fill.added, revision: final.revision });
      } catch (err) {
        // 模型给的 ops 不合法：把原因回给调用方，不要半途写坏图
        throw new HttpError(422, `AI 给出的修改未通过校验：${err.message}`);
      }
    }
    if (!wfMatch[2]) {
      if (req.method === 'GET') return sendJson(res, 200, await wfStore.get(id));
      if (req.method === 'PUT') {
        const body = await readBody(req);
        const ifMatch = req.headers['if-match'];
        const expectedRevision = ifMatch == null ? null : Number(ifMatch);
        const saved = wfStore.put(id, body, { expectedRevision });
        broadcastChange(id, saved, req);
        return sendJson(res, 200, saved);
      }
      if (req.method === 'DELETE') {
        const gone = wfStore.remove(id);
        sse.push('workflows', 'wf:changed', { id, revision: -1, deleted: true, origin: 'external' });
        return sendJson(res, 200, gone);
      }
    }
  }

  /* ── 通知中心：header 右侧铃铛 ── */
  if (url.pathname === '/api/notifications' && req.method === 'GET') {
    return sendJson(res, 200, notifications.list({ limit: Number(url.searchParams.get('limit')) || 50 }));
  }
  if (url.pathname === '/api/notifications' && req.method === 'POST') {
    return sendJson(res, 201, notifications.add(await readBody(req)));
  }
  if (url.pathname === '/api/notifications/read' && req.method === 'POST') {
    const { ids } = await readBody(req);
    return sendJson(res, 200, notifications.markRead(ids === 'all' ? 'all' : Array.isArray(ids) ? ids : null));
  }
  if (url.pathname === '/api/notifications' && req.method === 'DELETE') {
    const onlyRead = url.searchParams.get('onlyRead') === '1';
    return sendJson(res, 200, notifications.clear({ onlyRead }));
  }

  /* ── 提示词 AI 优化：只回文本，不碰图 ── */
  if (url.pathname === '/api/llm/optimize' && req.method === 'POST') {
    const { text, kind = 'prompt', context = '' } = await readBody(req);
    if (!String(text || '').trim()) throw new HttpError(400, '提示词为空，没什么可优化的');
    const result = await llm.optimizePrompt({ text: String(text), kind: String(kind), context: String(context || '') });
    return sendJson(res, 200, result);
  }

  // ── 工作流导出 / 导入（.zip：workflows.json + assets/ 真文件，不走 base64） ──
  if (url.pathname === '/api/export' && req.method === 'GET') {
    const wfId = url.searchParams.get('wfId');
    const cats = new Map(wfStore.listCategories().items.map((c) => [c.id, c.name]));
    let list;
    if (wfId) {
      const g = await wfStore.get(wfId);
      list = [{ name: g.name, category: cats.get(g.categoryId) || '', nodes: g.nodes, edges: g.edges }];
    } else {
      const all = wfStore.list();
      list = [];
      for (const it of all) {
        const g = await wfStore.get(it.id);
        list.push({ name: g.name, category: cats.get(g.categoryId) || '', nodes: g.nodes, edges: g.edges });
      }
    }
    if (!list.length) throw new HttpError(400, '没有可导出的工作流');
    const zip = await packBundle(list, ASSETS_DIR);
    const base = wfId ? safeFileName(list[0].name) : `lingxi-workflows-${new Date().toISOString().slice(0, 10)}`;
    const filename = `${base}.zip`;
    res.writeHead(200, {
      'content-type': 'application/zip',
      'content-length': zip.length,
      'content-disposition': `attachment; filename="${encodeURIComponent(filename)}"; filename*=UTF-8''${encodeURIComponent(filename)}`,
    });
    return res.end(zip);
  }

  if (url.pathname === '/api/import' && req.method === 'POST') {
    const buf = await readRaw(req);
    if (!buf.length) throw new HttpError(400, '请求体为空', 'badZip');
    let bundle;
    try {
      bundle = unpackBundle(buf);
    } catch (err) {
      throw new HttpError(400, err.message || '解包失败', err.code || 'badZip');
    }
    const result = await importBundle(bundle, { assetsDir: ASSETS_DIR, wfStore, newWfId });
    return sendJson(res, 200, result);
  }

  // ── 内置模板（templates/ 目录，一个模板 = 一个目录；实例化走 importBundle 复用落盘逻辑） ──
  if (url.pathname === '/api/templates' && req.method === 'GET') {
    return sendJson(res, 200, await listTemplates(TEMPLATES_DIR));
  }

  const tplCoverMatch = url.pathname.match(/^\/api\/templates\/([^/]+)\/cover$/);
  if (tplCoverMatch && req.method === 'GET') {
    const id = decodeURIComponent(tplCoverMatch[1]);
    if (!isValidTemplateId(id)) throw new HttpError(404, '模板不存在', 'noTemplate');
    const cover = await readTemplateCover(TEMPLATES_DIR, id);
    if (!cover) throw new HttpError(404, '没有封面', 'noCover');
    res.writeHead(200, { 'content-type': cover.type, 'cache-control': 'public, max-age=3600' });
    return res.end(cover.data);
  }

  const tplUseMatch = url.pathname.match(/^\/api\/templates\/([^/]+)\/instantiate$/);
  if (tplUseMatch && req.method === 'POST') {
    const id = decodeURIComponent(tplUseMatch[1]);
    const body = await readBody(req).catch(() => ({}));
    try {
      const result = await instantiateTemplate(id, body || {}, {
        templatesDir: TEMPLATES_DIR,
        assetsDir: ASSETS_DIR,
        wfStore,
        newWfId,
      });
      return sendJson(res, 201, result);
    } catch (err) {
      const status = err.code === 'noTemplate' ? 404 : 400;
      throw new HttpError(status, err.message, err.code || 'badTemplate');
    }
  }

  // ── 素材上传：base64 → assets/，返回引用（JSON 只存引用，不存 base64） ──
  // ── 读取已上传素材（前端缩略图用）；basename 防目录穿越 ──
  const assetGetMatch = url.pathname.match(/^\/api\/assets\/([^/]+)$/);
  if (assetGetMatch && req.method === 'GET') {
    const name = path.basename(decodeURIComponent(assetGetMatch[1]));
    try {
      const buf = await readFile(path.join(ASSETS_DIR, name));
      const ext = path.extname(name).slice(1).toLowerCase();
      const mime = ASSET_EXT_TO_MIME[ext] || 'application/octet-stream';
      res.writeHead(200, { 'content-type': mime, 'cache-control': 'public, max-age=31536000, immutable' });
      return res.end(buf);
    } catch {
      throw new HttpError(404, '素材不存在');
    }
  }

  if (url.pathname === '/api/assets' && req.method === 'POST') {
    const { name, mime, dataBase64 } = await readBody(req);
    if (!dataBase64) throw new HttpError(400, '缺少 dataBase64');
    const ext = ASSET_MIME_TO_EXT[String(mime || '').toLowerCase()] || 'bin';
    const buf = Buffer.from(String(dataBase64), 'base64');
    if (buf.length > 80 * 1024 * 1024) throw new HttpError(400, '单个素材不能超过 80MB');
    await mkdir(ASSETS_DIR, { recursive: true });
    const asset = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}.${ext}`;
    await writeFile(path.join(ASSETS_DIR, asset), buf);
    // 回带落盘 mime：前端拿它判定素材类型（图片才用 <img>，视频/音频只给图标）
    return sendJson(res, 200, { asset, name: String(name || asset), mime: ASSET_EXT_TO_MIME[ext] || '', bytes: buf.length });
  }

  // ── 图执行：起 run / 查询 / SSE / 取消 ──
  // 运行历史：结果面板的下拉 + 刷新后恢复节点状态
  if (url.pathname === '/api/runs' && req.method === 'GET') {
    const wfId = url.searchParams.get('wfId');
    if (!wfId) throw new HttpError(400, '缺少 wfId');
    return sendJson(res, 200, { items: runsStore.listByWf(wfId, Number(url.searchParams.get('limit')) || 20) });
  }

  if (url.pathname === '/api/run' && req.method === 'POST') {
    const { wfId, nodeIds = null, dryRun = false, single = false } = await readBody(req);
    if (!wfId) throw new HttpError(400, '缺少 wfId');
    const graph = wfStore.get(wfId);
    return sendJson(res, 200, await runner.start({ wfId, graph, nodeIds, dryRun, single }));
  }

  const runMatch = url.pathname.match(/^\/api\/run\/([^/]+)(\/events|\/cancel)?$/);
  if (runMatch) {
    const runId = decodeURIComponent(runMatch[1]);
    const sub = runMatch[2];
    if (sub === '/events' && req.method === 'GET') {
      return runner.attachSse(req, res, runId, req.headers['last-event-id']);
    }
    if (sub === '/cancel' && req.method === 'POST') {
      return sendJson(res, 200, await runner.cancel(runId));
    }
    if (!sub && req.method === 'GET') {
      // 内存优先（跑着的 run 状态最新）；内存没有就回落 SQLite（刷新 / 重启后）
      let data = null;
      try { data = runner.get(runId); } catch { data = runsStore.detail(runId); }
      if (!data) throw new HttpError(404, `run 不存在：${runId}`);
      return sendJson(res, 200, data);
    }
  }

  switch (route) {
    case 'GET /api/settings': {
      const cfg = await readConfig();
      const token = cfg.token || process.env.MINIMAX_TOKEN || '';
      const llmCfg = cfg.llm || {};
      const llmKey = llmCfg.apiKey || process.env.LLM_API_KEY || '';
      return sendJson(res, 200, {
        token: maskSecret(token),
        hasToken: Boolean(token),
        baseUrl: await getApiBase(),
        model: MODEL,
        llm: {
          baseUrl: llmCfg.baseUrl || '',
          model: llmCfg.model || '',
          apiKey: maskSecret(llmKey),
          hasKey: Boolean(llmKey),
          // 模型能力上限用默认值兜底，避免前端拿到空值算不了占比
          maxTokens: Number(llmCfg.maxTokens) || 65536,
          contextWindow: Number(llmCfg.contextWindow) || 1048576,
        },
      });
    }

    // 只接受“非空且不是掩码回显”的值，避免把 **** 写进配置文件
    case 'POST /api/settings': {
      const body = await readBody(req);
      const cfg = await readConfig();
      const usable = (v) => typeof v === 'string' && v.trim() && !v.includes('****');
      if (usable(body.token)) cfg.token = body.token.trim();
      if (usable(body.baseUrl)) cfg.baseUrl = body.baseUrl.trim().replace(/\/+$/, '');
      if (body.llm && typeof body.llm === 'object') {
        cfg.llm = { ...(cfg.llm || {}) };
        if (usable(body.llm.baseUrl)) cfg.llm.baseUrl = body.llm.baseUrl.trim();
        if (usable(body.llm.model)) cfg.llm.model = body.llm.model.trim();
        if (usable(body.llm.apiKey)) cfg.llm.apiKey = body.llm.apiKey.trim();
        // 数字字段单独校验：越界或非数字直接忽略，不写脏值进配置
        const num = (v, min, max) => {
          const n = Number(v);
          return Number.isFinite(n) && n >= min && n <= max ? Math.round(n) : null;
        };
        const mt = num(body.llm.maxTokens, 256, 393216);
        if (mt) cfg.llm.maxTokens = mt;
        const cw = num(body.llm.contextWindow, 1024, 16777216);
        if (cw) cfg.llm.contextWindow = cw;
      }
      await writeFile(CONFIG_FILE, JSON.stringify(cfg, null, 2), 'utf8');
      return sendJson(res, 200, { ok: true });
    }

    case 'POST /api/generate': {
      const { mode = 'generation', payload = {} } = await readBody(req);
      const routePath = CREATE_ROUTES[mode];
      if (!routePath) throw new HttpError(400, `未知任务类型：${mode}`);
      const body = { model: MODEL, ...payload };
      body.model = MODEL;
      const result = await gateway(routePath, { method: 'POST', body });
      return sendJson(res, result.status, unwrap(result));
    }

    case 'GET /api/task': {
      const id = url.searchParams.get('id');
      if (!id) throw new HttpError(400, '缺少 id');
      const result = await gateway(`/v2/query/video_generation/${encodeURIComponent(id)}`);
      return sendJson(res, result.status, unwrap(result));
    }

    case 'DELETE /api/task': {
      const id = url.searchParams.get('id');
      if (!id) throw new HttpError(400, '缺少 id');
      const result = await gateway(`/v2/video_generation/${encodeURIComponent(id)}`, { method: 'DELETE' });
      return sendJson(res, result.status, unwrap(result));
    }

    case 'GET /api/tasks': {
      // wfId 给了就只回这个工作流的任务：网关任务本身没有 wf 字段，用本地线索反查——
      // 该流 runs 里出现过的 task_id + 图里 task.source 节点引用的 taskId
      const wfId = url.searchParams.get('wfId');
      const qs = new URLSearchParams();
      for (const [k, v] of url.searchParams) {
        if (k === 'wfId') continue;
        if (k === 'status' && v) qs.append('filter.status', v);
        else if (k === 'task_type' && v) qs.append('filter.task_type', v);
        else if (k === 'page_num' || k === 'page_size') qs.append(k, v);
      }
      if (!qs.has('page_size')) qs.set('page_size', wfId ? '100' : '20');
      const result = await gateway(`/v2/query/video_generation?${qs}`);
      const data = unwrap(result);
      if (!wfId || result.status >= 400) return sendJson(res, result.status, data);

      const ids = new Set();
      for (const r of runsStore.listByWf(wfId, 50)) {
        for (const out of Object.values(r.outputs || {})) {
          const tid = out && typeof out === 'object' ? out.task_id : null;
          if (tid) ids.add(String(tid));
        }
      }
      try {
        const g = wfStore.get(wfId);
        for (const n of g?.nodes || []) {
          const tid = n?.type === 'task.source' ? n.data?.taskId : null;
          if (tid) ids.add(String(tid));
        }
      } catch { /* 图取不到就只按运行记录过滤 */ }
      const items = (data.items || []).filter((it) => ids.has(String(it.id)));
      return sendJson(res, 200, { ...data, items, total: items.length, wfId });
    }

    case 'POST /api/download': {
      const { url: mediaUrl, name } = await readBody(req);
      if (!mediaUrl) throw new HttpError(400, '缺少 url');
      const saved = await saveMedia(mediaUrl, name);
      return sendJson(res, 200, saved);
    }

    default:
      throw new HttpError(404, `未知接口：${route}`);
  }
}

/** 拉取网关产物并落盘到 downloads/ */
async function saveMedia(mediaUrl, name) {
  let upstream;
  try {
    upstream = await fetch(mediaUrl);
  } catch (err) {
    throw new HttpError(502, `下载失败：${err.message}`);
  }
  if (!upstream.ok || !upstream.body) throw new HttpError(502, `下载失败：HTTP ${upstream.status}`);

  const contentType = upstream.headers.get('content-type') || '';
  const extFromType = { 'video/mp4': '.mp4', 'video/webm': '.webm', 'audio/mpeg': '.mp3', 'image/png': '.png' };
  let ext = Object.entries(extFromType).find(([k]) => contentType.includes(k))?.[1];
  if (!ext) ext = path.extname(new URL(mediaUrl).pathname) || '.bin';

  const safeName = String(name || 'video').replace(/[^\w.-]+/g, '_').slice(0, 60) || 'video';
  const filename = `${safeName}_${Date.now()}${ext}`;
  await mkdir(DOWNLOAD_DIR, { recursive: true });
  await pipeline(Readable.fromWeb(upstream.body), createWriteStream(path.join(DOWNLOAD_DIR, filename)));
  return { file: filename, url: `/downloads/${encodeURIComponent(filename)}` };
}

/* ── 启动 ── */

const server = createServer(async (req, res) => {
  const url = new URL(req.url, `http://${req.headers.host || 'localhost'}`);
  try {
    if (url.pathname.startsWith('/api/')) await handleApi(req, res, url);
    else if (req.method === 'GET') await serveStatic(res, url.pathname);
    else sendJson(res, 405, { message: '不支持的方法' });
  } catch (err) {
    const status = err instanceof HttpError ? err.status : 500;
    if (status >= 500) console.error(`✗ ${req.method} ${url.pathname}`, err);
    sendJson(res, status, { message: err.message || '服务器内部错误', ...(err.code ? { code: err.code } : {}) });
  }
});

server.listen(PORT, '127.0.0.1', async () => {
  console.log(`✓ 灵动导演台已启动：http://127.0.0.1:${PORT}`);
  console.log(`  网关：${await getApiBase()}  模型：${MODEL}`);
  console.log(`  数据库：${DB_FILE}（驱动 ${db.driver}）`);
  console.log(`  产物目录：${DOWNLOAD_DIR}`);
});
