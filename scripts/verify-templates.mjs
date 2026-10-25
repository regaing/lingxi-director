/**
 * 模板完整性校验（不是产品代码，是开发期护栏）。
 *
 * 检查五件事：
 *   1. manifest 结构合法
 *   2. 每条边的端口真实存在（防手改 JSON 时把 handle 写错）
 *   3. 前端 validateGraph 通过（这是用户点运行时同一套校验）
 *   4. completeGraph 无新增 ops（证明图自带 watch / 出口，不依赖兜底）
 *   5. data.assets 引用的文件真实存在于 assets/
 */
import { readdir, readFile, stat } from 'node:fs/promises';
import path from 'node:path';
import { validateGraph, NODE_DEFS } from '../web/src/graph/model.js';
import { completeGraph } from '../lib/graph-complete.mjs';

const TPL = path.resolve('templates');
const FORMAT = 'lingxi-director.template';

const readJson = async (f) => JSON.parse((await readFile(f, 'utf8')).replace(/^\uFEFF/, ''));

let failed = 0;
const fail = (id, msg) => { failed += 1; console.log(`   ❌ ${msg}`); };

const dirs = (await readdir(TPL, { withFileTypes: true })).filter((e) => e.isDirectory()).map((e) => e.name).sort();
if (!dirs.length) { console.log('没有找到任何模板目录'); process.exit(1); }

for (const id of dirs) {
  console.log(`\n▶ ${id}`);
  const dir = path.join(TPL, id);

  // 1) manifest
  let meta;
  try {
    meta = await readJson(path.join(dir, 'manifest.json'));
  } catch (e) { fail(id, `manifest.json 读不了：${e.message}`); continue; }
  if (meta.format !== FORMAT) fail(id, `format 应为 ${FORMAT}，实际 ${meta.format}`);
  if (!meta.name) fail(id, '缺少 name');
  if (!meta.provider) fail(id, '缺少 provider 标记（批次 2 换平台时需要）');

  // 2) workflow
  let wf;
  try {
    wf = await readJson(path.join(dir, 'workflow.json'));
  } catch (e) { fail(id, `workflow.json 读不了：${e.message}`); continue; }
  const { nodes = [], edges = [] } = wf;

  const byId = new Map(nodes.map((n) => [n.id, n]));
  for (const n of nodes) {
    if (!NODE_DEFS[n.type]) fail(id, `节点 ${n.id} 的类型 ${n.type} 不存在`);
  }
  for (const e of edges) {
    const s = byId.get(e.source);
    const t = byId.get(e.target);
    if (!s) { fail(id, `边 ${e.id} 的 source ${e.source} 不存在`); continue; }
    if (!t) { fail(id, `边 ${e.id} 的目标 ${e.target} 不存在`); continue; }
    const outs = (NODE_DEFS[s.type]?.outputs || []).map((o) => o.id);
    const ins = (NODE_DEFS[t.type]?.inputs || []).map((i) => i.id);
    if (!outs.includes(e.sourceHandle)) fail(id, `边 ${e.id}: ${s.type} 没有输出端口 ${e.sourceHandle}`);
    if (!ins.includes(e.targetHandle)) fail(id, `边 ${e.id}: ${t.type} 没有输入端口 ${e.targetHandle}`);
  }

  // 3) 前端校验（用户点运行时同一套规则）
  const issues = validateGraph(nodes, edges);
  if (issues.length) {
    for (const it of issues) fail(id, `validateGraph 未通过：${it.key} ${JSON.stringify(it.vars || {})}`);
  }

  // 4) 结构补齐应为空（图必须自带 watch + 出口）
  const fill = completeGraph({ nodes, edges });
  if (fill.ops?.length) fail(id, `completeGraph 需要补 ${fill.ops.length} 个操作（图不完整）：${JSON.stringify(fill.added)}`);

  // 5) 素材引用是否真实存在
  const assetRefs = [];
  for (const n of nodes) {
    for (const a of n?.data?.assets || []) {
      const name = typeof a === 'string' ? a : a?.asset;
      if (name) assetRefs.push(name);
    }
  }
  for (const name of assetRefs) {
    try {
      const st = await stat(path.join(dir, 'assets', path.basename(name)));
      if (!st.isFile()) fail(id, `素材 ${name} 不是文件`);
    } catch { fail(id, `素材 ${name} 在 assets/ 里找不到`); }
  }

  // manifest.requires 指向的节点必须存在且有素材
  for (const r of meta.requires || []) {
    const n = byId.get(r.nodeId);
    if (!n) { fail(id, `requires 指向的节点 ${r.nodeId} 不存在`); continue; }
    const cnt = (n.data?.assets || []).length;
    if (!cnt) fail(id, `requires 节点 ${r.nodeId} 没有任何素材（应放占位图）`);
  }
  // params.target 指向的节点必须存在
  for (const p of meta.params || []) {
    const tid = p?.target?.nodeId;
    if (tid && !byId.has(tid)) fail(id, `params.${p.key} 指向的节点 ${tid} 不存在`);
  }

  if (!failed) {
    console.log(`   ✅ ${nodes.length} 节点 / ${edges.length} 边 · 校验通过 · 素材 ${assetRefs.length} 个 · 参数 ${(meta.params || []).length} 个`);
  }
}

console.log(failed ? `\n❌ 共 ${failed} 个问题` : '\n✅ 全部模板通过');
process.exit(failed ? 1 : 0);
