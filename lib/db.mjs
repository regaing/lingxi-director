/**
 * SQLite 存储底座。
 *
 * 驱动：Node 内置 node:sqlite 的 DatabaseSync（本机 nvm 默认已切到 v24.16.0）。
 * 用法与 packages/core/src/memory/driver.ts 完全一致：
 *   db.exec(sql) / db.prepare(sql).get|all|run(...params)
 *
 * 对外收成一套最小接口，调用方不用每次自己 prepare：
 *   db.exec(sql) / db.get(sql, params) / db.all(sql, params) / db.run(sql, params) / db.close()
 *   db.run 返回 { changes, lastInsertRowid }
 *
 * 注意：node:sqlite 仍是实验特性，会往 stderr 打一行 ExperimentalWarning，
 * 这里只把这一条静音（其它警告照常抛），避免每次启动都刷日志。
 */
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';

const rawEmitWarning = process.emitWarning.bind(process);
process.emitWarning = (warning, ...rest) => {
  const msg = typeof warning === 'string' ? warning : warning?.message || '';
  if (/SQLite is an experimental feature/i.test(msg)) return;
  return rawEmitWarning(warning, ...rest);
};

export const SCHEMA_VERSION = 2;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS meta (
  key   TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS categories (
  id         TEXT PRIMARY KEY,
  name       TEXT NOT NULL,
  color      TEXT NOT NULL DEFAULT '',
  position   INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS workflows (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL DEFAULT '',
  category_id    TEXT REFERENCES categories(id) ON DELETE SET NULL,
  revision       INTEGER NOT NULL DEFAULT 0,
  schema_version INTEGER NOT NULL DEFAULT 1,
  graph          TEXT NOT NULL DEFAULT '{"nodes":[],"edges":[]}',
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_wf_category ON workflows(category_id);
CREATE INDEX IF NOT EXISTS idx_wf_updated  ON workflows(updated_at DESC);

CREATE TABLE IF NOT EXISTS notifications (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  kind       TEXT NOT NULL DEFAULT 'info',
  level      TEXT NOT NULL DEFAULT 'info',
  title      TEXT NOT NULL DEFAULT '',
  body       TEXT NOT NULL DEFAULT '',
  wf_id      TEXT,
  read       INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_notif_created ON notifications(created_at DESC);

/* 运行记录：刷新/重启后仍能回看每次 run 的节点状态与产物（每工作流只留最近 50 条） */
CREATE TABLE IF NOT EXISTS runs (
  id           TEXT PRIMARY KEY,
  wf_id        TEXT NOT NULL,
  status       TEXT NOT NULL DEFAULT 'running',
  dry_run      INTEGER NOT NULL DEFAULT 0,
  single       INTEGER NOT NULL DEFAULT 0,
  order_json   TEXT NOT NULL DEFAULT '[]',
  nodes_json   TEXT NOT NULL DEFAULT '{}',
  outputs_json TEXT NOT NULL DEFAULT '{}',
  error        TEXT,
  started_at   TEXT NOT NULL,
  ended_at     TEXT
);

CREATE INDEX IF NOT EXISTS idx_runs_wf ON runs(wf_id, started_at DESC);
`;
function nowIso() {
  return new Date().toISOString();
}

export function uid(prefix = '') {
  return `${prefix}${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`;
}

/** 参数统一成数组（允许调用方省略） */
const args = (params) => (params == null ? [] : Array.isArray(params) ? params : [params]);

function makeHandle(raw) {
  return {
    driver: 'node:sqlite',
    raw,
    exec: (sql) => raw.exec(sql),
    get: (sql, params) => raw.prepare(sql).get(...args(params)) ?? null,
    all: (sql, params) => raw.prepare(sql).all(...args(params)),
    run: (sql, params) => {
      const r = raw.prepare(sql).run(...args(params));
      return { changes: Number(r.changes || 0), lastInsertRowid: Number(r.lastInsertRowid || 0) };
    },
    close: () => raw.close(),
  };
}

/** 建表 + 版本落盘。schema 变更时升 SCHEMA_VERSION 并在此追加迁移分支。 */
function applySchema(db) {
  db.exec(SCHEMA);
  const row = db.get("SELECT value FROM meta WHERE key = 'schema_version'");
  const current = row ? Number(row.value) : 0;
  if (current !== SCHEMA_VERSION) {
    db.run(
      "INSERT INTO meta (key, value) VALUES ('schema_version', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      [String(SCHEMA_VERSION)],
    );
  }
}

export function openDb(file) {
  mkdirSync(path.dirname(file), { recursive: true });
  const db = makeHandle(new DatabaseSync(file));
  db.exec('PRAGMA foreign_keys = ON; PRAGMA journal_mode = WAL; PRAGMA busy_timeout = 5000; PRAGMA synchronous = NORMAL;');
  applySchema(db);
  return db;
}

/** 同步事务包装：fn 抛错就整体回滚 */
export function tx(db, fn) {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (err) {
    try { db.exec('ROLLBACK'); } catch { /* 回滚失败时保留原始错误 */ }
    throw err;
  }
}

export { nowIso };
