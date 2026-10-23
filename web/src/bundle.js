/**
 * 导入 / 导出（.zip）——前端只做两件事：
 *   - 导出：向服务端要一个 zip（`GET /api/export[?wfId=]`），存成文件
 *   - 导入：把 zip 原样 POST 给服务端（`POST /api/import`），服务端解包 + 落素材 + 建副本
 *
 * 打包 / 解包 / 素材改写都在 `lib/bundle.mjs`，前端不碰二进制，也不背 jszip。
 */

/** 导出成 zip。wfId 省略 = 全库导出 */
export async function fetchExportZip(wfId) {
  const res = await fetch(`/api/export${wfId ? `?wfId=${encodeURIComponent(wfId)}` : ''}`);
  if (!res.ok) {
    const data = await res.json().catch(() => ({}));
    throw new Error(data.message || `HTTP ${res.status}`);
  }
  return res.blob();
}

/** 文件名：中文标题直接用，只去掉路径/非法字符 */
export function safeFileName(name, fallback = 'workflow') {
  const s = String(name || '').replace(/[\\/:*?"<>|\r\n]+/g, '_').trim().slice(0, 80);
  return s || fallback;
}

export function saveBlob(blob, filename) {
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}

/**
 * 导入 zip。返回 { created: [{id, name}], missingAssets: string[] }。
 * 失败时抛的 Error 带 code（badZip / badMeta / empty），由 UI 翻译。
 */
export async function importZip(file) {
  const res = await fetch('/api/import', {
    method: 'POST',
    headers: { 'content-type': 'application/zip' },
    body: file,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    const err = new Error(data.message || `HTTP ${res.status}`);
    err.code = data.code;
    throw err;
  }
  return data;
}

export const isZip = (file) => /\.zip$/i.test(file?.name || '');
