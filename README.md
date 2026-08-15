# opencode-anchored-standard

**默认精简模式插件**（v5.4）：精简锚定是默认行为——每个会话（build/minimal/子代理）的第一个模型请求统一精简锚定，之后恢复完整工具。

## 核心方案（v5.4，2026-08-15）

**触发**：默认启用，无需任何选择/预热。任何会话的第一个模型请求自动精简锚定。

**机制**（对齐 DeepSeek Harness 官方 minimal + anchored-standard 两阶段语义）：

1. **首条消息**（消息数 = 0）：消息 agent 改写为 minimal —— 首轮窄工具面 `read/bash/edit/write + webfetch`（官方 `bash + str_replace_editor` 功能等价 + 网页抓取；`glob` deny，报告实测其为轨迹破坏分界）
2. **system 层**：锚定会话的每次模型请求，system prompt 替换为官方 minimal 唯一 persona 句 `You are a helpful software engineer assistant.`（官方 `minimal-preset.snapshot.ts` 快照锁定原文，含句号；等价官方 `complete: true` 屏蔽其他 system 段）
3. **恢复（统一时间点）**：第一个模型请求发起时（system.transform 首次触发）`switchAgent` 回恢复目标——`switchAgent` 语义是 "subsequent provider turns"，不影响当前请求，因此第一个请求保持 minimal（窄工具面 + persona 生效），第二个请求起全工具
4. **恢复目标 = 会话自身 agent**：build 会话 → build；子代理 general → general；用户手动选 minimal → build
5. **第二条消息兜底**：若 switchAgent 尚未生效（仍是 minimal），消息 agent 改回恢复目标（消息级改写只对本回合生效，已实证）

**主子代理统一**：不区分主会话与子代理（锚定的本质 = 每个会话第一个模型请求的输入控制，子代理同样适用）。

**第一性原理**：模型思维只受输入内容影响——精简模式 = 控制"输入中的 system prompt + 工具 schema"；首轮窄面选轨迹，随后恢复完整能力。

## 背景与证据

modeltest 在 Project2 工程维护评测（V4.1b 题面）上的实测：

| 跑法 | n | Ability | 均值 |
|---|---:|---:|---:|
| V4 Pro 正式 / OpenCode | 4 | 91, 96, 91, 93 | 92.75 |
| V4 Pro / DSH standard | 1 | 91 | 91 |
| V4 Pro / DSH PTC | 1 | 92 | 92 |
| **V4 Pro / DSH anchored-standard** | **2** | **98, 99** | **98.5** |
| V4 Flash / OpenCode 等 | 4 | 92, 93, 95, 93 | 93.25 |

用户本机实测（同任务「使用html技术，复刻马里奥第一关」，deepseek-v4-flash）：

| 跑法 | 耗时 | 轨迹指纹 | 备注 |
|---|---|---|---|
| 裸提示（无插件） | ~13 分钟 | `let me=159`（standard 轨迹），175K 巨型单块 | 一次性写盘无自检 |
| v5.4 精简模式 | ~2 分钟 | `we=118` / `let me=0`（minimal 轨迹），18 短块 | 语法检查+headless+vm 模拟自检 |

关键结论：

- DeepSeek V4 Pro 对**首次请求的 wire 层工具 schema** 高度敏感：官方 minimal preset 是 RL 对齐配置（官方快照测试明文 "sends the exact RL prompt and schemas"），模型在宽工具面下会偏航（`let me` 高频、上下文膨胀、搜索失控）。
- 增益来自**首次请求的窄工具面**，不是全程两工具、不是 Linux、不是单一工具入口（PTC 无效）。
- 微探针分界：`bash+read` → minimal 轨迹；**`bash+glob` → 直接回到 standard 轨迹**。
- Flash 的轨迹主要跟随 minimal persona 的精确措辞（persona 语义改写 → 回落到 standard-like），Pro 主要跟随首轮工具 schema。
- 影响来自"模型实际可调用的 schema surface"，不是看见一段工具名称文本。

## 文件

| 文件 | 安装位置 | 作用 |
|---|---|---|
| `agents/minimal.md` | `~/.config/opencode/agent/`（或 `agents/`） | 精简锚定 agent：permission 仅 read/bash/edit/write + webfetch |
| `plugins/anchored-standard.ts` | `~/.config/opencode/plugins/` | chat.message hook：首条消息改写 minimal；system.transform hook：system 替换为官方 persona + 首个请求后 switchAgent 恢复 |

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

无需任何操作：每个会话的第一个模型请求自动精简锚定（官方 persona system + 窄工具面），第二个请求起全工具。用户永远不需要切换模式；minimal 模式仅在首轮内部使用。

## 配置（环境变量，可选）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `OPENCODE_ANCHOR_RESTORE_AGENT` | `build` | 用户手动选 minimal 的会话的恢复目标 |

## 验证

- 新会话首条消息：wire 层 system 恰为一句 `You are a helpful software engineer assistant.`；模型只能调用 read/bash/edit/write/webfetch（要求用 glob 会被告知不可用）；
- 同会话第二条消息（或首个工具调用后的请求）：glob/grep/task 等全部可用，system 恢复完整；
- 子代理首条同样精简锚定，工具调用后恢复原 agent；
- 旧会话续开：不锚定（消息数 > 1）。

## 风险与限制

- 报告为 Project2 单题 n=2 复现，**不保证跨任务普适提升**，请按需实测；
- opencode 的 system prompt 组装机制与 DSH 的 `complete: true` 不完全相同（本插件用 system.transform 替换数组实现等价效果，已被 opencode 源码时序确认）；
- `switchAgent` 时序依赖 "subsequent provider turns" 语义（源码确认），已实测首轮工具面纯净；
- 插件在查询消息数失败时会跳过干预（宁可错过锚定，不破坏消息）。

## 参考

- [xiaobright/modeltest](https://github.com/xiaobright/modeltest)（研究报告：DEEPSEEK_V4_PRO_HARNESS_ANALYSIS_20260814 等）
- [xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)（DeepSeek Harness 原版 preset，本仓库为其 opencode 移植）
- [deepseek-ai/deepseek-harness](https://github.com/deepseek-ai/deepseek-harness)（官方 harness，minimal/standard preset 定义来源）
- [B站 BV15ZgN6NEDy](https://www.bilibili.com/video/BV15ZgN6NEDy)（up 主小明XBright）

## License

MIT
