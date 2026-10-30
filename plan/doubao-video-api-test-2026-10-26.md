# 豆包（Seedance）视频生成 API 测试报告

| 项 | 值 |
|---|---|
| 测试时间 | 2026-10-26 |
| 目标 | 验证 Agent Plan 专属 Key 能否通过 API 调用豆包视频生成 |
| 平台 | 火山方舟 Agent Plan（数据面 `https://ark.cn-beijing.volces.com/api/plan/v3`） |
| 结论 | ⚠️ **视频生成不可用**；同一把 Key 的**图片生成可用** |
| 判定 | Key 有效、数据面路由正确，**套餐档位不含视频能力**（极可能为 Small 或 Medium） |

---

## 1. 结论速览

1. **鉴权是通的**：`GET /api/plan/v3/contents/generations/tasks` 返回 200，`{"total":0,"items":[]}`。
2. **Key 不是坏的、也不是 Coding Plan Key**：同一把 Key 调 `POST /api/plan/v3/images/generations` **一次成功出图**。
3. **视频能力被权限层拒绝**：文档列出的 4 个 seedance 模型 + 1 个旧版模型，**全部**返回 `HTTP 404 / UnsupportedModel`，报错文案统一为 *"The requested model does not support the agent plan feature"*。
4. **不是名字拼错**：点号（`2.5`）与连字符（`2-5`）两种写法都被拒；而图片模型的点号写法能成功并被服务端自动归一为连字符。
5. **不是参数错误**：探针只传了最小参数集（`model` / `content` / `ratio` / `duration`），没碰 `generate_audio`、`watermark`，排除了参数校验干扰。
6. **官方约束吻合**：视频模型仅 `Large` / `Max` 档可用，`Small` / `Medium` 为 ✗；图片模型四档全 ✓ —— 与实测现象**完全一致**。

> **本次花费：0 段视频额度**。5 次视频请求全部在「创建任务」阶段被拒，从未进入生成队列，不产生 AFP 扣费；仅成功的那张图消耗了常规图片额度。

---

## 2. 测试矩阵与证据

数据面 Base URL：`https://ark.cn-beijing.volces.com/api/plan/v3`
鉴权：`Authorization: Bearer <AGENT_API_KEY>`

| # | 请求 | 模型 | 结果 | request id |
|---|---|---|---|---|
| 1 | GET `/contents/generations/tasks?page_num=1&page_size=2` | — | ✅ 200 `{"total":0,"items":[]}` | `021793004397432d…65fe5bbe` |
| 2 | POST `/contents/generations/tasks` | `doubao-seedance-2.0-mini` | ❌ 404 `UnsupportedModel` | `0217930044812794…29c22774` |
| 3 | POST `/contents/generations/tasks` | `doubao-seedance-2.5` | ❌ 404 `UnsupportedModel` | `0217930044889964…7fdc7` |
| 4 | POST `/contents/generations/tasks` | `doubao-seedance-2.0` | ❌ 404 `UnsupportedModel` | `0217930045319804…9be0184` |
| 5 | POST `/images/generations` | `doubao-seedream-5.0-flash` | ✅ **200 出图** | `0217930045379074…19d` |
| 6 | POST `/contents/generations/tasks` | `doubao-seedance-2-5`（连字符） | ❌ 404 `UnsupportedModel` | `0217930045571629…306a` |
| 7 | POST `/contents/generations/tasks` | `doubao-seedance-2.0-fast` | ❌ 404 `UnsupportedModel` | `0217930045680454…8ea59` |
| 8 | POST `/contents/generations/tasks` | `doubao-seedance-1.5-pro`（旧版兜底） | ❌ 404 `UnsupportedModel` | `0217930045681274…c0977` |

失败响应原文（8 次完全一致，仅 request id 不同）：

```json
{
  "error": {
    "code": "UnsupportedModel",
    "message": "The requested model does not support the agent plan feature. Please refer to the documentation at https://www.volcengine.com/docs/82379/2366394 to select a compatible model. Request id: ...",
    "param": "",
    "type": ""
  }
}
```

注意 `param` 为空 —— 说明**不是某个字段填错**，而是「模型 × 套餐」的授权组合被否决。

---

## 3. 成功样本：图片生成（作为 Key 有效性的对照实验）

请求：

```json
POST https://ark.cn-beijing.volces.com/api/plan/v3/images/generations
{
  "model": "doubao-seedream-5.0-flash",
  "prompt": "一只橘猫在洒满阳光的木窗台上伸懒腰，写实摄影风格",
  "size": "1024x1024",
  "response_format": "url"
}
```

响应（节选）：

```json
{
  "model": "doubao-seedream-5-0-flash",
  "created": 1793004546,
  "data": [{
    "url": "https://ark-acg-cn-beijing.tos-cn-beijing.volces.com/…jpeg?X-Tos-Expires=86400&…",
    "size": "1024x1024",
    "output_format": "jpeg"
  }],
  "usage": { "input_images": 0, "generated_images": 1, "output_tokens": 4096, "total_tokens": 4096 }
}
```

可用信息：

- **点号模型名会被服务端自动归一化**为连字符形态（`doubao-seedream-5.0-flash` → `doubao-seedream-5-0-flash`）。
- 图片接口是**同步**的，直接返回 `data[].url`，不像视频要走任务轮询。
- 返回的是 TOS 预签名 URL，`X-Tos-Expires=86400` —— **24 小时过期**，必须当场下载落盘。
- 产物已下载：`out/doubao-test/seedream-5.0-flash_canary.jpeg`（322 KB）。

---

## 4. 关键发现（可复用于后续接入）

| # | 发现 | 说明 |
|---|---|---|
| F1 | 视频与图片**共用同一个 `/plan/v3` 数据面**，鉴权头一致 | 不需要两套凭证 |
| F2 | 视频是**异步任务制**：`POST /contents/generations/tasks` 建任务 → `GET .../tasks/{id}` 轮询 | 与秘塔 H3 的 `/v2` 同构 |
| F3 | 视频任务列表 `GET /contents/generations/tasks` **不校验模型权限**，模型无权限时仍返回 200 空列表 | 不能拿它当「能不能用视频」的判断依据，**必须真发一次创建请求** |
| F4 | 模型名形态容错不一致 | 图片：点号/连字符都认；视频：本次两种都被拒（因权限而非名称，待档位补足后复验） |
| F5 | **套餐额度/档位查不到** | 额度与档位在**控制面**，只认 SSO 身份或 AK/SK；API Key 只是数据面凭证。想用 API 查「我还剩多少」走不通，只能看控制台 |
| F6 | 报错码与业务码分离 | Agent Plan 这层用的是 `UnsupportedModel`，不是后付费那套 `2013` 参数校验码 |
| F7 | ⚠️ 文本/向量模型**禁止**走 API | 官方明确：Agent Plan 的文本生成与向量化模型不可用于 API 调用，用套餐 Base URL + Key 在非 AI 工具里调用可能被判**滥用**，导致**订阅停用/账号封禁**。只有**视觉模型**（图/视频）可用于 API |

---

## 5. 最可能原因与确认方式

### 原因判定

官方兼容清单（`https://www.volcengine.com/docs/82379/2366394`）给出的档位矩阵：

| 模型族 | Small | Medium | Large | Max |
|---|---|---|---|---|
| `doubao-seedance-2.0` / `2.0-fast` / `2.0-mini` / `2.5`（视频） | ✗ | ✗ | ✓ | ✓ |
| `doubao-seedream-5-0-pro` / `5.0-flash`（图片） | ✓ | ✓ | ✓ | ✓ |

实测「图片通、视频全拒」与该矩阵的 Small/Medium 行**逐格吻合**，因此判定为**档位不足**，而非 Key 或代码问题。

### 如何确认（Key 自身查不了）

到 **Agent Plan 控制台 → 套餐概览** 看当前档位：

| 档位 | 月费 | 月额度 | 5 小时额度 | 视频生成 |
|---|---|---|---|---|
| Small | 40 元 | 20,000 AFP | 2,000 | ✗ |
| Medium | 200 元 | 100,000 AFP | 10,000 | ✗ |
| **Large** | **500 元** | **250,000 AFP** | **25,000** | **✓** |
| **Max** | **1000 元** | **500,000 AFP** | **50,000** | **✓** |

- 若确认是 **Small / Medium** → 结论闭合，**升到 Large 或 Max 后重跑第 6 节脚本即可**。
- 若确认已是 **Large / Max** → 说明是账号侧权益异常（如套餐未生效 / 席位 Key 与个人版档位不匹配），带上第 2 节任一 request id 提工单最快。

---

## 6. 复测脚本（档位补足后一键执行）

> 出于卫生考虑，本文件不写入任何 Key。执行前把 Key 放进环境变量。

```powershell
$env:ARK_PLAN_KEY = "<你的 Agent Plan 专属 Key>"

$body = @{
  model    = "doubao-seedance-2.5"
  content  = @(@{ type = "text"; text = "无人机航拍雪山日出，缓慢右移，云海翻涌" })
  ratio    = "16:9"
  duration = 5
} | ConvertTo-Json -Depth 6 -Compress

$resp = curl.exe -s -X POST "https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks" `
  -H "Content-Type: application/json" `
  -H "Authorization: Bearer $env:ARK_PLAN_KEY" `
  -d $body

$resp
# 成功时返回形如 {"id":"cgt-xxxx"}，再轮询：
# curl.exe -s "https://ark.cn-beijing.volces.com/api/plan/v3/contents/generations/tasks/<id>" -H "Authorization: Bearer $env:ARK_PLAN_KEY"
```

判定标准：

- 返回 `{"id":"cgt-…"}` → 视频权限已开通，进入轮询。
- 仍返回 `UnsupportedModel` → 档位或账号权益未到位，走工单。

---

## 7. 与现有项目的对照（仅供后续决策，本次不实施）

若将来要在「灵动导演台」接入豆包，与现有秘塔 H3 通道的差异点：

| 维度 | 秘塔 H3（现状） | 豆包 Seedance（Agent Plan） |
|---|---|---|
| Base URL | `https://metaso.cn/api/minimax` | `https://ark.cn-beijing.volces.com/api/plan/v3` |
| 建任务 | `/v2/video_generation` | `/contents/generations/tasks` |
| 轮询 | `/v2/query/video_generation` | `/contents/generations/tasks/{id}` |
| 鉴权 | `Bearer mk-…` | `Bearer ark-…`（套餐专属） |
| 文生视频入参 | `content` 为字符串，参数平铺 | `content` 为**数组** `[{type,text}]`，`image_url` 与之同构（天然支持图生视频） |
| 音频 | 无音轨（需后期配） | 有 `generate_audio` 开关 |
| 计费 | 按单价 × 时长 | AFP 积分抵扣，超额自动转后付费 |

结论：协议形态与现有 runner 的「建任务 → 轮询 → 落盘」三段式**足够接近**，抽象一层 provider 是可行的；但当前档位下无法验证视频链路，接入应为**后置事项**。

---

## 8. 待办

- [ ] 到控制台确认当前套餐档位，判断是否为 Small/Medium
- [ ] 若为 Small/Medium：决策是否升级到 Large（500 元/月）再复测
- [ ] 若已是 Large/Max：带 request id 提工单
- [ ] 视频链路验证通过后，再评估 provider 接入（见第 7 节）
