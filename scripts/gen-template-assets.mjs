/**
 * 生成内置模板的占位素材（带文字）。
 *
 * 为什么是程序化生成而不是放真图：
 *   - 零版权风险（自己产）
 *   - 可复现（重跑一致）、可改（改色值即可）
 *   - 体积小（8–60KB）
 *   - **视觉上必须"明显是占位"**：AI 生成的漂亮产品图会让用户直接跑，
 *     拿到"不是我的产品"的视频还以为模板在正常工作。占位图的作用就是让人想换掉它。
 *
 * 字体跨平台：Windows 用微软雅黑，macOS 用 PingFang，Linux 用 Noto/DejaVu，
 * 找不到任何字体时退化为"无文字版"（只有几何图形），保证脚本不会硬失败。
 *
 * 用法：node scripts/gen-template-assets.mjs
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { existsSync, statSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const run = promisify(execFile);
const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');

const FONT_CANDIDATES = [
  'C:/Windows/Fonts/msyh.ttc',
  'C:/Windows/Fonts/msyhbd.ttc',
  'C:/Windows/Fonts/simhei.ttf',
  'C:/Windows/Fonts/segoeui.ttf',
  'C:/Windows/Fonts/arial.ttf',
  '/System/Library/Fonts/PingFang.ttc',
  '/System/Library/Fonts/Helvetica.ttc',
  '/usr/share/fonts/opentype/noto/NotoSansCJK-Regular.ttc',
  '/usr/share/fonts/truetype/dejavu/DejaVuSans.ttf',
];

const pickFont = () => FONT_CANDIDATES.find((f) => { try { return existsSync(f) && statSync(f).size > 0; } catch { return false; } }) || null;

/** ffmpeg 的 drawtext 里字体路径要把盘符冒号转义，否则被当参数分隔符 */
const escFont = (f) => f.replace(/\\/g, '/').replace(/^([A-Za-z]):/, '$1\\:');

/** drawtext 的 text 里冒号、单引号、反斜杠要转义 */
const escText = (s) => String(s).replace(/\\/g, '\\\\').replace(/:/g, '\\:').replace(/'/g, "\\'");

const drawText = (font, { text, size, color, x, y }) =>
  `drawtext=fontfile='${escFont(font)}':text='${escText(text)}':fontcolor=${color}:fontsize=${size}:x=${x}:y=${y}`;

async function ffmpeg(args) {
  const bin = (await import('@ffmpeg-installer/ffmpeg')).default.path;
  await run(bin, ['-hide_banner', '-loglevel', 'error', ...args]);
}

/**
 * 产品占位：深灰底 + 淡紫方块轮廓 + 双行文字
 * 1024×1024，宽高比 1.0（在 0.4–2.5 内）
 */
async function productPlaceholder(file, font) {
  const filters = [
    // 方块填充（很淡）+ 描边
    'drawbox=x=292:y=252:w=440:h=440:color=0x7c6cf0@0.14:t=fill',
    'drawbox=x=292:y=252:w=440:h=440:color=0x7c6cf0@0.85:t=6',
  ];
  if (font) {
    filters.push(drawText(font, { text: '占位素材 PLACEHOLDER', size: 62, color: '0xd4d4e0', x: '(w-tw)/2', y: '738' }));
    filters.push(drawText(font, { text: '换成你的产品图', size: 46, color: '0xa8a8bc', x: '(w-tw)/2', y: '820' }));
  }
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x2b2b3a:s=1024x1024', '-vf', filters.join(','), '-frames:v', '1', '-y', file]);
}

/**
 * 背景占位：深底 + 极淡网格 + 双行文字
 * 1920×1080，宽高比 1.78
 */
async function backdropPlaceholder(file, font) {
  const filters = ['drawgrid=w=160:h=160:t=1:c=0xffffff@0.05'];
  if (font) {
    filters.push(drawText(font, { text: '占位背景 PLACEHOLDER', size: 68, color: '0xc9c9d6', x: '(w-tw)/2', y: '(h-th)/2-60' }));
    filters.push(drawText(font, { text: '换成你的背景图', size: 48, color: '0x8a8a9a', x: '(w-tw)/2', y: '(h-th)/2+50' }));
  }
  await ffmpeg(['-f', 'lavfi', '-i', 'color=c=0x1a1a26:s=1920x1080', '-vf', filters.join(','), '-frames:v', '1', '-y', file]);
}

/* product-ad-360 的素材已换成真实示例图 product-sample.jpg（人工维护），
 * 不再由本脚本生成——否则重跑会把人家换进去的图盖回灰框。 */
const TARGETS = [
  { file: path.join(ROOT, 'templates/talking-head-loop/assets/backdrop-placeholder.png'), make: backdropPlaceholder },
];

/** 默认不覆盖已存在的文件；要重生就 `node scripts/gen-template-assets.mjs --force` */
const FORCE = process.argv.includes('--force');

const font = pickFont();
if (!font) console.warn('⚠ 未找到任何字体，将生成无文字版占位图');
else console.log('字体:', font);

for (const { file, make } of TARGETS) {
  mkdirSync(path.dirname(file), { recursive: true });
  if (!FORCE && existsSync(file)) {
    console.log(`跳过（已存在，加 --force 才覆盖）：${path.relative(ROOT, file)}`);
    continue;
  }
  await make(file, font);
  const size = existsSync(file) ? statSync(file).size : 0;
  console.log(`${size ? '✅' : '❌'} ${path.relative(ROOT, file)}  ${(size / 1024).toFixed(1)}KB`);
}
