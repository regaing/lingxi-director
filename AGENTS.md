# AGENTS.md · 灵动导演台（MiniMax-H3）

> 本文件是给 AI 助手读的项目上下文，**由 AI 自动维护**；维护规则见第 0 节。

---

## 0. 自动维护规则（AI 必须遵守）

本文件由 AI 自动维护，本节规则优先于其它内容。

### 何时更新
产生**实质性改动**后：增删改文件或目录；改启动方式、端口、依赖、构建步骤；改与网关的接口约定、参数限制、互斥关系；用户表达新偏好或否决某做法。
**没有实质改动的对话（闲聊、问答、只读查询）不要动本文件。**

### 只写两类
1. **项目事实**：是什么、怎么跑、目录职责、关键路径
2. **硬约定**：接口/参数硬限制、互斥关系、必填项

### 不要写
一次性任务过程、进度流水账；读代码就能拿到的东西（函数名、行号、逐行逻辑）；**任何密钥、Token、Cookie、内网地址**（`config.json` 的 Token 永不进本文件）；未验证的猜测（不确定就标"未验证"）。

### 怎么写
一行一条，能删就删；**先搜同类条目，有就改不要追加**；允许重排合并压缩，原意不丢；总量 **≤ 300 行**；只写"下一个接手的人用得上的"。

---

## 1. 项目概况

MiniMax-H3 视频生成的**本地节点画布导演台**：拖节点搭工作流 → 提交 → 轮询 → 预览/下载。
图、分类、通知全部落 **SQLite（`data/workbench.db`）**，是**唯一真相**；改图一律走 HTTP 语义化 ops，**已放弃直接改文件那条路**。

- 前端 React + `@xyflow/react`（**有构建步骤**），后端**只用 Node 内置模块**（含 `node:sqlite`）；媒体处理唯一外部依赖是 npm 分发的 ffmpeg 二进制。接入平台：**秘塔 H3**，协议与 MiniMax 官方 `/v2` **同构**
- 品牌名「灵动导演台」（`i18n` 的 `app.name`），logo 源文件 `web/public/logo.svg`，组件封装在 `components/Logo.jsx`

## 2. 怎么跑

```powershell
cd lingxi-director
npm install          # 仅首次；会顺带装好 ffmpeg/ffprobe 二进制，无需系统单独安装
npm run build        # 产出 public/；改过 web/ 后必须重跑
node server.mjs      # 起服务，等同 npm start
```

- **开源项目，依赖只走 npm**：`@ffmpeg-installer/ffmpeg` + `@ffprobe-installer/ffprobe` 连二进制一起分发，用户 `npm install` 就够；不要引需要联网下载二进制（如 `ffmpeg-static` 走 GitHub Release）的包，国内装不上

- `npm run dev` 起 Vite（5173，proxy `/api` → 8070），改前端热更新
- 地址 `http://127.0.0.1:8070`（`PORT` 可改）；**Node >= 22**（`node:sqlite` 内置）；`node server.mjs` 可独立启动，前提 `public/` 有构建产物
- 网关地址优先级：`config.json` 的 `baseUrl` > `MINIMAX_BASE_URL` > 内置默认
- 前端两页走 hash 路由：`#/` 首页（多画布列表）、`#/wf/<id>` 编辑器

## 3. 目录职责

```
server.mjs           本地服务：静态托管 + 网关薄代理 + 产物下载 + 图/分类/通知路由
lib/db.mjs           SQLite 连接（node:sqlite）+ 建表 + WAL
lib/workflows.mjs    图存储：CRUD + revision 乐观锁 + 语义化 ops patch + 分类
lib/notifications.mjs 通知存储（只留最近 200 条）
lib/runs.mjs         运行记录存储（每工作流只留最近 50 条，见 runs 表）
lib/graph-complete.mjs AI 应用后做**确定性补齐**（watch / 出口 / 负向词），幂等
lib/sse.mjs          SSE 广播：心跳 + Last-Event-ID 重放
lib/llm.mjs          LLM 层：图 ops + 提示词优化（OpenAI 兼容，现接 DeepSeek）
lib/media-tools.mjs  ffmpeg 封装：抽帧 / 探针 / 加边 / 拼接；二进制走 npm，懒加载
lib/bundle.mjs       导入导出打包：zip（workflows.json + assets/）、素材引用改写、重名加 (2)(3)
runner.mjs           执行引擎：拓扑排序 + 20 个节点 handler + 失败清理 + 单步运行
web/src/             前端源码（React + React Flow，Vite 根目录）
  pages/             Home（分类 + 多画布）/ Editor（画布）；路由见 router.js
  graph/model.js     **节点唯一扩展点**：类型/端口/字段/校验/LLM schema 全在这
  components/        Logo / Icons（lucide 统一出口）/ NotificationCenter / SettingsModal / RunPanel
  i18n.jsx           中英字典（key → [zh, en]）；panels/、nodes/ 均走 labelKey
  presets.js         13 条剧本预设（双语内容模板，篇幅大，**不进 i18n 字典**）
  styles.css         设计令牌：**靠色阶分层，不靠边框**
docs/screenshots/   README 用的界面截图（隔离演示数据生成，**勿放真实画布**）
public/              前端**构建产物**（gitignore，由 npm run build 生成）
data/workbench.db    SQLite 库（gitignore；图 / 分类 / 通知 / 运行记录都在这）
assets/           上传的素材（gitignore；JSON 只存引用不存 base64）
downloads/        产物落盘（gitignore）
out/              图像/立绘等手工产物（gitignore）
templates/        内置画布模板：一模板一目录（manifest.json + workflow.json + assets/），**要进仓库**
scripts/          维护脚本（gen-template-assets.mjs 用 ffmpeg 生成模板占位图）
config.json       token + baseUrl（gitignore，绝不写入本文件）
.run/             临时脚本（gitignore）
```

## 4. 硬约定（改代码前必看）

| 项 | 约束 |
|---|---|
| 平台 | 秘塔 H3，`baseUrl=https://metaso.cn/api/minimax`；鉴权 `Authorization: Bearer mk-...` |
| LLM | `config.json` 的 `llm.{baseUrl,model,apiKey}`，或 `LLM_API_KEY`；OpenAI 兼容协议，DeepSeek，**默认模型 `deepseek-flash`**。**key 永不写进本文件** |
| `model` | 固定 `MiniMax-H3`，**大小写敏感** |
| `resolution` / `duration` | resolution **实测 5 档**：`480p` / `512p` / `768P` / `1080p` / `2K`；duration 按分辨率分化：480p~1080p = **4–30**，**2K = 4–15**，整数 |
| `ratio` | **必填枚举且必须显式传**：`16:9` / `4:3` / `1:1` / `3:4` / `9:16` / `21:9`。**`adaptive` 与“不传”都回 2013**（官方文档写的 adaptive 合法、未传取默认值，实测均不成立） |
| 再生成 | `/v2/video_regeneration` 只支持 2K，**不传** duration |
| 再生成入参 | `source_task_id` 与 `content` **恰好一个** |
| 首尾帧 vs 参考素材 | **互斥**（`web/src/graph/model.js` 的 `PROVIDER.framesVsRef`）。秘塔是否放行**未验证**，暂按互斥保护 |
| 素材宽高比 | **0.4–2.5 闭区间** |
| 错误码 `2013` | **通用「参数校验失败」**，不只宽高比；必须看 message 判断是哪个参数 |
| 素材形式 | base64 data URI 塞 `content`；请求体上限 200MB（`MAX_BODY`）。data URI 的 MIME 必须按扩展名映射（`runner.mjs` 的 `ASSET_DATA_MIME`），视频/音频拼成 `image/*` 会被网关 2013 挡掉 |
| 素材缩略图 | **只有图片能用 `<img>` 出画面**：类型判定走 `graph/model.js` 的 `assetKind()`（先看上传时记的 `mime`，老数据退回落盘扩展名）。别把 mp4 塞进 `<img>`（必然空白） |
| 节点内看视频 | `media.*` 节点里的视频走 `components/NodeVideo.jsx` 内嵌播放（只放第一个，其余折叠成「+N」，点开在节点里竖排；纯图片节点仍是 42px 小方格）。播放器必须带 `nodrag nowheel`，否则拖进度条会拖节点、滚轮会缩放画布；`src` 带 `#t=0.1` 且 `preload=metadata` 才出首帧。全局单实例播放靠模块级 `claimPlayback()`（预览层也调它） |
| 素材 Range | `GET /api/assets/:name` 走 `sendFileWithRange`，必须支持 `206` / `Accept-Ranges`：内嵌播放器靠它边下边播和拖进度条，回整包就退化成「下完才能拖」。`/downloads/` 静态托管仍是整包 |
| 素材 mime↔扩展名 | `server.mjs` 的 `ASSET_MIME_TO_EXT` / `ASSET_EXT_TO_MIME` 必须成对增减；漏一个就会落成 `.bin`（浏览器不预览、网关不认）。上传响应回带 `mime` |
| 素材放大预览 | 点素材缩略图开 `components/AssetLightbox.jsx`（portal 到 body；滚轮缩放 / 拖拽平移 / ←→ 切换 / Esc 关闭）。它的键盘监听必须留在 **window capture 阶段并 stopPropagation**，否则预览开着按 Delete 会把选中节点删掉 |
| `aigc_watermark` | 三态：省略 / `true` / 显式 `false` |
| 提示词 | 负向词必须并进同一条 `text`、放末尾；`runner` 的 `joinTexts` 按 `__negative` 标记分离，正文在前负向词在后。**负向词必须直连 `gen.*`**，经 `text.merge` 会丢标记 |
| 图唯一真相 | `data/workbench.db` 的 `workflows` 表；写入走 revision 乐观锁，冲突返回 409，**不许静默覆盖** |
| PUT 语义 | `PUT /api/workflow/:id` 是**整体替换**：body 里没带 `nodes`/`edges` 时服务端沿用原图，没带 `name` 时沿用原名（首页重命名只传 `{name}` 就走这条，别再让它清空节点）；要清空必须显式传 `nodes: []` |
| 多画布 | 首页列库里的工作流；新建 `POST /api/workflows`（可带 `categoryId`），复制 `POST /api/workflow/:id/duplicate` |
| 拖拽归属 | 首页卡片可拖到左侧分类改归属（侧栏是唯一投放区，`data-cat` 存分类 id，`closest` 认人；`dragWf` 与分类排序的 `dragCat` 互斥）。落库走 `POST /api/workflows/move`，**只改 `category_id`，不动 `updated_at` / `revision`** |
| 通知 | `notifications` 表（留 200 条）；铃铛 `GET /api/notifications`，运行结束由 `runner` 写 `run.succeeded` / `run.failed` |
| 运行可视化 | run 落 `runs` 表（每流留 50 条）；`GET /api/runs?wfId=`；`GET /api/run/:id` **内存优先、缺失回落 SQLite**（带 `fromDb`）。运行时订阅 `GET /api/run/:id/events`（SSE：`run:start`/`run:node`/`run:done`），前端轮询只做断线降级 |
| 任务列表 | `GET /api/tasks` 透传网关任务列表；带 `wfId` 时只回该流的任务——网关任务**没有 wf 字段**，靠 `runs.outputs` 里的 `task_id` + 图里 `task.source` 的 `taskId` 反查过滤（所以超出「每流 50 条 run」或 7 天保留期的任务查不到） |
| 导入导出 | `.zip` 包：`workflows.json` + `assets/<文件>`（素材是真实文件，**不塞 base64**）；`GET /api/export[?wfId=]` 导出单个/全库，`POST /api/import` 收原始 zip（不走 JSON 体）。导入**永远**新建副本，素材落盘换新文件名并重写节点引用，重名加 (2)(3)。zip 用 npm 的 `fflate`（纯 JS，无二进制下载） |
| 节点状态词 | `runner` 发 **`running` / `success` / `error` / `skipped` / `cancelled`**，run 级才是 `succeeded` / `failed`；两套 i18n key 都要在 |
| 内置模板 | 模板 = `templates/<id>/` **目录**（不是 zip）：`manifest.json` + `workflow.json` + `assets/`。id 走白名单正则 `/^[a-z0-9][a-z0-9._-]{0,63}$/i` 且拒 `..`（防目录穿越）。实例化复用 `importBundle`（素材改名落盘 + 引用重写 + 重名加 (2)(3)），不占 `workflows` 表。`manifest.params[].target` 指向节点字段做参数化，`requires` 声明必填素材（前端据此警告）。模板图**必须自带** `task.watch` + `output.*`，`completeGraph` 只是兜底；`node scripts/verify-templates.mjs` 断言「补齐 ops 为空」 |
| 模板示例素材 | 两种取向：① **明显假的占位图**（深灰底 + 框 + 「占位素材 PLACEHOLDER」）——`talking-head-loop` 用这个，提示用户必须替换，由 `scripts/gen-template-assets.mjs` 生成（脚本默认不覆盖已存在文件，加 `--force` 才重生）；② **真实但通用的示例图**——`product-ad-360` 的 `product-sample.jpg`（护肤瓶，1254² 源图压到 1024²/63KB），开箱即跑做演示。**共同红线：绝不放「像用户自己产品」的图**，否则用户直接跑，拿到不是自己东西的视频还以为模板在正常工作 |
| 忽略规则 | `.gitignore` 里的运行时目录必须写**前导斜杠**：裸 `assets/` 会匹配任意层级的 `assets`，连 `templates/<id>/assets/` 里的模板素材一起排除（模板就不完整了）。已修为 `/assets/` `/downloads/` `/out/` |
| 模板封面 | `templates/<id>/cover.jpg`（或 `.png`，模板根目录或 `assets/` 下都认），建议 **1024×576 / 16:9**、30–120KB。卡片实际只显示 ~240px 宽，别放 2MB 原图。`readTemplateCover` 对 jpg 的 MIME 必须是 `image/jpeg`（不是 `image/jpg`） |
| 卡片缩略图 | 工作流卡片的背景图 = **产物首帧**，存 `data/thumbs/<wfId>.jpg`（`data/` 已 gitignore）。run 成功时由 `runner` 调 `media-tools.saveThumb()` **异步**生成，失败只 `console.warn`，绝不影响 run 状态。优先取 `outputs[].file`（downloads 本地文件），没有才用 `video_url`（CDN 签名会过期，所以只在成功那一刻抽）。前端 `GET /api/workflows` 的 `thumb` 字段存在才铺图，没有退回分类色块 |
| ffmpeg 滤镜 | 当前 npm 分发的 build（2018 版，N-92722）**不支持 `gradients`**；`color` / `drawbox` / `drawgrid` / `testsrc` / `drawtext`（libfreetype）均可用。`drawtext` 的字体路径要把盘符冒号转义成 `C\:/Windows/Fonts/msyh.ttc` |
| 汇聚节点 | `video.concat` 是**汇聚节点**：`completeGraph` 的出口判定里，它上游的 `task.watch` 不再要求直连 `output.*`（出口由 concat 统一负责）。新增同类汇聚节点要同步加进 `lib/graph-complete.mjs` 的 `SINK_TYPES` |
| AI 改流程 | 模型只负责内容；`POST /api/workflow/:id/ai` 应用后必走 `lib/graph-complete.mjs` 补齐：`gen.* → task.watch → output.preview + output.download`、`gen.video` 缺负向词就补一个。规则单一来源是 `graph/model.js` 的 `FLOW_RULES`（随 `schemaForLLM()` 投影给 LLM）；响应带 `autoFilled` |
| 单步运行 | `POST /api/run {nodeIds:[id], single:true}` 只跑该节点并复用上次输入输出（不重复计费）；`single:false` 跑该节点及全部上游（重新计费） |
| AI 优化 | `POST /api/llm/optimize {text, kind}` → `{text, note, original}`；结果先预览，用户点「替换为优化版」才写回节点 |
| 节点库 | **20 类**；逻辑组 = `logic.condition`（分支门，pass/fail 只活一条）+ `text.merge` + `text.vars`（`{{key}}` 替换，未定义的占位符原样保留） |
| 媒体处理 | `video.frame`（抽帧，默认取尾帧当下一段首帧）/ `video.concat`（拼接，按连线顺序，**直接落 downloads** 并输出 `/downloads/xxx`，`output.download` 不再抓一遍）/ `image.fit`（比例修正到 0.4–2.5）/ `video.info`（探针）。全经 `lib/media-tools.mjs`，输入可以是 https、`/downloads/xxx` 或 `file:///`，由 `toLocalPath` 归一 |
| 界面风格 | **边界靠背景色阶区分**（bg → surface-1/2/3/4），只有状态（选中 / 聚焦 / 成功 / 失败）才用描边或光晕；图标一律走 `components/Icons.jsx`，不散落 lucide |
| 内部滚动 | 主区三栏都是 flex；凡是「自己滚」的子项（`.wb-dock` / `.wb-inspector` / `.wb-runpanel` / `.wb-sidebar`）必须带 `min-height: 0`，否则按内容撑高、变成整页滚动 |
| 文案 | **UI 文案一律走 `web/src/i18n.jsx`**，节点/字段用 `labelKey`，不许写死语言；首次跟随浏览器语言，缺省中文。篇幅大的内容只好单独建档：剧本预设 → `presets.js`，节点使用说明 → `help.js`（`components/NodeHelp.jsx` 渲染，与 `model.js` 给 LLM 的英文 `doc` 是**两套**，别混） |
| 变更记录 | 功能/接口/行为有实质改动时同步 `CHANGELOG.md`（Keep a Changelog 结构 + 中文正文，小标题用 Added/Changed/Fixed/Removed/Docs）；发版时把 `Unreleased` 归档成版本段并同步 `package.json` 版本号 |
| 弹窗 | 一律用页内的 `wb-modal`（mask + head/body/foot），**禁用 `window.prompt/confirm/alert`**：桌面壳里 `prompt` 既不弹窗也不返回，点了像没反应 |
| 运行/干跑 | 同一流同时只允许 **1 个 run**（第二个 409，防重复扣费）；失败自动 DELETE 网关任务（**全额退款**），状态钉在出错节点；`dryRun:true` 只回计划+预估，**不碰网关**；计费按网关单价计算，素材前 5 张免费 |
| 运行态 / 落盘 | `runNodes` 与 `nodes` 分开，渲染合成 `displayNodes`，运行态永不写回图；下载只在 `output.download` 落地，前端 `afterRun` 不许再下一次 |
| 剧本预设 | 13 条 / 5 组，正文在 `web/src/presets.js`（{zh,en} 内联）；点一下**只填入输入框**，不自动执行；每条自带五要素（题材/人物/节拍/镜头/时长分辨率+负向词方向） |
| 建图坐标 | `add_node` 没给坐标（或给 `0,0`）时按网格自动错开；界面拖拽总带真实坐标，这条兜底是给 API / AI 改流程用的，否则新节点全叠在原点、画布上认不出谁是谁 |
| LLM 输出 | `response_format=json_object` + prompt 必含 json 字样与完整样例；括号配错由 `repairJson` 按报错位置迭代修，**修完必须 parse 通过**才算数；解析失败再重试一次 |
| LLM 容量 | `config.json` 的 `llm.maxTokens`（默认 64K）/ `llm.contextWindow`（默认 1M）可在设置弹窗改；调用时透传，`usage` 回带 `contextWindow`，AI 面板显示占比、≥80% 变黄告警 |
| 外部改图 | 一律走 HTTP ops（`/api/workflow/:id/patch`、`/api/workflow/:id/ai`）→ SSE `wf:changed`；编辑器自己的写入带 `X-WB-Origin: editor`，SSE 据此不弹「外部改动」。**不再监听文件** |

## 5. 已知限制（未验证的不硬写）

- 输出视频**实测带 aac 音轨**（32kHz stereo；6s / 10s 产物均如此），音轨内容是否继承参考视频音频**未验证**，要配乐仍建议后期叠；参考视频走 base64 会让请求体很大（2MB 源 ≈ 2.7MB）；下载链接带签名会过期，需重查任务拿新链；429 / 503 是限流或渠道满，退避重试即可
- 参考视频**能被网关读到**（实测 15s / 16:9 / 固定机位天台舞蹈，产物复现了天台、天空、西装与大幅动作）；但**静态参考图会抢权重**：三张棚拍 T-pose 图 + 舞蹈视频一起喂，产物退化成棚拍站姿、动作全丢。要动作跟视频就减少静态图（留 1 张正面）并在提示词里分层写「角色来自图 / 动作+镜头+场景来自视频」
- 提示词里**必须显式写出动作**：只写 `performs the same actions as the reference video` 这类抽象约束，产物会站桩轻摆；写「beat by beat + 具体肢体动作 + never stand still」才动得起来。负向词别放 `morphing` / `flickering`，会压制大幅动作
- 参考素材**不要用三视图 / 多视图**：字节官方 prompt guide 明确写「人物参考图优先用单人独立照片，不建议三视图/多视图」，多视图会被识别成多个主体，出「双胞胎 / 同款分身」。正确配置是**全身照 1 张 + 面部特写 1 张**，总素材 4–5 个（角色图 1-2 + 场景图 1 + 运镜视频 1 + 音频 1）

