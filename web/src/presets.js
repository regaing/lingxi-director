/**
 * 剧本预设：点一下就往 AI 输入框填一条「从 0 到 1」的结构化指令。
 *
 * 为什么单独一个文件、而不进 i18n 字典：
 *   i18n.jsx 放的是界面标签（短、稳定）；这里是内容模板（每条 150+ 字、会随创作迭代）。
 *   两者体量与生命周期都不同，混一起会把字典撑成正文库。双语仍按 { zh, en } 内联，
 *   渲染时按当前 lang 取，行为与 i18n 一致。
 *
 * 每条都必须自带「能直接跑起来」的五要素：题材 / 人物 / 节拍 / 镜头 / 时长分辨率 + 负向词方向。
 * 节点结构不写死 —— AI 应用后由 lib/graph-complete.mjs 兜底补齐 watch 与出口。
 */

export const PRESET_GROUPS = [
  { id: 'story', title: { zh: '剧情短片', en: 'Story' } },
  { id: 'scene', title: { zh: '氛围空镜', en: 'Atmosphere' } },
  { id: 'ad', title: { zh: '产品广告', en: 'Product ad' } },
  { id: 'talk', title: { zh: '角色口播', en: 'Talking head' } },
  { id: 'knowledge', title: { zh: '知识科普', en: 'Explainer' } },
];

export const PRESETS = [
  /* ── 剧情短片 ── */
  {
    id: 'story-couple',
    group: 'story',
    label: { zh: '情侣日常喜剧 · 30s', en: 'Couple sitcom · 30s' },
    text: {
      zh: `从零做一个 30 秒的情侣日常喜剧短片，主题：谁吃了最后一块蛋糕。

人物：两个角色，女生米色卫衣、男生深灰卫衣，全程同一场景（小厨房 + 餐桌）。

节拍 5 拍，每拍约 6 秒：
1. 全景，两人背对背坐着，桌上只剩空盘子
2. 中景，女生慢慢转头看向男生
3. 特写，男生嘴角挂着一小团奶油
4. 中景，女生挑眉，男生心虚地笑
5. 全景，两人同时伸手去抢最后一块，画面定格

镜头：固定机位带轻微手持感，写实生活质感，暖色钨丝灯，浅景深。
节奏：real-time pacing，不要慢动作。
参数：duration 30 秒，resolution 768P，ratio 16:9，不开水印。
负向词方向：模糊、水印、多余手指、面部变形、闪烁、画面文字乱码。

剧本正文用英文写。`,
      en: `Build a 30-second couple sitcom short from scratch. Theme: who ate the last piece of cake.

Characters: two people, woman in a beige hoodie, man in a dark grey hoodie, single location throughout (small kitchen + dining table).

5 beats, about 6 seconds each:
1. Wide shot, both sitting back to back, only an empty plate on the table
2. Medium shot, the woman slowly turns her head toward the man
3. Close-up, a dab of frosting at the corner of his mouth
4. Medium shot, she raises an eyebrow, he smiles guiltily
5. Wide shot, both reach for the last piece at the same time, freeze frame

Camera: locked-off with a slight handheld feel, realistic slice-of-life texture, warm tungsten light, shallow depth of field.
Pacing: real-time, no slow motion.
Parameters: duration 30s, resolution 768P, ratio 16:9, no watermark.
Negative prompt direction: blurry, watermark, extra fingers, distorted face, flicker, garbled on-screen text.

Write the prompt body in English.`,
    },
  },
  {
    id: 'story-twist',
    group: 'story',
    label: { zh: '悬疑反转 · 15s', en: 'Mystery twist · 15s' },
    text: {
      zh: `从零做一个 15 秒的悬疑反转短片，主题：深夜厨房里有人偷吃，结尾揭晓是一只猫。

人物：只出现一个背影角色（睡衣、赤脚），不要露正脸；最后 2 秒切到一只橘猫。

节拍 4 拍：
1. 0-4 秒：走廊昏暗，一束冰箱冷光从门缝漏出
2. 4-8 秒：背影慢慢推开门，手指伸向冰箱
3. 8-12 秒：冰箱光打在脸上，只看到下巴和手，抓出一盒酸奶
4. 12-15 秒：镜头下摇，橘猫舔着酸奶盖，抬头看镜头

镜头：低照度、冷蓝主光 + 冰箱暖白光对比，缓慢推近，手持微晃。
节奏：前半段悬疑感靠慢，最后一拍快速收束。
参数：duration 15 秒，resolution 768P，ratio 16:9。
负向词方向：过度曝光、噪点、人影重影、面部清晰正面、文字乱码。

剧本正文用英文写。`,
      en: `Build a 15-second mystery twist short from scratch. Theme: someone is sneaking food at night in the kitchen, and the payoff is that it is a cat.

Characters: one back-only figure (pajamas, barefoot), face never shown; the last 2 seconds reveal an orange tabby cat.

4 beats:
1. 0-4s: dim hallway, a slab of cold fridge light leaking through the door gap
2. 4-8s: the back figure slowly pushes the door open, hand reaching in
3. 8-12s: fridge light hits the face, only jaw and hand visible, grabs a yogurt cup
4. 12-15s: camera tilts down, an orange tabby licks the lid and looks up at the lens

Camera: low key, cold blue key light against warm white fridge light, slow push-in, slight handheld sway.
Pacing: slow for suspense in the first half, quick close on the last beat.
Parameters: duration 15s, resolution 768P, ratio 16:9.
Negative prompt direction: overexposure, noise, ghosting, clear frontal face, garbled text.

Write the prompt body in English.`,
    },
  },
  {
    id: 'story-heal',
    group: 'story',
    label: { zh: '治愈系 · 20s', en: 'Healing · 20s' },
    text: {
      zh: `从零做一个 20 秒的治愈系短片，主题：雨天便利店，店员把伞递给没带伞的客人。

人物：店员（浅蓝围裙、扎马尾），客人（湿了半边肩的西装青年）。全程店内 + 门口，不要换场景。

节拍 4 拍，每拍 5 秒：
1. 店内，玻璃窗外下着大雨，雨痕顺玻璃流下
2. 客人推门进来，肩膀湿了，抬头看货架上的雨伞
3. 店员默默抽出一把透明伞，推过柜台
4. 客人愣了一下，笑着点头；镜头停在门外他撑伞走进雨里

镜头：柔和自然顶光，暖色调，缓慢横移，浅景深，情绪克制不煽情。
节奏：real-time pacing，不要慢动作。
参数：duration 20 秒，resolution 1080p，ratio 16:9。
负向词方向：夸张表情、泪水特写、过度柔光、画面文字、水印。

剧本正文用英文写。`,
      en: `Build a 20-second healing short from scratch. Theme: a rainy-day convenience store, the clerk hands an umbrella to a customer who forgot his.

Characters: clerk (light blue apron, ponytail), customer (young man in a suit with one wet shoulder). Single location: inside the store and the doorway.

4 beats, 5 seconds each:
1. Interior, heavy rain outside the glass, streaks running down
2. The customer pushes in, shoulder soaked, looks up at the umbrellas on the shelf
3. The clerk quietly pulls out a clear umbrella and slides it across the counter
4. He pauses, smiles and nods; camera stays as he opens it and walks into the rain

Camera: soft natural top light, warm palette, slow lateral move, shallow focus, restrained emotion.
Pacing: real-time, no slow motion.
Parameters: duration 20s, resolution 1080p, ratio 16:9.
Negative prompt direction: exaggerated expressions, tear close-ups, heavy glow, on-screen text, watermark.

Write the prompt body in English.`,
    },
  },

  /* ── 氛围空镜 ── */
  {
    id: 'scene-city',
    group: 'scene',
    label: { zh: '雨夜城市 · 10s', en: 'Rainy city night · 10s' },
    text: {
      zh: `从零做一个 10 秒的城市雨夜空镜，主题：天桥上的车流与霓虹倒影。

画面：俯拍城市主干道，湿沥青反射红绿灯，远处楼宇灯光散成光斑，一辆公交缓慢驶过水洼。
时间：雨夜，蓝紫色调，霓虹招牌作为唯一点缀。

节拍 3 拍：
1. 0-3 秒：大景俯拍，车灯拉出连续光轨
2. 3-7 秒：缓慢推近到路面水洼，倒影里的红灯在晃
3. 7-10 秒：一辆公交碾过水洼，倒影碎成涟漪

镜头：长焦压缩空间，缓慢推近，无手持晃动，电影感调色。
参数：duration 10 秒，resolution 1080p，ratio 16:9。
负向词方向：人像特写、镜头抖动、过曝霓虹、噪点、水印、画面文字。

剧本正文用英文写。`,
      en: `Build a 10-second rainy city night scenery clip from scratch. Theme: traffic and neon reflections under an overpass.

Visual: high angle over a main road, wet asphalt mirroring traffic lights, distant towers bokeh'd into soft blobs, a bus crossing a puddle.
Time: rainy night, blue-purple grade, neon signage as the only accent.

3 beats:
1. 0-3s: wide high angle, headlights smearing into continuous light trails
2. 3-7s: slow push toward a puddle on the road, red light wavering in the reflection
3. 7-10s: the bus rolls through the puddle, reflection shattering into ripples

Camera: long lens compressing space, slow push-in, no handheld shake, cinematic grade.
Parameters: duration 10s, resolution 1080p, ratio 16:9.
Negative prompt direction: human close-ups, shaky camera, blown-out neon, noise, watermark, on-screen text.

Write the prompt body in English.`,
    },
  },
  {
    id: 'scene-nature',
    group: 'scene',
    label: { zh: '晨雾山脊 · 15s', en: 'Misty ridge · 15s' },
    text: {
      zh: `从零做一个 15 秒的自然空镜，主题：日出前的晨雾漫过山脊。

画面：层叠山脊剪影，云海在谷底缓慢流动，第一缕阳光逐层点亮山尖，构图要留大面积天空。
时间：日出前 10 分钟，冷青到暖金的渐变。

节拍 3 拍：
1. 0-5 秒：大远景，雾层静止，只有极小幅度涌动
2. 5-10 秒：阳光扫过最远一道山脊，边缘被染成金线
3. 10-15 秒：雾海开始翻涌，镜头极缓右移

镜头：极缓慢横移（每秒不超过 1 度），无抖动，长焦，自然色彩不夸张。
参数：duration 15 秒，resolution 1080p，ratio 16:9。
负向词方向：鸟群、人物、建筑、过饱和、HDR 感过重、画面文字。

剧本正文用英文写。`,
      en: `Build a 15-second nature scenery clip from scratch. Theme: dawn mist rolling over ridgelines.

Visual: layered silhouette ridges, a sea of cloud drifting slowly in the valley, first sunlight lighting the peaks layer by layer, with generous empty sky.
Time: ten minutes before sunrise, cool cyan to warm gold gradient.

3 beats:
1. 0-5s: extreme wide, mist almost static with very slight churn
2. 5-10s: sunlight sweeps the farthest ridge, edges rimmed in gold
3. 10-15s: the cloud sea starts to churn, camera drifts right very slowly

Camera: extremely slow lateral move (under 1 degree per second), no shake, long lens, natural color without exaggeration.
Parameters: duration 15s, resolution 1080p, ratio 16:9.
Negative prompt direction: birds, people, buildings, oversaturation, heavy HDR look, on-screen text.

Write the prompt body in English.`,
    },
  },
  {
    id: 'scene-abstract',
    group: 'scene',
    label: { zh: '抽象光效 · 8s 2K', en: 'Abstract light · 8s 2K' },
    text: {
      zh: `从零做一个 8 秒的抽象光效短片，用途是片头背景。

画面：液态金属般的紫蓝色光带在近黑背景中缓慢缠绕、融合、拉丝，末端有细小光点飘散。不要出现任何实体物件。
色调：近黑底 + 紫蓝主色 + 少量青色高光，参考品牌质感。

节拍 3 拍：
1. 0-2 秒：一条光带从画面左侧进入，缓慢旋转
2. 2-5 秒：第二条光带从下方插入，与第一条缠绕成螺旋
3. 5-8 秒：光带拉细成丝，散成光点后归于黑暗

镜头：微距质感，极浅景深，无摄影机位移，纯运镜由光带自转完成。
参数：duration 8 秒，resolution 2K，ratio 16:9。
负向词方向：人脸、手、实物、文字、logo、噪点、频闪。

剧本正文用英文写。`,
      en: `Build an 8-second abstract light clip from scratch, meant as an opening background plate.

Visual: liquid-metal-like violet-blue ribbons slowly twisting, merging and drawing into strands against a near-black field, fine sparks trailing off. No physical objects at all.
Palette: near-black base + violet-blue primary + a little cyan highlight, premium tech feel.

3 beats:
1. 0-2s: one ribbon enters from the left, slowly rotating
2. 2-5s: a second ribbon enters from below and interlaces into a spiral
3. 5-8s: the ribbons thin into filaments, scatter into sparks, fade to black

Camera: macro texture, very shallow depth of field, no camera translation, motion comes from the ribbons themselves.
Parameters: duration 8s, resolution 2K, ratio 16:9.
Negative prompt direction: faces, hands, real objects, text, logos, noise, strobing.

Write the prompt body in English.`,
    },
  },

  /* ── 产品广告 ── */
  {
    id: 'ad-macro',
    group: 'ad',
    label: { zh: '质感特写 · 10s 2K', en: 'Macro texture · 10s 2K' },
    text: {
      zh: `从零做一个 10 秒的产品质感特写，主题：一滴咖啡落入杯中。

画面：深色陶瓷杯，杯口有细密热气，一滴琥珀色咖啡从上方落下，击中液面溅起细小花冠，涟漪扩散后恢复平静。背景虚化成暖棕色。
产品位：不要出现品牌 logo，只表现材质与光泽。

节拍 3 拍：
1. 0-3 秒：微距静止，杯口热气缓慢上升
2. 3-6 秒：液滴下落的 0.5 秒慢镜（仅此一处慢动作），撞击液面
3. 6-10 秒：涟漪扩散，表面反光重新稳定，镜头极缓推近

镜头：100mm 微距质感，极浅景深，顶部柔光箱 + 侧逆光勾边。
参数：duration 10 秒，resolution 2K，ratio 1:1。
负向词方向：人手、杯子变形、液体穿模、logo、文字、噪点、色偏。

剧本正文用英文写。`,
      en: `Build a 10-second product texture close-up from scratch. Theme: a drop of coffee falling into a cup.

Visual: dark ceramic cup with fine steam at the rim, one amber drop falls from above, hits the surface in a tiny crown splash, ripples spread and settle. Background bokeh'd into warm brown.
Product: no brand logo, only material and gloss.

3 beats:
1. 0-3s: static macro, steam rising slowly from the rim
2. 3-6s: the drop falls in a half-second slow-motion beat (the only slow motion here), impact on the surface
3. 6-10s: ripples spread, reflection settles, camera inches forward

Camera: 100mm macro feel, very shallow depth of field, overhead softbox plus a side rim light.
Parameters: duration 10s, resolution 2K, ratio 1:1.
Negative prompt direction: human hands, warped cup, liquid clipping, logos, text, noise, color cast.

Write the prompt body in English.`,
    },
  },
  {
    id: 'ad-scene',
    group: 'ad',
    label: { zh: '使用场景 · 20s', en: 'Usage scene · 20s' },
    text: {
      zh: `从零做一个 20 秒的产品使用场景短片，主题：通勤地铁上戴上降噪耳机，世界瞬间安静。

人物：一位通勤青年（深色大衣、单肩包），侧脸为主，不露正脸特写。

节拍 4 拍，每拍 5 秒：
1. 车厢内拥挤，人群噪动，画面轻微晃动，光线冷白
2. 他从口袋取出耳机，戴上的一瞬间画面抖动停止
3. 环境声消失的视觉表达：画面色调转暖，背景人流变成慢速虚化
4. 他闭眼靠在车门上，窗外隧道灯光一格一格掠过

镜头：手持转稳定（前半段轻微手持，戴耳机后完全稳定），中近景为主。
参数：duration 20 秒，resolution 768P，ratio 16:9。
负向词方向：面部特写过于清晰、人群穿模、地铁标志、文字、水印。

剧本正文用英文写，画面里不要出现任何真实品牌与 logo。`,
      en: `Build a 20-second product usage-scene short from scratch. Theme: putting on noise-cancelling earphones on a commute train, the world goes quiet instantly.

Characters: one commuter (dark coat, single-strap bag), mostly profile, no clear frontal close-up.

4 beats, 5 seconds each:
1. Crowded carriage, restless crowd, slight camera shake, cool white light
2. He takes the earphones out of his pocket; the instant they go in, the shake stops
3. Visual translation of silence: palette warms, the crowd behind blurs into slow motion
4. He closes his eyes against the door, tunnel lights flick past the window panel by panel

Camera: handheld turning into locked-off (slight handheld first half, perfectly stable after), medium close-ups throughout.
Parameters: duration 20s, resolution 768P, ratio 16:9.
Negative prompt direction: over-sharp facial close-ups, crowd clipping, transit logos, text, watermark.

Write the prompt body in English, and keep every real brand and logo out of the frame.`,
    },
  },
  {
    id: 'ad-talk',
    group: 'ad',
    label: { zh: '口播带货 · 15s', en: 'Product pitch · 15s' },
    text: {
      zh: `从零做一个 15 秒的产品口播短片，主题：手持产品对着镜头讲解。

人物：一位年轻女性，浅色衬衫，坐在简洁的浅灰背景前，桌上放同类产品。

节拍 4 拍：
1. 0-4 秒：中景，她拿起产品，转向镜头举到胸前
2. 4-8 秒：近景，手指点在产品的一个细节上
3. 8-12 秒：中景，她比了一个数字手势，语速偏快
4. 12-15 秒：产品单独入镜，缓慢旋转，背景虚化

重要：口型不做硬要求，用侧 3/4 角度、说话时轻微低头、镜头在产品与人物间切换来规避；不要让画面盯住正脸说长句。
镜头：固定机位，两灯柔光，干净电商质感。
参数：duration 15 秒，resolution 768P，ratio 9:16。
负向词方向：口型错位、牙齿变形、手指数目错误、产品变形、文字乱码、水印。

剧本正文用英文写，不要出现真实品牌与 logo。`,
      en: `Build a 15-second product pitch short from scratch. Theme: holding the product and talking to camera.

Characters: one young woman, light shirt, seated against a clean light-grey backdrop, similar products on the table.

4 beats:
1. 0-4s: medium shot, she picks up the product and brings it to chest height, turning to lens
2. 4-8s: closer shot, her finger taps one detail on the product
3. 8-12s: medium shot, she makes a counting gesture, brisk delivery
4. 12-15s: the product alone, slowly rotating, background falling out of focus

Critical: lip-sync is not required - use 3/4 angles, slight head-down while speaking, and cut between product and person. Never hold a long line on a straight-on face.
Camera: locked-off, two soft lights, clean e-commerce look.
Parameters: duration 15s, resolution 768P, ratio 9:16.
Negative prompt direction: lip-sync mismatch, warped teeth, wrong finger count, warped product, garbled text, watermark.

Write the prompt body in English, with no real brands or logos.`,
    },
  },

  /* ── 角色口播 ── */
  {
    id: 'talk-digital',
    group: 'talk',
    label: { zh: '数字人讲解 · 20s', en: 'Presenter explainer · 20s' },
    text: {
      zh: `从零做一个 20 秒的讲解类口播短片，主题：三句话讲清一个概念。

人物：一位沉稳的男性讲师，深蓝针织衫，站在深灰渐变背景前，身体只做小幅手势。

节拍 4 拍，每拍 5 秒：
1. 中景，他抬手示意，开始讲第一点
2. 近景，侧 3/4 角度，讲到第二点时手往下压
3. 中景，转向另一侧，抛出第三点
4. 近景，点头收尾，视线回到镜头

重要：人物说话时不要长时间正对镜头的口型特写，用侧角度、低头看笔记、手部动作遮住嘴部来规避。
镜头：固定机位，柔和三点布光，背景轻微光斑。
参数：duration 20 秒，resolution 1080p，ratio 9:16。
负向词方向：口型错位、牙齿崩坏、多余手指、眼神空洞、文字乱码。

剧本正文用英文写。`,
      en: `Build a 20-second presenter-style talking short from scratch. Theme: explaining one concept in three sentences.

Characters: one composed male presenter, navy knit sweater, standing against a dark grey gradient, only small hand gestures.

4 beats, 5 seconds each:
1. Medium shot, he raises a hand to signal, starts the first point
2. Closer, 3/4 angle, second point with a downward hand press
3. Medium shot, turns to the other side, delivers the third point
4. Close, nods to close, eyes back to lens

Critical: avoid long straight-on lip close-ups; use side angles, looking down at notes, and hand gestures crossing the mouth area.
Camera: locked-off, soft three-point lighting, subtle background bokeh.
Parameters: duration 20s, resolution 1080p, ratio 9:16.
Negative prompt direction: lip-sync mismatch, broken teeth, extra fingers, empty stare, garbled text.

Write the prompt body in English.`,
    },
  },
  {
    id: 'talk-mono',
    group: 'talk',
    label: { zh: '情绪独白 · 15s', en: 'Emotional monologue · 15s' },
    text: {
      zh: `从零做一个 15 秒的情绪独白短片，主题：深夜窗边，一个人对着窗外说话。

人物：一位穿宽松毛衣的年轻人，坐在窗台上，侧脸朝窗，室内只开一盏暖黄台灯。

节拍 4 拍：
1. 0-4 秒：中景侧影，窗帘被风轻轻吹动
2. 4-9 秒：近景，侧脸，嘴唇轻动，说的是心里话
3. 9-12 秒：手部特写，手指无意识绕着杯沿
4. 12-15 秒：拉远，人变成剪影，窗外城市灯点模糊

重要：不要给正面口型特写，全片保持侧脸或剪影，情绪靠光与动作，不靠台词。
镜头：固定机位 + 极缓慢推近，暖黄室内光 vs 冷蓝窗外，浅景深。
参数：duration 15 秒，resolution 768P，ratio 9:16。
负向词方向：正脸口型特写、夸张表情、泪水特写、画面文字、水印。

剧本正文用英文写。`,
      en: `Build a 15-second emotional monologue short from scratch. Theme: late night by the window, someone talking to the city outside.

Characters: one young person in an oversized sweater, sitting on the windowsill, profile toward the glass, only one warm desk lamp on.

4 beats:
1. 0-4s: medium profile, curtain drifting in a light breeze
2. 4-9s: closer profile, lips moving slightly, saying what they really mean
3. 9-12s: hand close-up, a finger tracing the rim of a mug absentmindedly
4. 12-15s: pull back, the figure becomes a silhouette, city lights blur outside

Critical: no frontal lip close-up at any point - stay on profile or silhouette; carry the emotion with light and gesture, not dialogue.
Camera: locked-off with an extremely slow push-in, warm interior light against cool blue window light, shallow focus.
Parameters: duration 15s, resolution 768P, ratio 9:16.
Negative prompt direction: frontal lip close-ups, exaggerated expressions, tear close-ups, on-screen text, watermark.

Write the prompt body in English.`,
    },
  },

  /* ── 知识科普 ── */
  {
    id: 'know-steps',
    group: 'knowledge',
    label: { zh: '三步图解 · 20s', en: 'Three-step explainer · 20s' },
    text: {
      zh: `从零做一个 20 秒的图解式科普短片，主题：用三步讲清一件事的流程。

画面：浅灰极简背景，画面中央依次出现三个抽象图示（不做真实文字，用形状、箭头、色块表达），每一步配一个简单动作示意。

节拍 4 拍，每拍 5 秒：
1. 背景亮起，第一个色块从下往上浮现
2. 箭头连到第二个色块，色块旋转就位
3. 第三个色块从右侧滑入，三者连成一条线
4. 镜头拉远，三个色块组成一个完整闭环

重要：画面里不要出现可读文字，只用形状与色块表达逻辑（生成模型做不好密集中文）。
色调：浅灰底 + 紫蓝主色 + 少量暖橙点缀。
参数：duration 20 秒，resolution 1080p，ratio 16:9。
负向词方向：可读文字、乱码、真实人物、复杂插画、过饱和、水印。

剧本正文用英文写。`,
      en: `Build a 20-second diagram-style explainer short from scratch. Theme: explaining a process in three steps.

Visual: minimal light-grey background, three abstract shapes appear in sequence in the centre (no real text - express with shapes, arrows and colour blocks), each step paired with a simple motion cue.

4 beats, 5 seconds each:
1. Background brightens, the first block rises from below
2. An arrow connects to the second block, which rotates into place
3. The third block slides in from the right, all three link into a line
4. Camera pulls back, the three blocks form a closed loop

Critical: no readable text anywhere - logic conveyed by shapes and colour only (the model cannot render dense CJK reliably).
Palette: light grey base + violet-blue primary + a little warm orange accent.
Parameters: duration 20s, resolution 1080p, ratio 16:9.
Negative prompt direction: readable text, garbled glyphs, real people, complex illustrations, oversaturation, watermark.

Write the prompt body in English.`,
    },
  },
  {
    id: 'know-compare',
    group: 'knowledge',
    label: { zh: '前后对比 · 15s', en: 'Before / after · 15s' },
    text: {
      zh: `从零做一个 15 秒的前后对比科普短片，主题：同一个场景在两个条件下的差别。

画面：左右分屏构图，左侧冷灰色调、状态混乱；右侧暖白色调、状态整洁。两侧同一机位、同一构图。

节拍 3 拍：
1. 0-5 秒：只有左半边可见，画面略显拥挤杂乱
2. 5-10 秒：分屏线从中间拉开，右半边显现，形成对比
3. 10-15 秒：两侧同时做同一个动作，差异被同步放大

重要：画面里不要出现可读文字与数字，用构图与色调差异表达对比，不要试图写「前 / 后」两个字。
参数：duration 15 秒，resolution 768P，ratio 16:9。
负向词方向：可读文字、乱码、真实人物正脸、过饱和、画面抖动、水印。

剧本正文用英文写。`,
      en: `Build a 15-second before/after explainer short from scratch. Theme: the same scene under two different conditions.

Visual: split-screen composition - left side cool grey and cluttered, right side warm white and tidy. Identical camera and framing on both sides.

3 beats:
1. 0-5s: only the left half visible, the frame feels crowded
2. 5-10s: the split line opens from the centre, the right half appears, contrast established
3. 10-15s: both sides perform the same action, the difference amplified in sync

Critical: no readable text or numbers in frame - carry the contrast with composition and colour, never try to render the words "before" or "after".
Parameters: duration 15s, resolution 768P, ratio 16:9.
Negative prompt direction: readable text, garbled glyphs, frontal faces, oversaturation, camera shake, watermark.

Write the prompt body in English.`,
    },
  },
];

/** 按分组取预设（保持 PRESETS 里的声明顺序） */
export function presetsOf(groupId) {
  return PRESETS.filter((p) => p.group === groupId);
}

/** 取当前语言下的字段（{ zh, en } → string），缺语言回落到另一侧 */
export function pickLang(field, lang) {
  if (!field) return '';
  return field[lang] || field.zh || field.en || '';
}
