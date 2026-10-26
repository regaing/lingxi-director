/**
 * 图模型单一扩展点。
 * 新增节点类型只改这里 + 在 nodes/index.jsx 里注册渲染组件即可。
 * 所有面向用户的文案用 labelKey 指向 i18n 字典，不写死语言。
 */

/** 平台能力描述：换平台只改这个对象（实测值见 plan/工作流画布-2026-10-21.md 2.4.6） */
export const PROVIDER = {
  name: 'Metaso H3',
  baseUrl: 'https://metaso.cn/api/minimax',
  resolutions: ['480p', '512p', '768P', '1080p', '2K'],
  // 实测：480p/512p/768P/1080p = 4–30；2K = 4–15
  durationRange(res) {
    return res === '2K' ? [4, 15] : [4, 30];
  },
  // 实测（2026-10-22）：网关**不接受 adaptive**，报「文生视频 ratio 不能为空或 adaptive (2013)」；
  // 而且完全不传也会报「ratio 参数无效 (2013)」—— 官方文档写“未传取默认值”与实现不符，ratio 必须显式给。
  // 以下 5 项均已实测可创建任务（9:16 因余额不足返回 402，但参数本身合法）。
  ratios: ['16:9', '4:3', '1:1', '3:4', '9:16', '21:9'],
  framesVsRef: 'exclusive',
  imageRatioMin: 0.4,
  imageRatioMax: 2.5,
};

/**
 * 素材类型判定（缩略图渲染用）：图片能直接 <img> 展示，视频/音频只能给类型图标。
 * 优先看上传时记下的 mime；老数据没有 mime，就退回落盘文件名的扩展名。
 */
const ASSET_EXT_KIND = {
  png: 'image', jpg: 'image', jpeg: 'image', webp: 'image', gif: 'image', avif: 'image',
  mp4: 'video', webm: 'video', mov: 'video', mkv: 'video',
  mp3: 'audio', wav: 'audio', m4a: 'audio', aac: 'audio', ogg: 'audio', flac: 'audio',
};

export function assetKind(a) {
  const head = String(a?.mime || '').split('/')[0];
  if (head === 'image' || head === 'video' || head === 'audio') return head;
  const file = String(a?.asset || a?.name || '');
  const ext = file.includes('.') ? file.split('.').pop().toLowerCase() : '';
  return ASSET_EXT_KIND[ext] || 'file';
}

/**
 * image.fit 的补边颜色（直接作为 ffmpeg 的 color 参数）。
 * 只有纯色名：hex 值在网关侧没有语义，多给反而容易配出和画面冲突的边。
 * 黑边和视频黑边一致最不突兀；白边适合浅色/商品图；灰边做中性过渡。
 */
export const PAD_COLORS = ['black', 'white', 'gray'];

/**
 * 可运行链路的硬规则：AI 提示词（schemaForLLM 投影）与服务端补齐（lib/graph-complete.mjs）
 * 都读这一份，别两边各写一遍。
 */
export const FLOW_RULES = {
  /** 产出 task_id 的节点：必须被 task.watch 消费，否则永远拿不到 video_url */
  watchAfter: ['gen.video', 'gen.regen'],
  /** task.watch 的 video_url 必须到达的成品出口（缺哪个补哪个） */
  outputAfter: ['output.preview', 'output.download'],
  /** gen.video 缺负向词时预置的内容（平台没有独立 negative 字段，只能并进 text 末尾） */
  defaultNegative: 'blurry, watermark, distorted faces, extra limbs, morphing, flickering, text artifacts',
};

const H = (id, label) => ({ id, label: label || id });

const SEL = (value, label) => ({ value, label });

export const NODE_DEFS = {
  'text.prompt': {
    labelKey: 'node.text.prompt', group: 'group.input', color: '#7c6cf0',
    doc: 'A text prompt. Emits one text string.',
    outputs: [H('text')],
    fields: [{ key: 'text', type: 'textarea', labelKey: 'field.text', placeholder: 'a cat walks...' }],
    defaults: { text: '' },
  },
  'text.negative': {
    labelKey: 'node.text.negative', group: 'group.input', color: '#8a5cd6',
    doc: 'Negative prompt; merged into the same text content, placed at the end.',
    outputs: [H('text')],
    fields: [{ key: 'text', type: 'textarea', labelKey: 'field.negative', placeholder: 'blurry, watermark...' }],
    defaults: { text: '' },
  },
  'media.image': {
    labelKey: 'node.media.image', group: 'group.input', color: '#3f8fe0',
    doc: 'Image assets. role=reference_image OR first_frame/last_frame; frames and references are mutually exclusive.',
    outputs: [H('image')],
    fields: [
      {
        key: 'role', type: 'select', labelKey: 'field.role',
        options: [SEL('reference_image', 'role.reference_image'), SEL('first_frame', 'role.first_frame'), SEL('last_frame', 'role.last_frame')],
      },
      { key: 'assets', type: 'assets', labelKey: 'field.assets' },
    ],
    defaults: { role: 'reference_image', assets: [] },
  },
  'media.video': {
    labelKey: 'node.media.video', group: 'group.input', color: '#3f8fe0',
    doc: 'Reference video assets (base64 data URI).',
    outputs: [H('video')],
    fields: [{ key: 'assets', type: 'assets', labelKey: 'field.assets' }],
    defaults: { assets: [] },
  },
  'media.audio': {
    labelKey: 'node.media.audio', group: 'group.input', color: '#3f8fe0',
    doc: 'Reference audio assets (base64 data URI).',
    outputs: [H('audio')],
    fields: [{ key: 'assets', type: 'assets', labelKey: 'field.assets' }],
    defaults: { assets: [] },
  },
  'param.video': {
    labelKey: 'node.param.video', group: 'group.input', color: '#c08a3e',
    doc: 'Video parameters. Duration range depends on resolution: 4-30 for 480p/512p/768P/1080p, 4-15 for 2K.',
    outputs: [H('duration'), H('resolution'), H('ratio'), H('watermark')],
    fields: [
      { key: 'duration', type: 'number', labelKey: 'field.duration' },
      { key: 'resolution', type: 'select', labelKey: 'field.resolution', options: PROVIDER.resolutions.map((r) => SEL(r, r)) },
      { key: 'ratio', type: 'select', labelKey: 'field.ratio', options: PROVIDER.ratios.map((r) => SEL(r, r)) },
      { key: 'watermark', type: 'select', labelKey: 'field.watermark', options: [SEL('', 'opt.omit'), SEL('true', 'opt.on'), SEL('false', 'opt.off')] },
    ],
    defaults: { duration: 6, resolution: '768P', ratio: '16:9', watermark: '' },
  },
  'task.source': {
    labelKey: 'node.task.source', group: 'group.input', color: '#c08a3e',
    doc: 'An existing task id, used as source for regeneration.',
    outputs: [H('task_id')],
    fields: [{ key: 'taskId', type: 'text', labelKey: 'field.taskId' }],
    defaults: { taskId: '' },
  },
  'gen.video': {
    labelKey: 'node.gen.video', group: 'group.gen', color: '#e0503f',
    doc: 'Creates a video generation task. Needs text plus duration/resolution from a param.video node. Its task_id output MUST be consumed by a task.watch node - task.watch is the only node that emits video_url.',
    inputs: [H('text'), H('image'), H('video'), H('audio'), H('duration'), H('resolution'), H('ratio'), H('watermark')],
    outputs: [H('task_id')],
    fields: [],
    defaults: {},
  },
  'gen.context': {
    labelKey: 'node.gen.context', group: 'group.gen', color: '#e0503f',
    doc: 'Context IR task. Accepts text only (no image/duration).',
    inputs: [H('text')],
    outputs: [H('task_id')],
    fields: [],
    defaults: {},
  },
  'gen.regen': {
    labelKey: 'node.gen.regen', group: 'group.gen', color: '#e0503f',
    doc: 'Regenerates from a source task id OR from content; exactly one. Resolution is fixed to 2K, no duration. Its task_id also MUST be watched by task.watch.',
    inputs: [H('task_id'), H('text')],
    outputs: [H('task_id')],
    fields: [],
    defaults: {},
  },
  'task.watch': {
    labelKey: 'node.task.watch', group: 'group.process', color: '#3fa96b',
    doc: 'Polls a task until it reaches a terminal state and emits video_url. Also re-emits the task_id so downstream nodes (regeneration, frame extraction, record keeping) can reference it.',
    inputs: [H('task_id')],
    // task_id 原样透出：下游要拿它做再生成 / 抽帧 / 留痕，不必再连一条线回上游
    outputs: [H('status'), H('video_url'), H('task_id')],
    fields: [
      { key: 'pollMs', type: 'number', labelKey: 'field.pollMs', min: 1 },
      { key: 'timeoutMin', type: 'number', labelKey: 'field.timeoutMin', min: 1 },
    ],
    defaults: { pollMs: 4, timeoutMin: 45 },
  },

  /* ── 媒体处理组：抽帧 / 加边 / 拼接 / 探针 ── */
  'video.frame': {
    labelKey: 'node.video.frame', group: 'group.process', color: '#3fa96b',
    doc: 'Extracts a still from the incoming video and emits it as an image. Typical use: the previous shot is done, take its LAST frame as the FIRST frame of the next shot so the two shots connect. position = last | first | at (at uses atSec). Frame images are mutually exclusive with reference images.',
    inputs: [H('video_url')],
    outputs: [H('image')],
    fields: [
      {
        key: 'position', type: 'select', labelKey: 'field.framePos',
        options: [SEL('last', 'frame.last'), SEL('first', 'frame.first'), SEL('at', 'frame.at')],
      },
      { key: 'atSec', type: 'number', labelKey: 'field.atSec', min: 0 },
      {
        key: 'role', type: 'select', labelKey: 'field.frameRole',
        options: [SEL('first_frame', 'role.first_frame'), SEL('last_frame', 'role.last_frame'), SEL('reference_image', 'role.reference_image')],
      },
      { key: 'quality', type: 'number', labelKey: 'field.jpegQuality', min: 2, max: 31 },
    ],
    // 默认取尾帧 → 当下一段的首帧，这是续接生成最常见的一步
    defaults: { position: 'last', atSec: 0, role: 'first_frame', quality: 3 },
  },
  'video.concat': {
    labelKey: 'node.video.concat', group: 'group.process', color: '#3fa96b',
    doc: 'Joins every incoming video end-to-end into one file and saves it to downloads. Order follows the order the inputs are wired. Same-codec segments are joined losslessly and fast; mismatched ones fall back to re-encoding.',
    inputs: [H('video_url')],
    outputs: [H('video_url'), H('file')],
    fields: [{ key: 'namePrefix', type: 'text', labelKey: 'field.namePrefix', placeholder: 'joined' }],
    defaults: { namePrefix: 'joined' },
  },
  'image.fit': {
    labelKey: 'node.image.fit', group: 'group.process', color: '#3fa96b',
    doc: 'Pads images whose aspect ratio falls outside 0.4-2.5 back into the legal window, so the gateway stops rejecting them with 2013. Images already in range pass through untouched. padColor is the fill used for the added border.',
    inputs: [H('image')],
    outputs: [H('image')],
    fields: [{
      key: 'color', type: 'select', labelKey: 'field.padColor',
      options: PAD_COLORS.map((c) => SEL(c, `color.${c}`)),
    }],
    defaults: { color: 'black' },
  },
  'video.info': {
    labelKey: 'node.video.info', group: 'group.process', color: '#3fa96b',
    doc: 'Probes an incoming video and emits its duration in seconds, its resolution string (e.g. 1344x768) and its byte size. Useful in front of a condition node, or to check what actually came back.',
    inputs: [H('video_url')],
    outputs: [H('duration'), H('resolution'), H('size')],
    fields: [],
    defaults: {},
  },
  /* ── 逻辑组：分支门 + 文本合并 ── */
  'logic.condition': {
    labelKey: 'node.logic.condition', group: 'group.logic', color: '#c264c9',
    doc: 'Branch gate. Compares the incoming value, only the matching output branch (pass/fail) stays alive and the other branch\'s downstream is skipped. Also emits a boolean.',
    inputs: [H('value')],
    outputs: [H('pass'), H('fail'), H('bool')],
    fields: [
      {
        key: 'op', type: 'select', labelKey: 'field.op',
        options: [
          SEL('notEmpty', 'opt.op.notEmpty'), SEL('empty', 'opt.op.empty'),
          SEL('contains', 'opt.op.contains'), SEL('notContains', 'opt.op.notContains'),
          SEL('equals', 'opt.op.equals'), SEL('notEquals', 'opt.op.notEquals'),
          SEL('gt', 'opt.op.gt'), SEL('gte', 'opt.op.gte'),
          SEL('lt', 'opt.op.lt'), SEL('lte', 'opt.op.lte'),
        ],
      },
      { key: 'compare', type: 'text', labelKey: 'field.compare', placeholder: 'rhino' },
      { key: 'number', type: 'number', labelKey: 'field.compareNumber' },
    ],
    defaults: { op: 'notEmpty', compare: '', number: 0 },
  },
  'text.merge': {
    labelKey: 'node.text.merge', group: 'group.logic', color: '#c264c9',
    doc: 'Joins several text inputs into one string with a separator. Prefer it over implicit concatenation.',
    inputs: [H('text')],
    outputs: [H('text')],
    fields: [{ key: 'separator', type: 'text', labelKey: 'field.separator', placeholder: '\\n\\n' }],
    defaults: { separator: '\n\n' },
  },
  'text.vars': {
    labelKey: 'node.text.vars', group: 'group.logic', color: '#c264c9',
    doc: 'Replaces {{placeholders}} inside the incoming text with the values configured below. One pair per line in the form key=value. Unknown placeholders are left as-is so nothing silently disappears.',
    inputs: [H('text')],
    outputs: [H('text')],
    fields: [{
      key: 'vars', type: 'textarea', labelKey: 'field.vars',
      placeholder: 'topic=who ate the last piece of cake\nmood=cozy warm tones',
    }],
    defaults: { vars: '' },
  },

  'output.preview': {
    labelKey: 'node.output.preview', group: 'group.output', color: '#2f8f83',
    doc: 'Shows the finished video in the app.',
    inputs: [H('video_url')],
    fields: [
      { key: 'autoOpen', type: 'switch', labelKey: 'field.autoOpen' },
      { key: 'autoPlay', type: 'switch', labelKey: 'field.autoPlay' },
      { key: 'loop', type: 'switch', labelKey: 'field.loop' },
    ],
    defaults: { autoOpen: true, autoPlay: true, loop: false },
  },
  'output.download': {
    labelKey: 'node.output.download', group: 'group.output', color: '#2f8f83',
    doc: 'Downloads the finished video into downloads/.',
    inputs: [H('video_url')],
    outputs: [H('file')],
    fields: [
      { key: 'namePrefix', type: 'text', labelKey: 'field.namePrefix', placeholder: 'video' },
      { key: 'autoDownload', type: 'switch', labelKey: 'field.autoDownload' },
    ],
    defaults: { namePrefix: 'video', autoDownload: true },
  },
};

export const GROUPS = ['group.input', 'group.gen', 'group.process', 'group.logic', 'group.output'];

let seq = 0;
export function newNode(type, position = { x: 0, y: 0 }) {
  const def = NODE_DEFS[type];
  if (!def) throw new Error(`未知节点类型：${type}`);
  const short = type.split('.').pop().slice(0, 4);
  seq += 1;
  return {
    id: `n_${short}_${Date.now().toString(36).slice(-4)}${seq}`,
    type,
    position,
    data: { ...(def.defaults || {}) },
  };
}

export function emptyGraph() {
  return { nodes: [], edges: [] };
}

/** 返回 [{key, vars}]，由 UI 负责翻译；AI/后端也能直接用 key 判断。 */
export function validateGraph(nodes, edges) {
  const out = [];
  const byId = new Map(nodes.map((n) => [n.id, n]));
  const incoming = (id, handle) =>
    edges.filter((e) => e.target === id && (!handle || e.targetHandle === handle)).map((e) => byId.get(e.source)).filter(Boolean);

  // 文本是「流」出来的：text.merge / text.vars 自身没有 text 字段，文本靠上游喂进来。
  // 校验若只看直连节点，这类透传节点就会被误判成「没有非空 text」，所以要顺着连线回溯。
  const PASS_TEXT = new Set(['text.merge', 'text.vars']);
  const hasText = (n, seen = new Set()) => {
    if (!n) return false;
    if (n.data?.text?.trim()) return true;
    if (!PASS_TEXT.has(n.type) || seen.has(n.id)) return false;
    const next = new Set(seen).add(n.id);
    return incoming(n.id, 'text').some((s) => hasText(s, next));
  };

  for (const n of nodes) {
    if (n.type?.startsWith('gen.') && n.type !== 'gen.regen') {
      const texts = incoming(n.id, 'text').filter((s) => hasText(s));
      if (!texts.length) out.push({ key: 'validate.noText', vars: { node: n.type } });
    }
    if (n.type === 'gen.video') {
      if (!incoming(n.id, 'resolution').length) out.push({ key: 'validate.noParam', vars: { node: n.type, field: 'resolution' } });
      if (!incoming(n.id, 'duration').length) out.push({ key: 'validate.noParam', vars: { node: n.type, field: 'duration' } });
    }
    if (n.type === 'gen.regen') {
      const hasSrc = incoming(n.id, 'task_id').length > 0;
      const hasBody = incoming(n.id, 'text').some((s) => hasText(s));
      if (hasSrc && hasBody) out.push({ key: 'validate.noParam', vars: { node: n.type, field: 'source_task_id XOR content' } });
    }
    if (n.type === 'param.video') {
      const res = n.data?.resolution;
      const [min, max] = PROVIDER.durationRange(res);
      const d = Number(n.data?.duration);
      if (!Number.isInteger(d) || d < min || d > max) out.push({ key: 'validate.duration', vars: { min, max, res } });
      // ratio 是必填枚举：放在图层面拦住，别等提交到网关才吃 2013
      if (!PROVIDER.ratios.includes(n.data?.ratio)) {
        out.push({ key: 'validate.videoRatio', vars: { value: String(n.data?.ratio ?? '') } });
      }
    }
    if (n.type === 'logic.condition') {
      const op = n.data?.op || 'notEmpty';
      const needsCompare = ['contains', 'notContains', 'equals', 'notEquals'].includes(op);
      if (needsCompare && !String(n.data?.compare ?? '').length) {
        out.push({ key: 'validate.needCompare', vars: { op } });
      }
      if (!incoming(n.id, 'value').length) out.push({ key: 'validate.noInput', vars: { node: 'logic.condition' } });
    }
    if (n.type === 'media.image') {
      const role = n.data?.role;
      // 首尾帧 vs 参考图：同一条生成链上不能混用
      const framed = nodes.filter((m) => m.type === 'media.image' && ['first_frame', 'last_frame'].includes(m.data?.role));
      const refs = nodes.filter((m) => m.type === 'media.image' && m.data?.role === 'reference_image');
      if (PROVIDER.framesVsRef === 'exclusive' && framed.length && refs.length) {
        out.push({ key: 'validate.framesVsRef' });
      }
      void role;
    }
  }

  // 成环检测
  const adj = new Map(nodes.map((n) => [n.id, []]));
  for (const e of edges) adj.get(e.source)?.push(e.target);
  const mark = new Map();
  const dfs = (id) => {
    if (mark.get(id) === 1) return true;
    if (mark.get(id) === 2) return false;
    mark.set(id, 1);
    for (const nx of adj.get(id) || []) if (dfs(nx)) return true;
    mark.set(id, 2);
    return false;
  };
  for (const n of nodes) if (!mark.get(n.id) && dfs(n.id)) { out.push({ key: 'validate.cycle' }); break; }

  // 去重同 key 同 vars
  const seen = new Set();
  return out.filter((e) => {
    const k = e.key + JSON.stringify(e.vars || {});
    if (seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** 给 LLM 的紧凑 schema —— 唯一真相仍在 NODE_DEFS，这里只是投影（含可运行链路规则） */
export function schemaForLLM() {
  return {
    nodes: Object.entries(NODE_DEFS).map(([type, d]) => ({
      type,
      doc: d.doc,
      inputs: (d.inputs || []).map((h) => h.id),
      outputs: (d.outputs || []).map((h) => h.id),
      fields: (d.fields || []).map((f) => ({ key: f.key, type: f.type, options: f.options?.map((o) => o.value) })),
      defaults: d.defaults || {},
    })),
    rules: FLOW_RULES,
  };
}
