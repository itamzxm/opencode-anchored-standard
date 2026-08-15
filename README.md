# opencode-anchored-standard

**手动极简模式插件**（A 方案，v5）：用户选择极简（minimal）agent 后，插件在首轮实现与 DeepSeek Harness 官方 minimal preset 一致的 wire 层效果，首轮之后恢复完整工具面。

## 核心方案（v5，2026-08-15）

**触发**：用户手动选择 `minimal`（极简）agent 后插件才生效；不选择则完全不干预（无感自动检测已移除）。

**生效机制**（对齐官方 minimal + anchored-standard 两阶段语义）：

1. **首条消息**（会话消息数 = 0）：保持 minimal —— 首轮窄工具面 `read/bash/edit/write`（官方 `bash + str_replace_editor` 功能等价；`glob` deny，报告实测其为轨迹破坏分界）
2. **system 层**：锚定会话的每次模型请求，system prompt 替换为官方 minimal 唯一 persona 句 `You are a helpful software engineer assistant.`（官方 `minimal-preset.snapshot.ts` 快照锁定原文，含句号；等价官方 `complete: true` 屏蔽其他 system 段）
3. **第二条消息起**：消息 agent 改写为恢复目标（默认 `build`）—— 本回合起全工具（官方 anchored-standard：首个工具调用后恢复完整 Standard 目录；消息级 agent 改写只对本回合生效，已实测）
4. **子代理**：继承 minimal 时直接改回恢复目标（v2 实证：子代理全程窄工具会权限受限无法读外部目录）；子代理不进锚定 Set、system 不被替换
5. **切走即停**：用户切回非 minimal agent → 停止干预，system 恢复原样

**第一性原理**：模型思维只受输入内容影响——极简模式 = 控制"输入中的 system prompt + 工具 schema"；首轮窄面选轨迹，随后恢复完整能力。

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
- 影响来自"模型实际可调用的 schema surface"，不是看见一段工具名称文本。

## 文件

| 文件 | 安装位置 | 作用 |
|---|---|---|
| `agents/minimal.md` | `~/.config/opencode/agent/`（或 `agents/`） | 极简模式 agent：permission 仅 read/bash/edit/write |
| `plugins/anchored-standard.ts` | `~/.config/opencode/plugins/` | chat.message hook：极简模式首条保持、后续恢复、子代理豁免；system.transform hook：锚定会话 system 替换为官方 persona |

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

## 使用

1. 新建会话，在 agent 选择中选 **minimal（极简）** —— 首条消息自动获得极简锚定（官方 persona system + 窄工具面）
2. 第二条消息起自动恢复 `build`（全工具）
3. 不选 minimal → 插件完全不干预（等同未安装）

## 配置（环境变量，可选）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `OPENCODE_ANCHOR_RESTORE_AGENT` | `build` | 首轮后恢复的 agent 名 |

## 验证

- 选 minimal 后首条消息：wire 层 system 恰为一句 `You are a helpful software engineer assistant.`；模型只能调用 read/bash/edit/write（要求用 glob 会被告知不可用）；
- 第二条消息起：glob/grep 等全部可用；
- 不选 minimal：完全无感，等同未安装；
- 子代理：工具面不受限（继承 minimal 时自动恢复 build）；
- 切回 build 后：system 恢复原样。

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
