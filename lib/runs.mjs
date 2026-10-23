/**
 * 运行记录存储：一次 run = 一行（节点状态 / 产物 / 错误整体存 JSON）。
 *
 * 为什么要落库：runner 的 run 对象只在内存 Map 里，刷新页面或重启服务后
 * 「上次跑到哪、出了什么错、视频在哪」全丢，用户只能去 downloads/ 翻文件。
 *
 * 保留策略：每个工作流只留最近 KEEP_PER_WF 条，save 之后顺手裁剪，
 * 避免 runs 表无限增长（每次运行都会写好几行节点状态）。
 */
import { nowIso } from './db.mjs';

const KEEP_PER_WF = 50;

const parse = (txt, dflt) => {
  try {
    const v = JSON.parse(txt || '');
    return v ?? dflt;
  } catch {
    return dflt;
  }
};

export function createRunStore({ db }) {
  /** 写库（upsert）。run 对象来自 runner，字段见 runner.start() */
  function save(run) {
    if (!run?.id || !run.wfId) return null;
    const at = nowIso();
    db.run(
      `INSERT INTO runs (id, wf_id, status, dry_run, single, order_json, nodes_json, outputs_json, error, started_at, ended_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
       ON CONFLICT(id) DO UPDATE SET
         status = excluded.status,
         order_json = excluded.order_json,
         nodes_json = excluded.nodes_json,
         outputs_json = excluded.outputs_json,
         error = excluded.error,
         ended_at = excluded.ended_at`,
      [
        run.id,
        run.wfId,
        String(run.status || 'running'),
        run.dryRun ? 1 : 0,
        run.single ? 1 : 0,
        JSON.stringify(run.order || []),
        JSON.stringify(run.nodes || {}),
        JSON.stringify(run.outputs || {}),
        run.error || null,
        run.startedAt || at,
        run.endedAt || null,
      ],
    );
    prune(run.wfId);
    return run;
  }

  function rowToRun(row) {
    if (!row) return null;
    return {
      id: row.id,
      wfId: row.wf_id,
      status: row.status,
      dryRun: Boolean(row.dry_run),
      single: Boolean(row.single),
      order: parse(row.order_json, []),
      nodes: parse(row.nodes_json, {}),
      outputs: parse(row.outputs_json, {}),
      error: row.error || null,
      startedAt: row.started_at || '',
      endedAt: row.ended_at || '',
      fromDb: true,
    };
  }

  function get(id) {
    return rowToRun(db.get('SELECT * FROM runs WHERE id = ?', [String(id)]));
  }

  /** 结果面板的历史下拉：最近 n 条（不含节点明细，省流量） */
  function listByWf(wfId, limit = 20) {
    const rows = db.all(
      'SELECT id, wf_id, status, dry_run, single, outputs_json, error, started_at, ended_at, order_json FROM runs WHERE wf_id = ? ORDER BY started_at DESC LIMIT ?',
      [String(wfId), Math.max(1, Math.min(100, Number(limit) || 20))],
    );
    return rows.map((row) => {
      const r = rowToRun(row);
      return {
        id: r.id,
        wfId: r.wfId,
        status: r.status,
        dryRun: r.dryRun,
        single: r.single,
        error: r.error,
        startedAt: r.startedAt,
        endedAt: r.endedAt,
        nodes: r.order.length,
        outputs: r.outputs,
      };
    });
  }

  /** 单次运行详情（含节点状态），用于刷新后恢复画布着色 */
  function detail(id) {
    const row = db.get('SELECT * FROM runs WHERE id = ?', [String(id)]);
    return rowToRun(row);
  }

  /** 每个工作流只留最近 KEEP_PER_WF 条 */
  function prune(wfId) {
    try {
      db.run(
        `DELETE FROM runs WHERE wf_id = ? AND id NOT IN (
           SELECT id FROM runs WHERE wf_id = ? ORDER BY started_at DESC LIMIT ?
         )`,
        [String(wfId), String(wfId), KEEP_PER_WF],
      );
    } catch { /* 裁剪失败不影响运行 */ }
  }

  return { save, get, detail, listByWf, prune, KEEP_PER_WF };
}
