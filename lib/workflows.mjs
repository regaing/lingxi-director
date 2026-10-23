/**
 * 工作流 / 分类存储 —— SQLite 是唯一真相（data/workbench.db）。
 *
 * 图结构整体存进 workflows.graph（JSON 文本）：节点/连线只在画布侧用到，
 * 不做关系化拆分，省掉一堆 join，也方便整图导出。
 * revision 乐观锁：冲突一律 409，不许静默覆盖。
 *
 * 外部 AI 改图的入口只剩 HTTP（PUT /api/workflow/:id 或 POST .../patch）；
 */
import { tx, uid, nowIso } from './db.mjs';

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const CATEGORY_COLORS = ['#7c6cf0', '#3f8fe0', '#2f9e8f', '#d99b3c', '#e0503f', '#c264c9', '#4f9d69', '#8a7cc9'];

function parseGraph(row) {
  let nodes = [];
  let edges = [];
  try {
    const g = JSON.parse(row.graph || '{}');
    nodes = Array.isArray(g.nodes) ? g.nodes : [];
    edges = Array.isArray(g.edges) ? g.edges : [];
  } catch { /* 坏图当空图，列表不阻塞 */ }
  return { nodes, edges };
}

function toSummary(row) {
  const { nodes, edges } = parseGraph(row);
  return {
    id: row.id,
    name: row.name || '',
    categoryId: row.category_id || null,
    revision: row.revision || 0,
    updatedAt: row.updated_at || '',
    createdAt: row.created_at || '',
    nodes: nodes.length,
    edges: edges.length,
  };
}

export function createWorkflowStore({ db, HttpError }) {
  function assertId(id) {
    if (!ID_RE.test(String(id || ''))) throw new HttpError(400, `非法的 workflow id：${id}`);
  }

  function rowOf(id) {
    assertId(id);
    return db.get('SELECT * FROM workflows WHERE id = ?', [id]);
  }

  /* ── 工作流 ── */

  function list({ categoryId = undefined } = {}) {
    const rows = categoryId === undefined
      ? db.all('SELECT * FROM workflows ORDER BY updated_at DESC')
      : categoryId === null || categoryId === 'none' || categoryId === ''
        ? db.all('SELECT * FROM workflows WHERE category_id IS NULL ORDER BY updated_at DESC')
        : db.all('SELECT * FROM workflows WHERE category_id = ? ORDER BY updated_at DESC', [categoryId]);
    return rows.map(toSummary);
  }

  function get(id) {
    const row = rowOf(id);
    if (!row) throw new HttpError(404, `工作流不存在：${id}`);
    const { nodes, edges } = parseGraph(row);
    return {
      id: row.id,
      name: row.name || '',
      categoryId: row.category_id || null,
      schemaVersion: row.schema_version || 1,
      revision: row.revision || 0,
      createdAt: row.created_at || '',
      updatedAt: row.updated_at || '',
      nodes,
      edges,
    };
  }

  /** 整体替换。expectedRevision 给了就做乐观锁校验。 */
  function put(id, graph, { expectedRevision = null } = {}) {
    assertId(id);
    return tx(db, () => {
      const prev = db.get('SELECT revision, created_at FROM workflows WHERE id = ?', [id]);
      const prevRev = prev ? prev.revision || 0 : 0;
      if (expectedRevision != null && Number(expectedRevision) !== prevRev) {
        throw new HttpError(409, `版本冲突：当前 revision=${prevRev}，你基于 ${expectedRevision} 提交，请重新载入`);
      }

      const g = graph || {};
      const name = String(g.name ?? '').slice(0, 200);
      const categoryId = g.categoryId === undefined ? undefined : (g.categoryId || null);
      if (categoryId) {
        const cat = db.get('SELECT id FROM categories WHERE id = ?', [categoryId]);
        if (!cat) throw new HttpError(400, `分类不存在：${categoryId}`);
      }
      const payload = JSON.stringify({
        nodes: Array.isArray(g.nodes) ? g.nodes : [],
        edges: Array.isArray(g.edges) ? g.edges : [],
      });
      const at = nowIso();

      if (prev) {
        db.run(
          `UPDATE workflows
              SET name = ?, revision = ?, graph = ?, updated_at = ?
                  ${categoryId === undefined ? '' : ', category_id = ?'}
            WHERE id = ?`,
          categoryId === undefined
            ? [name, prevRev + 1, payload, at, id]
            : [name, prevRev + 1, payload, at, categoryId, id],
        );
      } else {
        db.run(
          'INSERT INTO workflows (id, name, category_id, revision, schema_version, graph, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)',
          [id, name, categoryId ?? null, 1, 1, payload, at, at],
        );
      }
      return get(id);
    });
  }

  function remove(id) {
    assertId(id);
    db.run('DELETE FROM workflows WHERE id = ?', [id]);
    return { ok: true, id };
  }

  /** 批量改归属（首页多选移动用） */
  function moveToCategory(ids, categoryId) {
    const list = (ids || []).filter((x) => ID_RE.test(String(x || '')));
    const target = categoryId || null;
    if (target) {
      const cat = db.get('SELECT id FROM categories WHERE id = ?', [target]);
      if (!cat) throw new HttpError(400, `分类不存在：${target}`);
    }
    return tx(db, () => {
      const at = nowIso();
      for (const id of list) db.run('UPDATE workflows SET category_id = ?, updated_at = ? WHERE id = ?', [target, at, id]);
      return { ok: true, moved: list.length, categoryId: target };
    });
  }

  /** 语义化增量操作 —— 比 JSON Patch 更适合 AI 生成 */
  function patch(id, ops, opts = {}) {
    const g = get(id);
    const nodes = [...(g.nodes || [])];
    const edges = [...(g.edges || [])];
    const applied = [];

    for (const [i, op] of (ops || []).entries()) {
      const at = `ops[${i}] ${op?.op}`;
      switch (op?.op) {
        case 'add_node': {
          if (!op.node?.id || !op.node?.type) throw new HttpError(400, `${at}: node.id / node.type 必填`);
          if (nodes.some((n) => n.id === op.node.id)) throw new HttpError(400, `${at}: 节点已存在 ${op.node.id}`);
          // 没给坐标（或给了 0,0）就自动错开排布。界面拖拽总会带真实坐标，
          // 这条兜底是给 API / AI 改流程用的 —— 否则新节点全叠在原点，画布上根本认不出谁是谁。
          const { position: rawPos, ...rest } = op.node;
          const given = rawPos && (Number(rawPos.x) || Number(rawPos.y));
          const auto = { x: 80 + (nodes.length % 4) * 340, y: 120 + Math.floor(nodes.length / 4) * 240 };
          nodes.push({ data: {}, ...rest, position: given ? rawPos : auto });
          break;
        }
        case 'update_node': {
          const k = nodes.findIndex((n) => n.id === op.id);
          if (k < 0) throw new HttpError(400, `${at}: 节点不存在 ${op.id}`);
          nodes[k] = { ...nodes[k], data: { ...nodes[k].data, ...(op.data || {}) } };
          break;
        }
        case 'remove_node': {
          const k = nodes.findIndex((n) => n.id === op.id);
          if (k < 0) throw new HttpError(400, `${at}: 节点不存在 ${op.id}`);
          nodes.splice(k, 1);
          for (let j = edges.length - 1; j >= 0; j--) {
            if (edges[j].source === op.id || edges[j].target === op.id) edges.splice(j, 1);
          }
          break;
        }
        case 'connect': {
          if (!nodes.some((n) => n.id === op.source)) throw new HttpError(400, `${at}: source 不存在 ${op.source}`);
          if (!nodes.some((n) => n.id === op.target)) throw new HttpError(400, `${at}: target 不存在 ${op.target}`);
          if (op.source === op.target) throw new HttpError(400, `${at}: 不允许自连`);
          const dup = edges.some(
            (e) => e.source === op.source && e.target === op.target &&
              e.sourceHandle === op.sourceHandle && e.targetHandle === op.targetHandle
          );
          if (dup) break;
          edges.push({
            id: `e_${Date.now().toString(36)}_${edges.length}`,
            source: op.source, sourceHandle: op.sourceHandle ?? null,
            target: op.target, targetHandle: op.targetHandle ?? null,
          });
          break;
        }
        case 'disconnect': {
          const k = edges.findIndex((e) => e.id === op.edgeId);
          if (k < 0) throw new HttpError(400, `${at}: 连线不存在 ${op.edgeId}`);
          edges.splice(k, 1);
          break;
        }
        default:
          throw new HttpError(400, `${at}: 不支持的操作`);
      }
      applied.push(op.op);
    }

    return put(id, { ...g, nodes, edges }, opts);
  }

  /* ── 分类 ── */

  function listCategories() {
    const rows = db.all('SELECT * FROM categories ORDER BY position ASC, created_at ASC');
    const counts = new Map(
      db.all('SELECT category_id AS cid, COUNT(*) AS n FROM workflows GROUP BY category_id')
        .map((r) => [r.cid || 'none', r.n]),
    );
    const total = db.get('SELECT COUNT(*) AS n FROM workflows')?.n || 0;
    return {
      items: rows.map((r) => ({
        id: r.id,
        name: r.name,
        color: r.color || CATEGORY_COLORS[0],
        position: r.position || 0,
        count: counts.get(r.id) || 0,
        createdAt: r.created_at,
        updatedAt: r.updated_at,
      })),
      uncategorized: counts.get('none') || 0,
      total,
    };
  }

  function createCategory({ name, color } = {}) {
    const clean = String(name || '').trim().slice(0, 60);
    if (!clean) throw new HttpError(400, '分类名不能为空');
    const maxPos = db.get('SELECT COALESCE(MAX(position), -1) AS p FROM categories')?.p ?? -1;
    const id = uid('cat_');
    const at = nowIso();
    const pick = color || CATEGORY_COLORS[(maxPos + 1) % CATEGORY_COLORS.length];
    db.run(
      'INSERT INTO categories (id, name, color, position, created_at, updated_at) VALUES (?, ?, ?, ?, ?, ?)',
      [id, clean, pick, maxPos + 1, at, at],
    );
    return { id, name: clean, color: pick, position: maxPos + 1, count: 0, createdAt: at, updatedAt: at };
  }

  function updateCategory(id, patchBody = {}) {
    const row = db.get('SELECT * FROM categories WHERE id = ?', [id]);
    if (!row) throw new HttpError(404, `分类不存在：${id}`);
    const name = patchBody.name === undefined ? row.name : String(patchBody.name).trim().slice(0, 60);
    if (!name) throw new HttpError(400, '分类名不能为空');
    const color = patchBody.color === undefined ? row.color : String(patchBody.color).slice(0, 32);
    const position = patchBody.position === undefined ? row.position : Number(patchBody.position) || 0;
    db.run('UPDATE categories SET name = ?, color = ?, position = ?, updated_at = ? WHERE id = ?', [name, color, position, nowIso(), id]);
    const fresh = db.get('SELECT * FROM categories WHERE id = ?', [id]);
    const count = db.get('SELECT COUNT(*) AS n FROM workflows WHERE category_id = ?', [id])?.n || 0;
    return { id: fresh.id, name: fresh.name, color: fresh.color, position: fresh.position, count };
  }

  /** 删除分类：工作流不删，只回落到「未分类」（FK 是 ON DELETE SET NULL，这里显式做一遍更直观） */
  function removeCategory(id) {
    const row = db.get('SELECT * FROM categories WHERE id = ?', [id]);
    if (!row) throw new HttpError(404, `分类不存在：${id}`);
    return tx(db, () => {
      const freed = db.run('UPDATE workflows SET category_id = NULL WHERE category_id = ?', [id])?.changes || 0;
      db.run('DELETE FROM categories WHERE id = ?', [id]);
      return { ok: true, id, freed };
    });
  }

  /**
   * 拖拽排序：按传入 id 顺序重写 position。
   * 没被传入的分类顺延到末尾 —— 否则它会保留旧 position 与列表里的某个并列，
   * 最终只能靠 created_at 兜底，看起来就像「拖了没反应」。
   */
  function reorderCategories(ids) {
    const list = (Array.isArray(ids) ? ids : []).filter(Boolean);
    return tx(db, () => {
      const at = nowIso();
      list.forEach((id, i) => {
        db.run('UPDATE categories SET position = ?, updated_at = ? WHERE id = ?', [i, at, id]);
      });
      const known = new Set(list);
      const leftovers = db.all('SELECT id FROM categories ORDER BY position ASC, created_at ASC')
        .map((r) => r.id)
        .filter((id) => !known.has(id));
      leftovers.forEach((id, j) => {
        db.run('UPDATE categories SET position = ?, updated_at = ? WHERE id = ?', [list.length + j, at, id]);
      });
      return listCategories();
    });
  }

  return {
    list, get, put, remove, patch, moveToCategory,
    listCategories, createCategory, updateCategory, removeCategory, reorderCategories,
    CATEGORY_COLORS,
  };
}
