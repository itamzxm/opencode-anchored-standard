# opencode-anchored-standard

DeepSeek V4 Pro / Flash 两阶段锚定插件（anchored-standard）的 **opencode 移植版**，全自动无感使用。

把 [xiaobright/modeltest](https://github.com/xiaobright/modeltest) 研究报告（2026-08-14）验证有效的机制移植到 [opencode](https://opencode.ai)：**首轮只暴露 read+bash 两个工具，第一个工具调用后自动恢复完整工具目录**。

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
- **不必牺牲完整工具能力**：首个工具调用后恢复完整目录，轨迹保持（355 个 reasoning 块仅 1 次 `let me`，两跑 98/99）。

本仓库的 opencode 实现已在 opencode 1.18.18 真实 server 上验证机制成立：

1. 桌面端每条消息携带当前 UI 选择的 agent，**消息级 agent 决定该消息的首个回合**；
2. **工具调用后的续跑回合读取会话级 agent**（`session.agent`）——实测：消息带 minimal → 首回合 agent=minimal → `switchAgent(build)` → 续跑回合 agent=build，工具恢复完整；
3. `switchAgent`（`POST /api/session/{id}/agent`）持久生效，产生 agent-switched 记录。

## 文件

| 文件 | 安装位置 | 作用 |
|---|---|---|
| `agents/minimal.md` | `~/.config/opencode/agent/`（或 `agents/`） | minimal 锚定模式：permission 仅 read+bash |
| `plugins/anchored-standard.ts` | `~/.config/opencode/plugins/` | 工具调用后自动切回完整工具 agent |

## 安装

```bash
# Linux/macOS
cp agents/minimal.md            ~/.config/opencode/agent/minimal.md
cp plugins/anchored-standard.ts ~/.config/opencode/plugins/anchored-standard.ts

# Windows PowerShell
Copy-Item agents\minimal.md            "$env:USERPROFILE\.config\opencode\agent\minimal.md"
Copy-Item plugins\anchored-standard.ts "$env:USERPROFILE\.config\opencode\plugins\anchored-standard.ts"
```

1. 确认配置目录 `package.json` 含依赖 `@opencode-ai/sdk`（插件 import 其 v2 客户端）；缺则执行 `npm install @opencode-ai/sdk`
2. 完全重启 opencode（TUI 或桌面端）
3. 卸载：删除上述两个文件并重启

## 使用（无感）

1. 在会话中选择 `minimal` 模式（新建会话时选择，或已有会话切换一次）——**此后永久待在其中，无需再操作**
2. 正常发消息；**每条消息后模型首个回合只有 read/bash（锚定）**，这是预期行为
3. 第一个工具调用后，插件自动把会话切回完整工具 agent（默认 `build`），**该会话后续所有消息自动改写为 build**——锚定只发生一次（会话首次请求），后续消息全程全工具，不会持续受限
4. 全程无手动操作；会话界面可见 `agent-switched` 记录

> 机制说明（2026-08-15 实测修正）：opencode 的 turn 内工具面锁定**消息级 agent**（`switchAgent` 只改会话级标签，无法解除当前/后续消息的 2 工具限制）。因此插件在 chat.message 时改写已锚定会话的后续消息 agent 为 build——首条消息锚定，之后全部恢复，符合研究报告"首次请求锚定、之后恢复"的语义。若不改写，用户常驻 minimal 会被永久限制在 2 工具。

功能不损失：锚定回合受限的只是"可见工具"，bash 可完成读取与执行；首个工具调用后立即恢复全部工具（edit/grep/glob/task 等）。

## 手机版（opencode run 链路）适配

手机遥控端（如 CloudCLI 类项目）通过 `opencode run` 独立子进程发消息（每次消息一个进程，消息级 agent 决定该次 run 全程回合）。实测结论：

- **插件在 `opencode run` 场景会加载，但 `switchAgent` 无法连接 run 的进程内 server**（`anchored: check/switch failed ... Unable to connect`），因此插件无法在 run 链路内恢复全工具；
- 正确适配：**新建会话的首条消息加 `--agent minimal` 锚定，延续会话不加参数（默认 agent 全工具）**。即"每个会话第一条消息 2 工具锚定，之后全工具"，与报告机制同构；
- 实测：`--agent minimal` 时模型调用 glob 被拒（`Model tried to call unavailable tool 'glob'. Available tools: bash, read, ...`），改用 bash 完成任务；延续会话（无 `--agent`）glob 正常可用。

```js
// 适配示例（服务端 spawn 参数拼接处）
if (!providerSessionId && permissionMode !== 'plan') {
  args.push('--agent', 'minimal'); // 仅新建会话首条消息锚定
}
```

## 配置（环境变量，可选）

| 变量 | 默认值 | 说明 |
|---|---|---|
| `OPENCODE_ANCHOR_MODELS` | `deepseek-v4-pro,deepseek-v4-flash` | 锚定生效的模型白名单，逗号分隔 |
| `OPENCODE_ANCHOR_TARGET_AGENT` | `build` | 工具调用后恢复到的 agent |

认证：本地 opencode server 启用用户名/密码时（`OPENCODE_SERVER_USERNAME` / `OPENCODE_SERVER_PASSWORD`），插件自动带 Basic Auth；未设置则直连。

## 验证（安装重启后）

- 重启后 `minimal` 模式可选；
- 选择 minimal 发一个简单任务：模型首个回合只调用 read/bash（不出现 glob/grep/edit），随后出现 agent-switched 记录，后续回合可正常调用全工具；
- 轨迹指纹（报告判别标准）：reasoning 中 `let me` 趋近 0、`we` 高频、过程性可见回复很少。

## 风险与限制

- 报告为 Project2 单题 n=2 复现，**不保证跨任务普适提升**，请按需实测；
- opencode 的 system prompt 结构与 DSH minimal 的 exact RL prompt 不完全一致；本插件对齐的是已验证的主变量——首次请求工具 schema；
- DeepSeek 服务端路由行为未知，若服务端变化锚定效果可能变化；
- `switchAgent` 为 SDK v2 接口，opencode 升级后需复查兼容性。

## 参考

- [xiaobright/modeltest](https://github.com/xiaobright/modeltest)（研究报告：DEEPSEEK_V4_PRO_HARNESS_ANALYSIS_20260814 等）
- [xiaobright/dsh-anchored-standard](https://github.com/xiaobright/dsh-anchored-standard)（DeepSeek Harness 原版 preset，本仓库为其 opencode 移植）
- [B站 BV15ZgN6NEDy](https://www.bilibili.com/video/BV15ZgN6NEDy)（up 主小明XBright）

## License

MIT
