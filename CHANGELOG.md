# 变更记录 · Changelog

本项目遵循 [Keep a Changelog](https://keepachangelog.com/zh-CN/1.1.0/) 结构，版本号遵循 [语义化版本](https://semver.org/lang/zh-CN/)。

小标题统一用 `Added` / `Changed` / `Fixed` / `Removed` / `Docs`（保持与业界惯例一致），正文用中文。

> 说明：本仓库的 git 历史经过压平，`0.2.0` 之前的版本没有可回溯的分界，因此**从 `0.2.0` 开始记录**。

## [Unreleased]

### Added

- 暂无

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

[Unreleased]: https://github.com/regaing/lingxi-director/compare/v0.2.0...HEAD
[0.2.0]: https://github.com/regaing/lingxi-director/releases/tag/v0.2.0
