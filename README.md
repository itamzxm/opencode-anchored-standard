# opencode-anchored-standard

DeepSeek V4 Pro / Flash 首轮锚定插件（anchored-standard）的 **opencode 移植版**，全自动无感。

把 [xiaobright/modeltest](https://github.com/xiaobright/modeltest) 研究报告（2026-08-14）验证有效的机制移植到 [opencode](https://opencode.ai)：**会话首次请求时拦截工具描述，wire 层只保留 read+bash 两个工具**。

## 核心方案

1. **检测是否为会话第一次发送消息**：读取会话消息总数即可判定——AI 无法主动发起消息，用户消息之前会话必为 0 条（无状态、跨进程准确；空会话查询返回空数组而非报错，已实测）
2. **非首次 → 直接退出**，不做任何事（后续消息全工具）
3. **首次 → 拦截工具描述**：把该消息的 agent 改写为 minimal，wire 层只发送 read+bash 两个工具 schema，模型只看到这 2 个工具（底层工具并未禁用；含 describe_image/html2read 等插件自定义工具在内全部拦截，实测首条消息工具面纯净为 bash+read）

**第一性原理**：模型思维只受输入内容影响——锚定的全部意义就是控制"首次请求输入中的工具 schema"。minimal agent 的 permission deny 效果即工具描述根本不进请求，与"拦截描述"等价。

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
- 影响来自"模型实际可调用的 schema surface"，不是看见一段工具名称文本——模型只关心输入内容，可见性决定思维。

## 文件

| 文件 | 安装位置 | 作用 |
|---|---|---|
| `agents/minimal.md` | `~/.config/opencode/agent/`（或 `agents/`） | minimal 锚定模式：permission 仅 read+bash（工具描述不进请求） |
| `plugins/anchored-standard.ts` | `~/.config/opencode/plugins/` | chat.message hook：首次消息改写为 minimal，非首次退出 |

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

无需任何操作：正常新建会话发消息即可——**每条会话的第一条消息自动锚定（2 工具）**，之后所有消息全工具。用户永远不需要切换模式；minimal 模式仅在首次消息内部使用。

## 配置（环境变量，可选）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `OPENCODE_ANCHOR_MODELS` | `deepseek-v4-pro,deepseek-v4-flash` | 生效的模型白名单，逗号分隔 |

## 验证

- 新会话首条消息：模型只能调用 read/bash（要求用 glob 会被告知"未提供 glob 工具"，改用 bash 完成）；
- 同会话第二条消息：glob/grep/edit 等全部可用。

## 风险与限制

- 报告为 Project2 单题 n=2 复现，**不保证跨任务普适提升**，请按需实测；
- opencode 的 system prompt 结构与 DSH minimal 的 exact RL prompt 不完全一致；本插件对齐的是已验证的主变量——首次请求工具 schema；
- DeepSeek 服务端路由行为未知，若服务端变化锚定效果可能变化；
- 插件在 chat.message 查询消息数失败时会跳过干预（宁可错过锚定，不破坏消息）。

## 参考

- [xiaobright/modeltest](https://github.com/xiaobright/modeltest)（研究报告：DEEPSEEK_V4_PRO_HARNESS_ANALYSIS_20260814 等）
- [xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)（DeepSeek Harness 原版 preset，本仓库为其 opencode 移植）
- [B站 BV15ZgN6NEDy](https://www.bilibili.com/video/BV15ZgN6NEDy)（up 主小明XBright）

## License

MIT
