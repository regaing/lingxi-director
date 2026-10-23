/**
 * 通知中心存储：header 右侧铃铛的数据源。
 *
 * 只存轻量文本（kind / level / title / body / wfId），不存图和大字段。
 * 保留最近 200 条，插入时顺手裁掉更老的，避免表无限长。
 */
import { nowIso } from './db.mjs';

const MAX_ROWS = 200;

export function createNotificationStore({ db }) {
  function add({ kind = 'info', level = 'info', title = '', body = '', wfId = null } = {}) {
    const at = nowIso();
    const res = db.run(
      'INSERT INTO notifications (kind, level, title, body, wf_id, read, created_at) VALUES (?, ?, ?, ?, ?, 0, ?)',
      [String(kind), String(level), String(title || '').slice(0, 300), String(body || '').slice(0, 2000), wfId, at],
    );
    db.run(`DELETE FROM notifications WHERE id NOT IN (SELECT id FROM notifications ORDER BY id DESC LIMIT ${MAX_ROWS})`);
    return { id: res.lastInsertRowid, kind, level, title, body, wfId, read: 0, createdAt: at };
  }

  function list({ limit = 50 } = {}) {
    const rows = db.all('SELECT * FROM notifications ORDER BY id DESC LIMIT ?', [Math.max(1, Math.min(200, Number(limit) || 50))]);
    const unread = db.get('SELECT COUNT(*) AS n FROM notifications WHERE read = 0')?.n || 0;
    return {
      items: rows.map((r) => ({
        id: r.id,
        kind: r.kind,
        level: r.level,
        title: r.title,
        body: r.body,
        wfId: r.wf_id || null,
        read: Boolean(r.read),
        createdAt: r.created_at,
      })),
      unread,
    };
  }

  /** ids 省略 / 传 'all' → 全部标记已读 */
  function markRead(ids) {
    if (ids === 'all' || ids == null) db.run('UPDATE notifications SET read = 1 WHERE read = 0');
    else {
      for (const id of ids) db.run('UPDATE notifications SET read = 1 WHERE id = ?', [Number(id)]);
    }
    return { ok: true, unread: db.get('SELECT COUNT(*) AS n FROM notifications WHERE read = 0')?.n || 0 };
  }

  function clear({ onlyRead = false } = {}) {
    if (onlyRead) db.run('DELETE FROM notifications WHERE read = 1');
    else db.run('DELETE FROM notifications');
    return { ok: true };
  }

  return { add, list, markRead, clear };
}
