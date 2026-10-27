# 变更记录 · Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 结构，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

小标题统一用 `Added` / `Changed` / `Fixed` / `Removed` / `Docs`（保持与业界惯例一致），正文用中文。

> 说明：本仓库的 git 历史经过压平，`0.2.0` 之前的版本没有可回溯的分界，因此**从 `0.2.0` 开始记录**。

## [Unreleased]

### Changed
- 首页卡片文字放大 **1.15 倍**：工作流标题 `13 → 15px`，更新时间与分类标签 `10.5 → 12px`，标题加 `line-height: 1.34` 避免大字行高过松；分类标签胶囊从更新时间左侧移到**右侧**
- `POST /api/workflows/move`（改分类归属）**不再刷新 `updated_at`**：归属不是内容改动，而首页按 `updated_at DESC` 排序，之前整理完一批卡片会集体跳到最前、还显示「更新于 刚刚」。`revision` 同样不动，不干扰编辑器乐观锁
- `product-ad-360` 模板的默认素材从程序生成的灰底占位图换成**真实示例图** `product-sample.jpg`（AI 生成护肤瓶，1254² 源图压到 1024²/63KB），开箱即可跑出像样的演示效果
- 模板示例素材的取向不再一刀切：`talking-head-loop` 仍用明显假的占位图（提示必须替换），`product-ad-360` 用真实但通用的示例图。共同红线是不放「像用户自己产品」的图
- `scripts/gen-template-assets.mjs` 默认**不覆盖已存在文件**（加 `--force` 才重生），避免把手工换进去的素材盖回灰框；`product-ad-360` 已移出脚本管辖
- **5 个模板都补上了封面图** `templates/<id>/cover.jpg`（1024×576，合计 334KB）：产品广告＝护肤瓶影棚图、30 秒长片＝橘猫穿过客厅、竖屏短剧＝雨夜霓虹、口播＝女主播在书房、双风格＝白鹭晨雾。之前卡片顶部只有渐变色块兜底
- 工作流卡片右上角的「N 条连线」改成**胶囊标签**：压一层半透明暗底 + `backdrop-filter: blur(8px)`，不管底下是分类色块还是产物首帧，文字都不再跟背景撞色（暗底取 `rgba(8,8,12,.55)`，与卡片勾选角标同色）

### Fixed

- **有缩略图的工作流卡片点不到右上角「更多」**：`has-img` 时 `.wb-card__edges`（「N 条连线」）被抬到 `z-index:2` 压住图片遮罩，正好盖住三点按钮，点击漏给卡片的 `onClick` 直接进了画布。给 `.wb-card__ops` 补 `z-index:3`，按钮重新吃到点击（无缩略图的卡片本来就不受影响，所以只在跑过的工作流上复现）
- **首页工作流卡片高度不齐**：有产物首帧的卡片走 `.has-img` 的 104px 缩略图、没跑过的走 88px，同一排混放会让标题上下错位 16px（「角色替换」「30 秒连续长片」齐平，「双风格对照」标题偏高）。去掉单独高度，`.wb-card__thumb` 基础值统一为 104px，有图/无图同档
- **`.gitignore` 的 `assets/` 规则会忽略 `templates/<id>/assets/`**：裸目录名不带前导斜杠时匹配任意层级，导致模板素材不进仓库、别人克隆后模板引用悬空。改为 `/assets/`、`/downloads/`、`/out/`
- **上传的视频素材显示成空白格**：素材缩略图一律用 `<img src="/api/assets/xxx.mp4">` 渲染，而 `<img>` 出不了视频画面，参数面板和画布节点卡片都只剩一个灰方块。新增 `graph/model.js` 的 `assetKind()`（先看上传时记下的 `mime`，老数据退回落盘扩展名），只有图片走 `<img>`，视频/音频改给类型图标（胶片 / 音符）+ 悬停提示
- **视频/音频素材的 data URI MIME 被写死成 `image/*`**：`runner.mjs` 的 `assetUrl()` 用 `data:image/${ext}` 拼接，参考视频送到网关就成了 `data:image/mp4`，被参数校验直接挡掉（2013）。改为按扩展名映射真实 MIME（`video/mp4`、`video/quicktime`、`audio/mpeg`…），未知类型退回 `application/octet-stream`
- **素材上传的 mime ↔ 扩展名表太窄**：`webm` / `mov` / `m4a` / `ogg` 等一律落成 `.bin`，浏览器不能预览、网关也不认。`server.mjs` 抽成成对的 `ASSET_MIME_TO_EXT` / `ASSET_EXT_TO_MIME`，上传按 mime 定扩展名、读取按扩展名回 `content-type`，并在上传响应里回带 `mime`

### Added

- **画布节点里直接看视频素材**：`media.*` 节点不再只给一个胶片图标，视频在卡片里内嵌播放器，不用先选中节点再开面板/预览层。默认只放开第一个，其余折叠成「+N」胶囊，点开发在节点内**竖向一行一个**排开（再点「收起素材」收回），纯图片/音频节点维持原来的 42px 小方格缩略图
  - 播放器 `src` 带 `#t=0.1` + `preload="metadata"`：只拉元数据，但首帧能出画面，否则卡片上是一块纯黑
  - 播放器带 `nodrag nowheel`：不拦的话拖进度条会拖走节点、滚轮会缩放画布
  - 全局同时只播一个：`components/NodeVideo.jsx` 的 `claimPlayback()` 是模块级单例，预览层自动播放也算「开播」，会把画布里的暂停掉（不会两个声音叠在一起）
- **`GET /api/assets/:name` 支持 Range**（`206` / `Accept-Ranges` / `416` / 后缀区间）：之前一律回 200 整包，内嵌播放器要等整个文件下完才能拖进度条，几 MB 的参考视频基本没法看。素材路由改走流式 `sendFileWithRange`，`/downloads/` 静态托管未改
- **素材放大预览**：点参数面板里的素材缩略图开全屏预览（`components/AssetLightbox.jsx`）。图片支持滚轮缩放（1–8 倍，以光标为中心）、双击放大/复位、放大后拖拽平移（带边界钳制，不会拖丢）；同一节点多张素材用 ← → 或底栏按钮循环切换，`Esc` / 点空白 / 右上角关闭。视频和音频在同一个预览层里直接用原生控件播放，底栏还有「打开原图」
  - 走 `createPortal` 挂到 `body`：`position: fixed` 遇到带 `transform` 的祖先把锚点算错
  - 键盘监听挂 **capture 阶段并就地 `stopPropagation`**：编辑器在 `window` 上也听着 keydown，不拦的话预览开着按 `Delete` 会直接删掉选中节点
- **工作流卡片缩略图**：run 成功结束时自动抽产物首帧存 `data/thumbs/<wfId>.jpg`，首页卡片顶部铺成背景图（叠暗色遮罩保证节点数可读），高度从 88px 提到 104px；没跑过的画布仍用分类色块。抽帧异步执行、失败只记日志，不影响运行结果
  - 实现：`media-tools.saveThumb()` 用 `-ss 0.3 -i <url>`（input seeking）抽帧，对 CDN 链接只读开头不拉整个视频；取 0.3 秒避开开头黑场
  - 新增 `GET /api/workflows/:id/thumb`；`GET /api/workflows` 对存在缩略图的项返回 `thumb` 字段

- **工作流卡片拖到左侧分类**：首页直接把卡片拖到分类上松手即完成改归属，拖到「未分类」即移出分类，「全部」明确拒收（显示禁止符）。多选状态下拖其中一张 = 整批一起移
  - 侧栏是**唯一投放区**，靠 `data-cat` 属性认人（存 id 不存名字），`dragover` 里 `closest('[data-cat]')` 逐帧重算落点。不用「每个分类项各挂一套 handler」是因为分类项内全是子 `span`，`dragleave` 会冒泡导致高亮狂闪
  - 一次拖多张时用 `setDragImage` 自定义拖影并带「N 个」角标；单张仍用浏览器原生快照
  - 分类多到侧栏要滚动时，拖到上下边缘**自动滚动**（rAF 驱动；`dragover` 被浏览器节流，不能用来驱动滚动）
  - 卡片要从当前视图消失时先淡出 160ms 再刷新，避免「瞬间消失」看着像误操作
  - 卡片「更多」菜单补二级「移动到分类」（当前位置打勾），兼作触屏/键盘兜底；它与拖拽、原多选「移动到分类」共用同一个 `moveIdsTo`

- **内置画布模板（5 个）**：首页「从模板新建」→ 选模板 → 填 1–3 个参数 → 直接得到一张能跑的画布。模板是 `templates/<id>/` 目录（`manifest.json` + `workflow.json` + `assets/`），实例化复用导入链路：素材改名落盘、节点引用重写、重名加 (2)(3)
  - **30 秒连续长片**：生成 → 抽尾帧 → 当下一段首帧 → 再生成 → 拼接（网页端做不到的连续镜头）
  - **竖屏短剧 3 镜**：9:16，三镜共用同一段人物描述锁长相，负向词直连每个生成节点，拼接成 18 秒
  - **产品广告 360°**：产品图锁成第一帧 + 环绕运镜（带占位素材）
  - **口播固定背景**：背景图作为参考素材锁场景，预览面板设为循环（带占位素材）
  - **双风格对照**：两条独立分支一次出两个版本对比，**双倍计费**已在描述中标注
- 新接口 `GET /api/templates`、`POST /api/templates/:id/instantiate`、`GET /api/templates/:id/cover`；模板 id 走白名单正则 + 拒绝 `..`，防目录穿越
- 模板可声明 `params`（生成参数表单，target 精确到节点字段，类型按声明归一、越界夹紧、非法枚举退回默认）与 `requires`（必填素材，前端渲染警告）
- `scripts/gen-template-assets.mjs`：用 ffmpeg `color` + `drawbox` + `drawgrid` + `drawtext` 程序化生成占位素材（带文字），跨平台字体探测，找不到字体退化为无文字版；`gradients` 滤镜在当前 ffmpeg build 上不可用，故未采用

### Changed

- `completeGraph` 的出口判定修正：`video.concat` 视为**汇聚节点**，其上游 `task.watch` 不再被要求直连 `output.*`。修复「多段生成 → 拼接 → 输出」被补出成对冗余 preview/download 的问题

### Fixed

- 模板实例化的 `assetHints.isPlaceholder` 恒为 false：素材落盘会被改名（防覆盖同名），改名后文件名里已无 `placeholder`，改回用模板原始节点判断

## [0.3.0] - 2026-10-23

首页交互打磨 + 工作流导入导出。

### Added

- 首页工作流卡片新增**重命名弹窗**与**删除确认弹窗**，均为应用内模态框（`wb-modal`），替代浏览器原生 `prompt` / `confirm`
- 新增 i18n 键 `home.renameTitle` / `home.name` / `home.deleteTitle`
- 画布视角记忆：平移 + 缩放按工作流分别记住（localStorage `wb.view.<wfId>`），重进/刷新回到上次停的位置；`ReactFlow` 加 `key={wfId}`，否则换流时 `defaultViewport` 不重新生效
- 首页工作流**导入 / 导出（.zip）**：包内是 `workflows.json` + `assets/<文件>`（素材原文件，不走 base64）；卡片菜单导出单个，工具栏「导出全部」导出全库含分类；导入只收 zip，素材落回 `assets/` 换新文件名并重写节点引用，工作流一律新建副本、重名加 (2)(3)。服务端 `GET /api/export[?wfId=]` + `POST /api/import`，zip 用 npm 的 `fflate`

### Changed

- `.wb-modal__foot` 按钮改为右对齐（`justify-content: flex-end`），与「取消 / 确认」的常规位置一致；新增 `.wb-modal__text` 用于弹窗正文
- 卡片「更多」菜单里的重命名不再自己关菜单，统一由 `rename()` 收口
- 通知列表相邻项之间加 5px 间距：未读项带底色，原来紧贴会连成一整块，看不出是一条条消息
- 任务浮层：标题栏的刷新改成图标按钮，与关闭按钮一起靠右（关闭在最右）；任务只列**当前工作流**的——`GET /api/tasks?wfId=` 用 `runs.outputs` 的 `task_id` 反查过滤
- toast 从底部居中改到**顶部居中**（`top: 66px`，避开 54px 顶栏），入场动画改为从上方滑入（新增 `wb-toast-in`，自带 `translateX(-50%)` 保证居中不被动画位移破坏）

### Fixed

- 修复首页工作流卡片「重命名」点击无反应：原实现用 `window.prompt`，在桌面壳（Electron / webview）里既不弹窗也不返回，改为状态驱动的输入弹窗，支持 Enter 保存、Esc 取消、聚焦全选
- 工作流删除不再弹浏览器 `confirm`，改用自定义确认弹窗（危险按钮红色），取消/确认行为均已验证
- **修复重命名后节点全部消失**：`PUT /api/workflow/:id` 是整体替换，首页重命名只传 `{ name }` 时把 `nodes` / `edges` 一起清空了。服务端改为：body 没带 `nodes`/`edges` 就沿用原图，没带 `name` 就沿用原名；要清空必须显式传 `nodes: []`
- 右侧「结果 / 参数」面板内容变高时不再把整页顶长：`.wb-dock` / `.wb-inspector` / `.wb-runpanel` 补 `min-height: 0`，超出部分改为面板内部滚动
- 校验误报「「gen.video」需要连接至少一个非空 text」：`text.merge` / `text.vars` 是**透传**节点（自身无 `text` 字段），原校验只看直连节点就判空。现在顺着连线回溯上游，与 runner 的实际取值语义一致（含环路保护）

## [0.2.0] - 2026-10-23

首个对外记录版本（对应 `package.json` 的 `0.2.0`）。

### Added

- **节点画布编辑器**：20 类节点，覆盖输入 / 生成 / 处理 / 逻辑 / 输出五组；拖拽连线即参数传递，`web/src/graph/model.js` 是节点唯一扩展点（类型、端口、字段、校验、LLM schema 都在这）
- **多画布与分类**：首页按分类列出画布，支持新建 / 重命名 / 复制 / 移动 / 删除；两个页面走 hash 路由（`#/`、`#/wf/<id>`）
- **SQLite 唯一真相**：图、分类、通知、运行记录全部落 `data/workbench.db`（`node:sqlite`），开启 WAL；写入走 revision 乐观锁，冲突返回 `409`，不静默覆盖
- **语义化增量改图**：`POST /api/workflow/:id/patch` 支持 `add_node` / `update_node` / `remove_node` / `connect` / `disconnect`，替代整图覆盖；`add_node` 未给坐标时按网格自动错开
- **AI 改流程**：一句话 → LLM 输出语义化 ops → 服务端校验 → 应用后经 `lib/graph-complete.mjs` 确定性补齐（`gen.* → task.watch → output.preview + output.download`，`gen.video` 缺负向词则补一个），补齐幂等、响应带 `autoFilled`
- **AI 提示词优化**：`POST /api/llm/optimize` 返回优化建议与原文，先预览、用户确认后才写回节点
- **执行引擎**：拓扑排序调度 + 节点级状态（`running` / `success` / `error` / `skipped` / `cancelled`）+ 失败自动 `DELETE` 网关任务（全额退款）+ 单步运行（复用上次输入输出，不重复计费）+ `dryRun` 干跑预估（不碰网关）；同一画布同时只允许 1 个 run
- **实时运行可视化**：`GET /api/run/:id/events` SSE 推送 `run:start` / `run:node` / `run:done`，前端轮询仅作断线降级；run 记录每画布保留最近 50 条
- **媒体处理链**：抽帧、拼接、比例修正（自动加边到 0.4–2.5 闭区间）、探针，跨节点串接多段视频；ffmpeg / ffprobe 二进制随 npm 分发，无需系统单独安装
- **通知中心**：运行结束写入 `run.succeeded` / `run.failed`，铃铛面板只保留最近 200 条
- **中英双语**：UI 文案全走 `web/src/i18n.jsx`，跟随浏览器语言、缺省中文；节点与字段用 `labelKey`
- **剧本预设**：13 条预设 / 5 组，内置五要素（题材 / 人物 / 节拍 / 镜头 / 时长分辨率 + 负向词方向），点选只填入输入框、不自动执行
- **设置弹窗**：Token / 网关地址 / LLM 三项可改，密钥只回掩码；LLM 容量（`maxTokens` / `contextWindow`）可调，用量 ≥80% 变黄提示
- **视觉令牌**：靠背景色阶（`surface-1`→`surface-4`）分层而非边框，只有状态（选中 / 聚焦 / 成功 / 失败）才用描边或光晕

### Changed

- 网关地址优先级明确为 `config.json` 的 `baseUrl` > 环境变量 `MINIMAX_BASE_URL` > 内置默认
- 外部改图统一走 HTTP ops → SSE `wf:changed` 推送；编辑器自身写入带 `X-WB-Origin: editor` 头，避免误弹「外部改动」提示

### Removed

- 移除历史 JSON 文件的迁移逻辑与旧配置接口，图的读写只剩 SQLite + HTTP 这一条路径
- 移除对图文件的监听（不再监听文件变化）

### Docs

- 新增「支持的平台」与计费章节：按分辨率与时长给出价目表，并说明优先通道、Context IR、输入素材的计费规则
- 补全本地 HTTP 接口清单与已知限制（任务 7 天过期、限流重试、签名链接过期、音轨未验证）

---

[Unreleased]: https://github.com/regaing/lingxi-director/compare/v0.3.0...HEAD
[0.3.0]: https://github.com/regaing/lingxi-director/releases/tag/v0.3.0
[0.2.0]: https://github.com/regaing/lingxi-director/releases/tag/v0.2.0
