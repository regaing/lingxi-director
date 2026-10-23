/**
 * 一次性迁移：workflows/*.json → SQLite。
 *
 * 旧版把 JSON 当唯一真相；改造后 DB 是唯一真相。
 * 迁移完成后把 JSON 挪进 workflows/_imported/ 作为只读备份，
 * 避免有人继续改它们却以为生效（改了也不会被读）。
 * 幂等：meta.json_migrated 一旦置位就跳过。
 */
import { mkdir, readdir, readFile, rename } from 'node:fs/promises';
import path from 'node:path';

export async function migrateJsonWorkflows({ db, store, dir, HttpError }) {
  const flag = db.get("SELECT value FROM meta WHERE key = 'json_migrated'");
  if (flag?.value === '1') return { skipped: true, imported: 0 };

  let files = [];
  try {
    files = (await readdir(dir)).filter((f) => f.endsWith('.json'));
  } catch {
    files = [];
  }

  const imported = [];
  for (const file of files) {
    const id = file.replace(/\.json$/, '');
    if (db.get('SELECT 1 AS ok FROM workflows WHERE id = ?', [id])) continue;
    try {
      const g = JSON.parse(await readFile(path.join(dir, file), 'utf8'));
      store.put(id, {
        name: g.name || id,
        nodes: Array.isArray(g.nodes) ? g.nodes : [],
        edges: Array.isArray(g.edges) ? g.edges : [],
      });
      imported.push(id);
    } catch (err) {
      console.warn(`  [migrate] 跳过无法解析的 ${file}：${err.message}`);
    }
  }

  if (files.length) {
    const backupDir = path.join(dir, '_imported');
    await mkdir(backupDir, { recursive: true });
    for (const file of files) {
      try { await rename(path.join(dir, file), path.join(backupDir, file)); } catch { /* 被占用就留原地 */ }
    }
  }

  db.run(
    "INSERT INTO meta (key, value) VALUES ('json_migrated', '1') ON CONFLICT(key) DO UPDATE SET value = '1'",
  );
  void HttpError;
  return { skipped: false, imported: imported.length, ids: imported, backup: files.length ? path.join(dir, '_imported') : null };
}
