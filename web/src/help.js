/**
 * 节点使用说明（面板里「使用说明」折叠条的内容）。
 *
 * 为什么单独一个文件、不塞进 i18n 字典：
 * 20 个节点 × 中英 × 三段文本，篇幅远超普通 UI 文案，塞进字典会把它撑爆。
 * 同理 presets.js。i18n 只留「使用说明 / 它能做什么」这类界面标签。
 *
 * 与 graph/model.js 里的 `doc` 字段是**两套东西**，别混：
 *   doc  → 投影给 LLM 的英文硬约束，写"必须满足什么"，越短越好
 *   NODE_HELP → 给人看的中文说明，写"怎么填、怎么连、容易错在哪"
 *
 * 四段结构固定：what（做什么）→ how（怎么填）→ example（例子，可省）→ wire（怎么连）
 * how 里用 \n 分行，渲染时拆成列表。
 */

const h = (what, how, wire, example = '') => ({ what, how, wire, example });

export const NODE_HELP = {
  'text.prompt': {
    zh: h(
      '你要的画面，用自然语言写。这是最终送进模型的正文。',
      '写得具体一些：主体 + 动作 + 镜头运动 + 光线 + 风格。\n需要一条流程跑多个主题时，把会变的部分写成 {{名字}}，再挂一个「文本变量」节点去替换。',
      '下游接「视频生成」的文本输入。\n不想要的画面别写在这里，用「负向词」节点单独挂——它会自动并到正文末尾。',
      'A cozy wooden desk by a rainy window, steam rising from a white mug.\nSlow push-in, soft morning light, cinematic.',
    ),
    en: h(
      'The visual you want, in plain language. This is the body text sent to the model.',
      'Be specific: subject + action + camera move + lighting + style.\nTo reuse one flow for several topics, write the variable parts as {{name}} and feed them from a Variables node.',
      'Wire into the Text input of a Generate node.\nDo not put unwanted things here — use a Negative node instead; it merges into the end of the same text.',
      'A cozy wooden desk by a rainy window, steam rising from a white mug.\nSlow push-in, soft morning light, cinematic.',
    ),
  },

  'text.negative': {
    zh: h(
      '你不想看到的东西，会被拼到正文最后一起送进模型。',
      '用逗号分隔的短语，不要写完整句子。\n只写要避免的，不要重复正文里已有的内容。',
      '必须**直接**连到「视频生成」的文本输入，和正文并排连。\n经过「文本合并」会丢掉负向标记，那样就变成普通正文了。',
      'blurry, watermark, text, extra fingers, distorted hands',
    ),
    en: h(
      'Things you do not want. Appended to the end of the prompt.',
      'Comma-separated phrases, not full sentences.\nOnly list what to avoid; do not repeat the positive prompt.',
      'Wire **directly** into the Text input of a Generate node, side by side with the prompt.\nGoing through a Text Merge node drops the negative marker and it becomes ordinary text.',
      'blurry, watermark, text, extra fingers, distorted hands',
    ),
  },

  'media.image': {
    zh: h(
      '上传图片，作为首帧、尾帧或参考图。',
      '单张图的宽高比必须在 0.4–2.5 之间，超了上传时就会被拦。\n最容易超的是竖排立绘长条和横向多视图长截图——先在图片软件里裁一下，或接「图片比例修正」。',
      '下游接「视频生成」的图片输入。\n首帧/尾帧与参考图**互斥**：同一轮不能既挂首帧又挂参考图。',
    ),
    en: h(
      'Upload images as first frame, last frame or reference.',
      'Each image must have an aspect ratio between 0.4 and 2.5, otherwise the upload is rejected.\nTall character sheets and wide multi-view screenshots are the usual offenders — crop them, or route through Image Fit.',
      'Wire into the Image input of a Generate node.\nFrames and references are **mutually exclusive** in the same request.',
    ),
  },

  'media.video': {
    zh: h(
      '参考视频，模型会参考它的运动和风格。',
      '视频以 base64 塞进请求体，长视频会让请求体变得很大（上限 200MB）。\n尽量用短片段；更长的素材建议改成公网 URL。',
      '下游接「视频生成」的视频输入。',
    ),
    en: h(
      'Reference video; the model follows its motion and style.',
      'Videos go into the request body as base64, so long clips make the body huge (200MB cap).\nKeep clips short; use a public URL for anything longer.',
      'Wire into the Video input of a Generate node.',
    ),
  },

  'media.audio': {
    zh: h(
      '参考音频。',
      '音频输入不计费，可以放心挂。',
      '下游接「视频生成」的音频输入。',
    ),
    en: h(
      'Reference audio.',
      'Audio input is not billed.',
      'Wire into the Audio input of a Generate node.',
    ),
  },

  'param.video': {
    zh: h(
      '一条参数线，把时长、分辨率、比例、水印同时喂给生成节点。',
      '时长范围随分辨率变化：480p ~ 1080p 是 4–30 秒，2K 只有 4–15 秒。\n比例必须选一个具体值，没有「自适应」这一项（网关不认，会报 2013）。',
      '四个输出分别连到「视频生成」对应的四个输入。\n多个生成节点可以共用同一个参数节点，不用各连一份。',
    ),
    en: h(
      'One parameter line that feeds duration, resolution, ratio and watermark to a Generate node.',
      'Duration range depends on resolution: 4–30s for 480p–1080p, only 4–15s for 2K.\nRatio must be an explicit value — there is no "adaptive" (the gateway rejects it with 2013).',
      'Wire its four outputs into the four matching inputs of a Generate node.\nSeveral Generate nodes can share one Params node.',
    ),
  },

  'task.source': {
    zh: h(
      '填一个已有任务的 ID，作为再生成的来源。',
      '32 位数字 ID。在「等待完成」节点的产物里能看到上一个任务的 ID。',
      '下游接「视频再生成」的任务 ID 输入。',
    ),
    en: h(
      'An existing task id, used as the source for regeneration.',
      'A 32-digit id. You can read it from the output of a Watch node.',
      'Wire into the Task ID input of a Regenerate node.',
    ),
  },

  'gen.video': {
    zh: h(
      '真正提交一次生成任务。花钱的就是这个节点。',
      '本身没有参数，全靠上游喂。\n文本必须有；时长和分辨率必须从「视频参数」连过来，缺了会直接报错停下。',
      '输出的是任务 ID，**必须**接「等待完成」——只有它会产出视频链接。\n直接接预览或下载是接不上的。',
    ),
    en: h(
      'Submits one generation task. This is the node that costs money.',
      'It has no fields of its own; everything comes from upstream.\nText is required; duration and resolution must come from a Params node or it stops with an error.',
      'Its output is a task id and **must** go into a Watch node — only Watch emits the video URL.\nWiring it straight into Preview or Download will not work.',
    ),
  },

  'gen.context': {
    zh: h(
      '上下文理解任务，让模型先读懂一段文字。',
      '只接受文本。连图片或时长进去会被网关打回 400。',
      '输出也是任务 ID，接「等待完成」取结果。',
    ),
    en: h(
      'Context understanding task; the model reads a block of text first.',
      'Text only. Wiring images or duration into it returns 400.',
      'Its output is a task id too; wire it into Watch.',
    ),
  },

  'gen.regen': {
    zh: h(
      '拿已有任务或一段文本，重新生成一次。',
      '任务 ID 和文本**只能给一个**，两个都给会报错。\n分辨率固定 2K，不用传时长（传了也没用）。',
      '输出是任务 ID，接「等待完成」。',
    ),
    en: h(
      'Regenerates from an existing task or from text.',
      'Give **either** a task id **or** text, never both.\nResolution is fixed at 2K and duration is not used.',
      'Its output is a task id; wire it into Watch.',
    ),
  },

  'task.watch': {
    zh: h(
      '轮询任务直到出结果，产出视频链接。所有生成任务都必须过这一关。',
      '轮询间隔默认 4 秒，填得越小请求越频繁。\n超时默认 45 分钟。任务失败会直接报错，同时自动退款。',
      '上游接「视频生成」的任务 ID。下游接「预览成品」「下载落盘」「取视频帧」「视频信息」等。\n它会把任务 ID 一起输出——要做再生成时直接连它，不必回上游拿。',
    ),
    en: h(
      'Polls the task until it finishes and emits the video URL. Every generation must pass through here.',
      'Poll interval defaults to 4s; smaller means more requests.\nTimeout defaults to 45 min. A failed task raises an error and is refunded automatically.',
      'Upstream: the task id from a Generate node. Downstream: Preview, Download, Extract Frame, Video Info.\nIt also re-emits the task id — wire that for regeneration instead of going back upstream.',
    ),
  },

  'video.frame': {
    zh: h(
      '从视频里抽一帧当图片用。\n最常见的用法：上一段生成完了，取它的**尾帧**当下一段的**首帧**，两段画面就能接上。',
      '取哪一帧：默认「尾帧」，续接下一段就用这个。\n第几秒：只有选「指定时间」时才生效。\n作为哪种图：要接下一段就选首帧。\n画质：2 最清、31 最糊，默认 3 够用。',
      '上游接「等待完成」的视频链接。\n下游接「视频生成」的图片输入，或先过「图片比例修正」再进生成。',
      '第 1 段生成 → 取视频帧（尾帧 → 首帧）→ 第 2 段生成',
    ),
    en: h(
      'Takes a still from a video and emits it as an image.\nTypical use: the previous shot is done — grab its **last frame** as the **first frame** of the next shot so they connect.',
      'Which frame: default "last", use it when continuing.\nAt second: only used by the "at" mode.\nFeed as: pick first frame when continuing into the next shot.\nJPEG quality: 2 is sharpest, 31 is blurriest; 3 is fine.',
      'Upstream: the video URL from Watch.\nDownstream: the Image input of Generate, optionally via Image Fit first.',
      'Shot 1 → Extract Frame (last → first) → Shot 2',
    ),
  },

  'video.concat': {
    zh: h(
      '把多条视频首尾相接成一个文件，直接存进 downloads。',
      '顺序按你连线的先后。\n编码一致时无损秒拼；不一致会自动转码，慢一些但一定拼得上。',
      '上游接多个「等待完成」。\n下游接「下载落盘」——拼接产物已经在本地了，下载节点不会重复存一份。',
    ),
    en: h(
      'Joins several videos end to end into one file, saved straight into downloads.',
      'Order follows the order you wire the inputs.\nSame codec joins losslessly and fast; mismatched ones fall back to re-encoding — slower but always works.',
      'Upstream: several Watch nodes.\nDownstream: Download — the joined file is already local, so it will not be saved twice.',
    ),
  },

  'image.fit': {
    zh: h(
      '宽高比超出 0.4–2.5 的图，自动加边拉回合法范围，免得网关报 2013。',
      '补边颜色三选一：黑色和视频黑边最搭，白色适合浅底商品图，灰色做中性过渡。\n已经合法的图会原样放过，不重新压缩，画质无损。',
      '上游接「图片素材」或「取视频帧」，下游接「视频生成」的图片输入。',
    ),
    en: h(
      'Pads images whose aspect ratio falls outside 0.4–2.5 back into the legal window, so the gateway stops rejecting them with 2013.',
      'Pick a pad colour: black matches video letterboxing, white suits light product shots, grey is a neutral middle.\nImages already in range pass through untouched — no recompression, no quality loss.',
      'Upstream: Media Image or Extract Frame. Downstream: the Image input of Generate.',
    ),
  },

  'video.info': {
    zh: h(
      '读出视频的时长、分辨率和体积。',
      '没有参数，挂上就能用。',
      '上游接「等待完成」。\n下游可以接「条件判断」做分支，比如时长超了才重跑。',
    ),
    en: h(
      'Reads duration, resolution and byte size of a video.',
      'No fields; just wire it in.',
      'Upstream: Watch.\nDownstream: a Condition node if you want to branch, e.g. rerun only when the duration is off.',
    ),
  },

  'logic.condition': {
    zh: h(
      '按条件把流程分成两条，只走匹配的那一条，另一条的下游会被跳过。',
      '先选比较方式（包含 / 等于 / 大于 …），再填比较值。\n做数值比较时填「比较数」，文本比较填「比较值」。',
      '上游接任意一个值。\n下游分别接「通过」和「不通过」两条路——没走到的那条整段不执行，不花钱。',
    ),
    en: h(
      'Splits the flow in two; only the matching branch keeps running, the other branch is skipped.',
      'Pick an operator (contains / equals / greater than …) then the value to compare against.\nUse "compare number" for numeric checks and "compare value" for text.',
      'Upstream: any value.\nDownstream: wire the Pass and Fail branches. The branch not taken is skipped entirely and costs nothing.',
    ),
  },

  'text.merge': {
    zh: h(
      '把多段文本用分隔符拼成一段。',
      '分隔符默认是两个换行。想拼成一行就填一个空格。',
      '上游接多个文本节点，下游接生成节点的文本输入。\n**负向词不要走这里**，合并后会丢掉负向标记、被当成普通正文。',
    ),
    en: h(
      'Joins several text inputs into one string with a separator.',
      'Separator defaults to two newlines. Use a single space to keep it on one line.',
      'Upstream: several text nodes. Downstream: the Text input of a Generate node.\n**Do not route negatives through here** — merging drops the negative marker.',
    ),
  },

  'text.vars': {
    zh: h(
      '把上游文本里的 {{占位符}} 换成你在这里填的值。一条流程能跑多个主题，不用改提示词本身。',
      '每行一个 `key=value`。\nkey 必须和提示词里 {{ }} 中间的名字**完全一致**，区分大小写。',
      '上游接「提示词」，下游接「视频生成」的文本输入。\n没被替换的占位符会原样保留、不报错——如果输出里还留着 {{ }}，说明 key 拼错了。',
      'topic=谁吃了最后一块蛋糕\nmood=暖色钨丝灯',
    ),
    en: h(
      'Replaces {{placeholders}} in the incoming text with the values you set here. One flow, many topics — without editing the prompt itself.',
      'One `key=value` per line.\nThe key must **exactly** match the name inside {{ }}, case sensitive.',
      'Upstream: Prompt. Downstream: the Text input of Generate.\nUnknown placeholders are left as-is and do not raise an error — if {{ }} still shows up in the output, the key is misspelled.',
      'topic=who ate the last piece of cake\nmood=cozy warm tones',
    ),
  },

  'output.preview': {
    zh: h(
      '在导演台里直接播放成品。',
      '三个开关：自动展开、自动播放、循环。关掉自动展开就不会打断你当前的操作。',
      '上游接「等待完成」或「视频拼接」的视频链接。',
    ),
    en: h(
      'Plays the finished video inside the app.',
      'Three toggles: auto-open, autoplay, loop. Turn auto-open off if you do not want it popping up.',
      'Upstream: the video URL from Watch or Concat.',
    ),
  },

  'output.download': {
    zh: h(
      '把成品存进 downloads/ 目录。',
      '文件名 = 前缀 + 生成时间戳。关掉「自动下载」就只记录不落盘。',
      '上游接视频链接。\n真正要存盘才接它——前端不会再重复下载一次。',
    ),
    en: h(
      'Saves the finished video into downloads/.',
      'Filename is prefix plus a timestamp. Turn auto-download off to record without saving.',
      'Upstream: a video URL.\nWire it only when you actually want a file on disk — nothing downloads it twice.',
    ),
  },
};

/** 取某节点的帮助；没有就返回 null，由调用方决定兜底展示 */
export function helpOf(type, lang = 'zh') {
  const entry = NODE_HELP[type];
  if (!entry) return null;
  return entry[lang] || entry.zh;
}
