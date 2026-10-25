/**
 * 内置画布模板（L0）。
 *
 * 模板 = 一个目录：
 *   templates/<id>/manifest.json   元信息 + 参数声明 + 必填素材声明
 *   templates/<id>/workflow.json   { nodes, edges }，必须是完整可运行的图
 *   templates/<id>/assets/         真实素材文件（占位图也在这里）
 *   templates/<id>/cover.png       可选封面
 *
 * 为什么是目录不是 zip：不做分发时，zip 唯一优势（发一个文件）用不上；
 * 目录在 git 里可 diff、可 review、素材能直接看、加模板不用打包。
 *
 * 实例化复用 `bundle.mjs` 的 `importBundle`：
 * 素材改名落盘 + 节点引用重写 + 重名加 (2)(3) 都已经在那里实现过了。
 */
import { readFile, readdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { importBundle } from './bundle.mjs';
import { completeGraph } from './graph-complete.mjs';

export const TEMPLATE_FORMAT = 'lingxi-director.template';

/** 目录名即 id：只允许字母数字和 . _ -，且不许出现 ..（防目录穿越） */
const ID_RE = /^[a-z0-9][a-z0-9._-]{0,63}$/i;

export const isValidTemplateId = (id) =>
  typeof id === 'string' && ID_RE.test(id) && !id.includes('..');

const tplErr = (code, message) => Object.assign(new Error(message), { code });

async function readJson(file) {
  const raw = await readFile(file, 'utf8');
  return JSON.parse(raw.charCodeAt(0) === 0xfeff ? raw.slice(1) : raw);   // 容忍 BOM
}

/** manifest 校验：只挡致命问题，语言字段缺失让前端兜底 */
function assertManifest(meta, id) {
  if (!meta || typeof meta !== 'object') throw tplErr('badTemplateMeta', `模板 ${id} 的 manifest 不是对象`);
  if (meta.format !== TEMPLATE_FORMAT) throw tplErr('badTemplateMeta', `模板 ${id} 的 format 不是 ${TEMPLATE_FORMAT}`);
  if (!meta.name || (typeof meta.name !== 'object' && typeof meta.name !== 'string')) {
    throw tplErr('badTemplateMeta', `模板 ${id} 缺少 name`);
  }
}

/** 多语言字段：字符串直接当中文用，对象按 lang 取，取不到退中文再退英文 */
export const pickText = (field, lang = 'zh') => {
  if (field == null) return '';
  if (typeof field === 'string') return field;
  return field[lang] || field.zh || field.en || '';
};

/** 读一个模板目录；坏掉的返回 null，不让单个模板拖垮整个列表 */
async function readTemplate(templatesDir, id) {
  const dir = path.join(templatesDir, id);
  let meta;
  try {
    meta = await readJson(path.join(dir, 'manifest.json'));
    assertManifest(meta, id);
  } catch {
    return null;
  }

  let workflow = { nodes: [], edges: [] };
  try {
    workflow = await readJson(path.join(dir, 'workflow.json'));
  } catch {
    return null;   // 没有图就不算模板
  }
  if (!Array.isArray(workflow?.nodes) || !workflow.nodes.length) return null;

  // 素材文件：目录里有什么就带什么（占位图也是真实文件，跟着走）
  const assets = [];
  let hasCover = false;
  try {
    const entries = await readdir(path.join(dir, 'assets'), { withFileTypes: true });
    for (const e of entries) {
      if (!e.isFile()) continue;
      const name = e.name;
      if (name === 'cover.png' || name === 'cover.jpg') { hasCover = true; continue; }
      assets.push({ name, data: await readFile(path.join(dir, 'assets', name)) });
    }
  } catch { /* 没有 assets/ 目录很正常 */ }
  // 封面可以放模板根目录或 assets/ 下，png / jpg 都认（生成脚本出的是 jpg）
  for (const ext of ['png', 'jpg']) {
    if (hasCover) break;
    for (const sub of ['', 'assets']) {
      try {
        const st = await stat(path.join(dir, sub, `cover.${ext}`));
        if (st.isFile()) { hasCover = true; break; }
      } catch { /* 换下一个位置 */ }
    }
  }

  return { id, dir, manifest: meta, workflow, assets, hasCover };
}

/* 不做缓存：曾按 `templates/` 目录的 mtime 做缓存，但**改子目录里的文件不会改变父目录 mtime**，
 * 于是改了 manifest 永远读不到新值。5 个模板每次读几十 KB，不值得为它冒险。 */

async function scanDirs(templatesDir) {
  let entries;
  try {
    entries = await readdir(templatesDir, { withFileTypes: true });
  } catch {
    return [];   // 目录不存在 = 没有模板，不是错误
  }
  const out = [];
  for (const e of entries) {
    if (!e.isDirectory()) continue;
    if (!isValidTemplateId(e.name)) continue;
    const t = await readTemplate(templatesDir, e.name);
    if (t) out.push(t);
    else console.warn(`[templates] 跳过无法解析的模板：${e.name}`);
  }
  return out.sort((a, b) => a.id.localeCompare(b.id));
}

/**
 * 列表（给前端渲染卡片）。
 * @returns {Promise<{items: Array}>}
 */
export async function listTemplates(templatesDir) {

  const raw = await scanDirs(templatesDir);
  const items = raw.map((t) => ({
    id: t.id,
    name: t.manifest.name,
    description: t.manifest.description || '',
    tags: Array.isArray(t.manifest.tags) ? t.manifest.tags : [],
    provider: t.manifest.provider || '',
    estimate: t.manifest.estimate || null,
    params: Array.isArray(t.manifest.params) ? t.manifest.params : [],
    requires: Array.isArray(t.manifest.requires) ? t.manifest.requires : [],
    nodeCount: t.workflow.nodes.length,
    hasAssets: t.assets.length > 0,
    cover: t.hasCover ? `/api/templates/${encodeURIComponent(t.id)}/cover` : '',
  }));

  return { items };
}

/** 取封面图原始字节（id 已在调用处白名单校验过） */
export async function readTemplateCover(templatesDir, id) {
  for (const ext of ['png', 'jpg']) {
    const mime = ext === 'jpg' ? 'image/jpeg' : 'image/png';   // jpg 的标准 MIME 是 image/jpeg，不是 image/jpg
    for (const sub of ['assets', '']) {
      try {
        return { data: await readFile(path.join(templatesDir, id, sub, `cover.${ext}`)), type: mime };
      } catch { /* 换下一个位置 */ }
    }
  }
  return null;
}

const clamp = (n, min, max) => {
  let v = Number(n);
  if (!Number.isFinite(v)) return null;
  if (Number.isFinite(min)) v = Math.max(min, v);
  if (Number.isFinite(max)) v = Math.min(max, v);
  return v;
};

/**
 * 把用户填的参数写回节点。
 * 只按 manifest 的 target 精确覆盖，不做业务校验（那是 validateGraph 的事）；
 * 类型按声明归一，非法值一律退回声明里的 default，绝不写进脏数据。
 */
export function applyParams(nodes, params, values) {
  if (!Array.isArray(params) || !params.length) return nodes;
  const patch = new Map();   // nodeId -> {field: value}
  for (const p of params) {
    const target = p?.target;
    if (!target?.nodeId || !target?.field) continue;
    const raw = values?.[p.key];
    if (raw === undefined || raw === '') continue;

    let v = raw;
    if (p.type === 'number') {
      v = clamp(raw, p.min, p.max);
      if (v == null) v = p.default;
    } else if (p.type === 'select') {
      const opts = Array.isArray(p.options) ? p.options : [];
      if (opts.length && !opts.includes(raw)) v = p.default ?? opts[0];
    } else if (p.type === 'switch') {
      v = raw === true || raw === 'true';
    } else {
      v = String(raw);
    }
    if (v === undefined) continue;
    if (!patch.has(target.nodeId)) patch.set(target.nodeId, {});
    patch.get(target.nodeId)[target.field] = v;
  }
  if (!patch.size) return nodes;

  return nodes.map((n) => {
    const fields = patch.get(n.id);
    if (!fields) return n;
    return { ...n, data: { ...n.data, ...fields } };
  });
}

/** 哪些节点还在用占位素材（前端据此在画布上提示"先换素材"） */
function collectAssetHints(nodes, requires) {
  if (!Array.isArray(requires) || !requires.length) return [];
  return requires.map((r) => {
    const n = nodes.find((x) => x.id === r.nodeId);
    const list = Array.isArray(n?.data?.assets) ? n.data.assets : [];
    const names = list.map((a) => String(a?.asset ?? a ?? ''));
    const isPlaceholder = names.some((x) => /placeholder/i.test(x));
    return {
      nodeId: r.nodeId,
      label: r.label || '',
      why: r.why || '',
      isPlaceholder,
      isEmpty: names.filter(Boolean).length === 0,
    };
  });
}

/**
 * 实例化：模板 → 新建一个独立的工作流副本。
 *
 * @param {string} id 模板 id
 * @param {{name?: string, values?: object}} payload
 * @returns {Promise<{id, name, missingAssets, autoFilled, assetHints}>}
 */
export async function instantiateTemplate(id, payload, { templatesDir, assetsDir, wfStore, newWfId }) {
  if (!isValidTemplateId(id)) throw tplErr('noTemplate', `模板不存在：${id}`);
  const tpl = await readTemplate(templatesDir, id);
  if (!tpl) throw tplErr('noTemplate', `模板不存在或已损坏：${id}`);

  const nodes = applyParams(tpl.workflow.nodes, tpl.manifest.params, payload?.values);
  const fallbackName = pickText(tpl.manifest.name, 'zh') || id;

  const bundle = {
    workflows: [{
      name: String(payload?.name || '').trim() || fallbackName,
      category: tpl.manifest.category || '',
      nodes,
      edges: tpl.workflow.edges || [],
    }],
    assets: tpl.assets,
    missingAssets: [],
  };

  // 复用导入链路：素材改名落盘 + 引用重写 + 重名加 (2)(3)
  const res = await importBundle(bundle, { assetsDir, wfStore, newWfId });
  const created = res.created[0];
  if (!created) throw tplErr('badTemplate', '模板实例化失败');

  // 兜底：模板图理应自带 watch / 出口，缺了也补上，别给用户一张跑不通的图
  let autoFilled = [];
  try {
    const g = await wfStore.get(created.id);
    const fill = completeGraph({ nodes: g.nodes, edges: g.edges });
    if (fill.ops.length) {
      wfStore.patch(created.id, fill.ops);
      autoFilled = fill.added || [];
    }
  } catch (err) {
    console.warn(`[templates] ${id} 补齐失败：${err.message}`);
  }

  return {
    id: created.id,
    name: created.name,
    missingAssets: res.missingAssets || [],
    autoFilled,
    // 用模板原始节点判断：实例化时素材会被改名落盘（防覆盖同名），
    // 改名后文件名里已经没有 placeholder 了，拿新图判断永远得不到真话。
    assetHints: collectAssetHints(tpl.workflow.nodes, tpl.manifest.requires),
  };
}
