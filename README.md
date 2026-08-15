# opencode-anchored-standard

DeepSeek V4 Pro / Flash 首轮锚定插件（anchored-standard）的 **opencode 移植版**，全自动无感。

把 [xiaobright/modeltest](https://github.com/xiaobright/modeltest) 研究报告（2026-08-14）验证有效的机制移植到 [opencode](https://opencode.ai)，并**对齐官方 DeepSeek Harness minimal preset 的 wire 层定义**。

## 核心方案（v4 官方对齐版，2026-08-15）

**首轮（会话第一个模型请求）做两件事，之后完全不干预：**

1. **system 层对齐**：`experimental.chat.system.transform` 把 system prompt 替换为官方 minimal 唯一 persona 句——`You are a helpful software engineer assistant.`（官方 `minimal-preset.snapshot.ts` 快照锁定原文；等价官方 `complete: true` 屏蔽全部其他 system 段的语义）
2. **工具面收窄**：`chat.message` 把首条消息的 agent 改写为 minimal（permission 仅 `read/bash/edit/write`，即官方 `bash + str_replace_editor` 的功能等价：view≈read、str_replace≈edit、insert≈write；`glob` 保持 deny——报告微探针实测 `bash+glob` 会直接回到 standard 轨迹）

**判定**：首轮 = 陌生会话 + 消息数 == 1（用户消息已保存、assistant 尚未创建的时刻），Set 幂等，工具回合/后续轮次/旧会话均不干预（进程重启后旧会话消息数 > 1，不会误锚定）。

**子代理**：同样获得首轮 persona system（子代理会话工具面不受限——chat.message 仍排除子代理，避免其被限制为窄工具集）。

**移除**：v3 的 user 首句注入已移除（system 层已承担 persona，双份冗余且官方无此机制）。

**第一性原理**：模型思维只受输入内容影响——锚定的全部意义就是控制"首次请求输入中的 system prompt + 工具 schema"。minimal agent 的 permission deny 效果即工具描述根本不进请求，与"拦截描述"等价。

## 背景与证据

modeltest 在 Project2 工程维护评测（V4.1b 题面）上的实测：

| 跑法 | n | Ability | 均值 |
|---|---:|---:|---:|
| V4 Pro 正式 / OpenCode | 4 | 91, 96, 91, 93 | 92.75 |
| V4 Pro / DSH standard | 1 | 91 | 91 |
| V4 Pro / DSH PTC | 1 | 92 | 92 |
| **V4 Pro / DSH anchored-standard** | **2** | **98, 99** | **98.5** |
| V4 Flash / OpenCode 等 | 4 | 92, 93, 95, 93 | 93.25 |

关键结论：

- DeepSeek V4 Pro 对**首次请求的 wire 层工具 schema** 高度敏感：官方 minimal preset 是 RL 对齐配置（官方快照测试明文 "sends the exact RL prompt and schemas"），模型在宽工具面下会偏航（`let me` 高频、上下文膨胀、搜索失控）。
- 增益来自**首次请求的窄工具面**，不是全程两工具、不是 Linux、不是单一工具入口（PTC 无效）。
- 微探针分界：`bash+read` → minimal 轨迹；**`bash+glob` → 直接回到 standard 轨迹**。
- Flash 的轨迹主要跟随 minimal persona 的精确措辞（persona 语义改写 → 回落到 standard-like），Pro 主要跟随首轮工具 schema。
- 影响来自"模型实际可调用的 schema surface"，不是看见一段工具名称文本——模型只关心输入内容，可见性决定思维。

## 官方定义对齐（v4 新增，来源 deepseek-ai/deepseek-harness）

| 维度 | 官方 minimal | 本插件对齐 |
|---|---|---|
| system prompt | 恰一句 `You are a helpful software engineer assistant.`（complete: true） | system.transform 首轮替换为该句（含句号） |
| 工具 1 | 持久 `bash`（timeout 300s） | `bash` |
| 工具 2 | `str_replace_editor`（maxOutputChars 16000） | `read`（view）+ `edit`（str_replace）+ `write`（insert） |
| 无 compaction / 无 AGENTS.md 注入 / 无 sandbox | 官方 minimal 无这些 | opencode 侧不额外注入，对齐"无额外 system 段" |
| 首轮后 | anchored-standard：首个工具调用后恢复完整 Standard 工具 | 本插件：首轮后不再干预，工具面与 system 完整恢复 |

无法对齐的边界：官方 `persistent bash` 的镜像/无网描述与 300s 超时、`str_replace_editor` 的确切 schema 是 DSH 内建行为，opencode 只能对齐"可见面"（工具名集合 + system 内容），不能复刻行为本体。

## 文件

| 文件 | 安装位置 | 作用 |
|---|---|---|
| `agents/minimal.md` | `~/.config/opencode/agent/`（或 `agents/`） | minimal 锚定模式：permission 仅 read/bash/edit/write（其余工具描述不进请求） |
| `plugins/anchored-standard.ts` | `~/.config/opencode/plugins/` | system.transform hook：首轮 system 替换为官方 persona；chat.message hook：首次消息改写为 minimal，非首次退出 |

## 安装

```bash
# Linux/macOS
cp agents/minimal.md            ~/.config/opencode/agent/minimal.md
cp plugins/anchored-standard.ts ~/.config/opencode/plugins/anchored-standard.ts

# Windows PowerShell
Copy-Item agents\minimal.md            "$env:USERPROFILE\.config\opencode\agent\minimal.md"
Copy-Item plugins\anchored-standard.ts "$env:USERPROFILE\.config\opencode\plugins\anchored-standard.ts"
```

1. 完全重启 opencode（TUI 或桌面端）
2. 卸载：删除上述两个文件并重启

## 使用（无感）

无需任何操作：正常新建会话发消息即可——**每个会话的第一个模型请求自动锚定（官方 persona system + 窄工具面）**，之后所有请求全 system 全工具。用户永远不需要切换模式；minimal 模式仅在首轮内部使用。

## 配置（环境变量，可选）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `OPENCODE_ANCHOR_MODELS` | `deepseek-v4-pro,deepseek-v4-flash` | 生效的模型白名单，逗号分隔 |

## 验证

- 新会话首条消息：wire 层 system 恰为一句 `You are a helpful software engineer assistant.`；模型只能调用 read/bash/edit/write（要求用 glob 会被告知不可用）；
- 同会话第二条消息：glob/grep 等全部可用，system 恢复完整；
- 子代理首轮：system 同样替换为 persona 句，工具面不受限；
- 旧会话续开：不锚定（消息数 > 1）。

## 风险与限制

- 报告为 Project2 单题 n=2 复现，**不保证跨任务普适提升**，请按需实测；
- opencode 的 system prompt 组装机制与 DSH 的 `complete: true` 不完全相同（本插件用 system.transform 替换数组实现等价效果，已被 opencode 源码时序确认）；
- DeepSeek 服务端路由行为未知，若服务端变化锚定效果可能变化；
- 插件在查询消息数失败时会跳过干预（宁可错过锚定，不破坏消息）。

## 参考

- [xiaobright/modeltest](https://github.com/xiaobright/modeltest)（研究报告：DEEPSEEK_V4_PRO_HARNESS_ANALYSIS_20260814 等）
- [xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)（DeepSeek Harness 原版 preset，本仓库为其 opencode 移植）
- [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（官方 harness，minimal/standard preset 定义来源）
- [B站 BV15ZgN6NEDy](https://www.bilibili.com/video/BV15ZgN6NEDy)（up 主小明XBright）

## License

MIT
