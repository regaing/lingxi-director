/**
 * 工作流导入 / 导出（.zip）。
 *
 * 包结构（人肉能看懂，重新打包也不会坏）：
 *   workflows.json      元信息 + 每个工作流的图
 *   assets/<file>       被引用到的素材原文件（不是 base64，体积就是原样）
 *
 * 素材在 JSON 里只有 `assets[]` 的引用（`{ asset: '<文件名>' }`），
 * 所以导出要顺着引用捞文件，导入要把引用改写成落盘后的新文件名。
 * 导入**永远**新建副本：不覆盖任何已有画布，重名自动加 (2)(3)。
 */
import { readFile, writeFile, mkdir } from 'node:fs/promises';
import path from 'node:path';
import { zipSync, unzipSync, strToU8, strFromU8 } from 'fflate';

export const BUNDLE_FORMAT = 'lingxi-director.bundle';
export const BUNDLE_VERSION = 1;
const META = 'workflows.json';

const bundleErr = (code, message) => Object.assign(new Error(message), { code });

/** 报错码由前端翻译，这里只给英文技术信息 */
export const ERR = {
  badZip: () => bundleErr('badZip', 'not a valid zip'),
  badMeta: () => bundleErr('badMeta', 'workflows.json missing or invalid'),
  empty: () => bundleErr('empty', 'no workflows in bundle'),
};

/** 一张图里引用到的素材文件名 */
export function collectAssets(nodes) {
  const out = new Set();
  for (const n of nodes || []) {
    const list = n?.data?.assets;
    if (!Array.isArray(list)) continue;
    for (const a of list) {
      const name = typeof a === 'string' ? a : a?.asset;
      if (name) out.add(String(name));
    }
  }
  return [...out];
}

/** 文件名除了盘符/斜杠之外都留着，中文标题也能当文件名 */
export function safeFileName(name, fallback = 'workflow') {
  const s = String(name || '').replace(/[\\/:*?"<>|\r\n]+/g, '_').trim().slice(0, 80);
  return s || fallback;
}

/**
 * 打包。
 * @param {Array<{name, category, nodes, edges}>} wfList
 * @param {string} assetsDir
 * @returns {Promise<Buffer>}
 */
export async function packBundle(wfList, assetsDir) {
  const files = {};
  const missing = [];

  const names = new Set();
  for (const w of wfList) for (const a of collectAssets(w.nodes)) names.add(a);

  for (const asset of names) {
    try {
      // basename 防目录穿越：图里的引用可能带路径
      files[`assets/${path.basename(asset)}`] = new Uint8Array(await readFile(path.join(assetsDir, path.basename(asset))));
    } catch {
      missing.push(asset);   // 素材丢了不影响导出，图还能用，只是引用会悬空
    }
  }

  const meta = {
    format: BUNDLE_FORMAT,
    version: BUNDLE_VERSION,
    exportedAt: new Date().toISOString(),
    missingAssets: missing,
    workflows: wfList.map((w) => ({
      name: w.name || '',
      category: w.category || '',
      nodes: w.nodes || [],
      edges: w.edges || [],
    })),
  };
  files[META] = strToU8(JSON.stringify(meta, null, 2));
  return Buffer.from(zipSync(files, { level: 6 }));
}

/**
 * 解包。容忍「zip 里套了一层目录」（用户自己重新打包时很常见）。
 * @returns {{workflows: Array, assets: Array<{name: string, data: Uint8Array}>, missingAssets: string[]}}
 */
export function unpackBundle(buf) {
  let entries;
  try {
    entries = unzipSync(new Uint8Array(buf));
  } catch {
    throw ERR.badZip();
  }

  const metaKey = Object.keys(entries).find((k) => k === META || k.endsWith(`/${META}`));
  if (!metaKey) throw ERR.badMeta();

  let meta;
  try {
    meta = JSON.parse(strFromU8(entries[metaKey]));
  } catch {
    throw ERR.badMeta();
  }
  if (!meta || meta.format !== BUNDLE_FORMAT || !Array.isArray(meta.workflows)) throw ERR.badMeta();

  const workflows = meta.workflows.filter((w) => w && Array.isArray(w.nodes));
  if (!workflows.length) throw ERR.empty();

  const prefix = metaKey.slice(0, metaKey.length - META.length);           // '' 或 'pkg/'
  const assets = [];
  for (const [key, data] of Object.entries(entries)) {
    if (!key.startsWith(`${prefix}assets/`) || key.endsWith('/')) continue;
    const name = path.basename(key);
    if (name) assets.push({ name, data });
  }

  return { workflows, assets, missingAssets: Array.isArray(meta.missingAssets) ? meta.missingAssets : [] };
}

/** 重名一律加 (2)(3)…，绝不覆盖已有画布 */
export function uniqueName(name, taken) {
  const base = String(name || '').trim() || 'workflow';
  if (!taken.has(base)) return base;
  for (let i = 2; i < 1000; i += 1) {
    const candidate = `${base} (${i})`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base} (${Date.now()})`;
}

const remapNodes = (nodes, assetMap) => {
  if (!assetMap.size) return nodes || [];
  return (nodes || []).map((n) => {
    const list = n?.data?.assets;
    if (!Array.isArray(list)) return n;
    return {
      ...n,
      data: {
        ...n.data,
        assets: list.map((a) => (
          typeof a === 'object' && a?.asset && assetMap.has(a.asset) ? { ...a, asset: assetMap.get(a.asset) } : a
        )),
      },
    };
  });
};

/**
 * 落盘导入：素材先写进 assets/（换新名字，不碰同名旧文件），再逐个新建工作流。
 * @returns {Promise<{created: Array<{id, name}>, missingAssets: string[]}>}
 */
export async function importBundle(bundle, { assetsDir, wfStore, newWfId }) {
  const assetMap = new Map();
  if (bundle.assets.length) await mkdir(assetsDir, { recursive: true });

  for (const a of bundle.assets) {
    const ext = path.extname(a.name).toLowerCase() || '.bin';
    const saved = `${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}${ext}`;
    await writeFile(path.join(assetsDir, saved), Buffer.from(a.data));
    assetMap.set(a.name, saved);
  }

  const taken = new Set((wfStore.list() || []).map((w) => w.name));
  const catIdByName = new Map((wfStore.listCategories().items || []).map((c) => [String(c.name).trim(), c.id]));

  const created = [];
  for (const wf of bundle.workflows) {
    const name = uniqueName(wf.name, taken);
    taken.add(name);
    const catName = String(wf.category || '').trim();
    const row = wfStore.put(newWfId(), {
      name,
      categoryId: catName ? (catIdByName.get(catName) || null) : null,
      nodes: remapNodes(wf.nodes, assetMap),
      edges: wf.edges || [],
    });
    created.push({ id: row.id, name: row.name });
  }

  // 包里本来就缺的 + 引用了却找不到文件的
  const referenced = new Set();
  for (const wf of bundle.workflows) for (const a of collectAssets(wf.nodes)) referenced.add(a);
  const missing = [...referenced].filter((n) => !assetMap.has(n));
  return { created, missingAssets: [...new Set([...(bundle.missingAssets || []), ...missing])] };
}
