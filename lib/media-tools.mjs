/**
 * 媒体工具层：抽帧 / 探针 / 加边 / 拼接。
 *
 * 二进制走 npm 分发（`@ffmpeg-installer/ffmpeg`、`@ffprobe-installer/ffprobe`），
 * 用户 `npm install` 即可，不需要在系统里单独装 ffmpeg —— 这是开源项目的硬要求。
 *
 * 两个包都用**动态 import + 懒加载**：没装（或装了但平台包缺失）时不影响服务启动，
 * 只有真正用到这几个节点的运行才会报错，报错里直接告诉用户跑 npm install。
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { mkdir, rm, readFile, writeFile, copyFile, stat } from 'node:fs/promises';
import { createWriteStream } from 'node:fs';
import { Readable } from 'node:stream';
import { pipeline } from 'node:stream/promises';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import os from 'node:os';
import { randomUUID } from 'node:crypto';

const run = promisify(execFile);

/** 网关素材宽高比的合法窗口（与 PROVIDER.imageRatioMin/Max 保持一致） */
export const IMAGE_RATIO_MIN = 0.4;
export const IMAGE_RATIO_MAX = 2.5;

/** CJS 包用 require 加载：这两个二进制包没有 ESM 出口 */
const require = createRequire(import.meta.url);
let binCache;

/**
 * 解析二进制路径；返回 null 表示这个环境不可用（调用方负责报可读的错误）。
 *
 * 用 createRequire 同步加载而不是 await import()：这两个包都是纯 CJS，
 * 走 ESM 动态 import 会在 runner 的异步执行流里卡住（实测节点一直停在 running），
 * 同步 require 没有这个坑，也省掉一次微任务往返。
 */
export function resolveBinaries() {
  if (binCache !== undefined) return binCache;
  try {
    const ff = require('@ffmpeg-installer/ffmpeg');
    const fp = require('@ffprobe-installer/ffprobe');
    binCache = { ffmpeg: ff.path, ffprobe: fp.path };
  } catch {
    binCache = null;
  }
  return binCache;
}

export function requireBinaries() {
  const bins = resolveBinaries();
  if (!bins) {
    throw new Error('缺少 ffmpeg：请运行 npm install（需 @ffmpeg-installer/ffmpeg 与 @ffprobe-installer/ffprobe）');
  }
  return bins;
}

/** 建一个独立临时目录，用完必须清掉 */
export async function makeWorkDir(tag = 'media') {
  const dir = path.join(os.tmpdir(), `wb-${tag}-${randomUUID().slice(0, 8)}`);
  await mkdir(dir, { recursive: true });
  return dir;
}

export async function cleanDir(dir) {
  if (!dir) return;
  try { await rm(dir, { recursive: true, force: true }); } catch { /* 清理失败不影响主流程 */ }
}

/**
 * URL → 本地路径。
 * `file:///W:/x` 这种三斜杠要用 fileURLToPath 才处理得对；
 * 自己 replace 会留下 `/W:/x`，再被 path 拼一次就成了 W:\W:\x（踩过）。
 */
export function toLocalPath(url) {
  const s = String(url ?? '');
  if (/^file:\/\//i.test(s)) {
    try { return fileURLToPath(s); } catch { return s.replace(/^file:\/\/+/, ''); }
  }
  return s;
}

/**
 * 把远端产物抓到本地临时文件。
 * 网关给的视频链接是带签名的 https，抽帧/探针都要求本地可读文件。
 */
export async function downloadTo(url, file) {
  if (!/^https?:\/\//i.test(String(url))) {
    // 已经是本地路径（例如拼接节点产出的文件）
    await copyFile(toLocalPath(url), file);
    return file;
  }
  const res = await fetch(url);
  if (!res.ok) throw new Error(`下载素材失败 ${res.status}`);
  await mkdir(path.dirname(file), { recursive: true });
  await pipeline(Readable.fromWeb(res.body), createWriteStream(file));
  return file;
}

/** 探针：宽高 / 时长 / 体积 / 帧率 */
export async function probe(file) {
  const { ffprobe } = await requireBinaries();
  const { stdout } = await run(ffprobe, [
    '-v', 'error', '-select_streams', 'v:0',
    '-show_entries', 'stream=width,height,r_frame_rate:format=duration,size',
    '-of', 'json', file,
  ]);
  const j = JSON.parse(stdout || '{}');
  const s = j.streams?.[0] || {};
  const width = Number(s.width) || 0;
  const height = Number(s.height) || 0;
  const [num, den] = String(s.r_frame_rate || '0/1').split('/').map(Number);
  return {
    width,
    height,
    duration: Number(j.format?.duration) || 0,
    size: Number(j.format?.size) || 0,
    fps: den ? num / den : 0,
    ratio: height ? width / height : 0,
  };
}

/**
 * 抽一帧，返回 JPEG Buffer。
 * position: first | last | at（at 用 atSec）
 */
export async function extractFrame(file, { position = 'last', atSec = 0, quality = 3 } = {}) {
  const { ffmpeg } = await requireBinaries();
  const dir = await makeWorkDir('frame');
  const out = path.join(dir, 'frame.jpg');
  // -q:v 2 最清晰，31 最糊；缩略场景 3~5 足够，体积还小
  const q = String(Math.min(31, Math.max(2, Number(quality) || 3)));
  const args = ['-y'];
  if (position === 'last') {
    // 从末尾倒推 0.15s：直接 -ss duration 常落在最后一帧之后，取空
    args.push('-sseof', '-0.15');
  } else if (position === 'at') {
    args.push('-ss', String(Math.max(0, Number(atSec) || 0)));
  } else {
    args.push('-ss', '0');
  }
  args.push('-i', file, '-frames:v', '1', '-q:v', q, out);
  try {
    await run(ffmpeg, args);
    return await readFile(out);
  } finally {
    await cleanDir(dir);
  }
}

/**
 * 把超范围比例补边拉回 [0.4, 2.5]。
 * 先探针拿到真实尺寸、在 JS 里算目标画布，比在 filter 里塞表达式好调试。
 * 已合法的图原样返回（不重编码，避免无谓的画质损失）。
 */
export async function fitImage(file, { min = IMAGE_RATIO_MIN, max = IMAGE_RATIO_MAX, color = 'black' } = {}) {
  const info = await probe(file);
  const { width: w, height: h } = info;
  if (!w || !h) throw new Error('无法读取图片尺寸');
  if (info.ratio >= min && info.ratio <= max) {
    return { buffer: await readFile(file), info, padded: false, size: [w, h] };
  }
  const { ffmpeg } = await requireBinaries();
  const dir = await makeWorkDir('fit');
  const out = path.join(dir, 'fit.png');
  let tw = w;
  let th = h;
  if (info.ratio < min) tw = Math.ceil((h * min) / 2) * 2;   // 太窄 → 左右补边
  else th = Math.ceil(w / max / 2) * 2;                       // 太宽 → 上下补边
  const safeColor = /^[a-zA-Z]+$|^#[0-9a-fA-F]{3,8}$/.test(String(color)) ? color : 'black';
  try {
    await run(ffmpeg, ['-y', '-i', file, '-vf',
      `pad=${tw}:${th}:(ow-iw)/2:(oh-ih)/2:color=${safeColor}`, out]);
    return { buffer: await readFile(out), info, padded: true, size: [tw, th], from: [w, h] };
  } finally {
    await cleanDir(dir);
  }
}

/**
 * 按顺序拼接多段视频。
 * 先试 -c copy（无损、极快）；段间参数不一致时回退重编码。
 */
export async function concatVideos(files, outFile) {
  const { ffmpeg } = await requireBinaries();
  if (!files.length) throw new Error('没有可拼接的视频');
  const dir = await makeWorkDir('concat');
  const absOut = path.resolve(outFile);
  try {
    const local = [];
    for (let i = 0; i < files.length; i += 1) {
      const p = path.join(dir, `seg${i}.mp4`);
      await downloadTo(files[i], p);
      local.push(path.basename(p));
    }
    await writeFile(path.join(dir, 'list.txt'), local.map((f) => `file '${f}'`).join('\n') + '\n', 'utf8');
    // 关键：清单里写的是相对文件名，而这个 build 的 concat **按进程 cwd 解析**相对路径，
    // 不是按清单所在目录（与文档描述不符，实测踩过）。所以让 ffmpeg 直接在分片目录里跑。
    const base = ['-y', '-f', 'concat', '-safe', '0', '-i', 'list.txt'];
    const opts = { cwd: dir };
    await mkdir(path.dirname(absOut), { recursive: true });
    try {
      await run(ffmpeg, [...base, '-c', 'copy', absOut], opts);
    } catch {
      // 分辨率/编码不一致时 copy 会失败，退回重编码（慢但一定能拼）
      await run(ffmpeg, [...base, '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '20',
        '-c:a', 'aac', '-b:a', '128k', absOut], { ...opts, maxBuffer: 1024 * 1024 * 32 });
    }
    return { file: absOut, size: (await stat(absOut)).size };
  } finally {
    await cleanDir(dir);
  }
}

/** data URI → 临时文件（ffmpeg 只认文件路径，不认 base64） */
export async function dataUriToFile(dataUri, file) {
  const m = /^data:([^;,]+)?(;base64)?,([\s\S]*)$/.exec(String(dataUri));
  if (!m) throw new Error('不是合法的 data URI');
  const [, , isB64, payload] = m;
  const buf = isB64 ? Buffer.from(payload, 'base64') : Buffer.from(decodeURIComponent(payload), 'utf8');
  await mkdir(path.dirname(file), { recursive: true });
  await writeFile(file, buf);
  return file;
}

/** Buffer → data URI（塞进请求体用） */
export function toDataUri(buffer, mime = 'image/jpeg') {
  return `data:${mime};base64,${buffer.toString('base64')}`;
}
