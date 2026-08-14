import type { Plugin } from "@opencode-ai/plugin"
import { createOpencodeClient } from "@opencode-ai/sdk/v2"

/**
 * anchored-standard —— 两阶段锚定插件（基于 modeltest 研究报告 2026-08-14）
 *
 * 机制：DeepSeek V4 Pro/Flash 对「首次请求的 wire 层工具 schema」高度敏感。
 * 研究报告（xiaobright/modeltest, DSH anchored-standard）实测：首轮只暴露
 * shell+read 两工具、首个工具调用后恢复完整工具目录，V4 Pro 在 Project2 上
 * 两跑 98/99（均值 98.5，worst 98），对比 standard 91 / PTC 92 / OpenCode 91-96。
 *
 * opencode 落地（无感模式，本机 1.18.18 实测成立）：
 *   1. 用户选择 minimal 模式（agent：permission 仅 read+bash）后永久待在其中；
 *      每条消息的首个回合因消息级 agent=minimal 只暴露 read/bash（wire 层 2 工具）；
 *   2. 本插件在任意工具调用完成后（tool.execute.after）检查会话级 agent：
 *      若为 minimal 且模型在白名单内 → switchAgent 切回 build；
 *   3. 续跑回合（工具结果）读取会话级 agent（llm.ts 实测确认）→ 恢复完整工具；
 *      若会话级 agent 已是 build（UI 未同步场景）→ 幂等 no-op，续跑回合同样全工具。
 *
 * 配置（环境变量，可选）：
 *   OPENCODE_ANCHOR_MODELS        —— 锚定生效的模型白名单，逗号分隔，默认 deepseek-v4-pro,deepseek-v4-flash
 *   OPENCODE_ANCHOR_TARGET_AGENT  —— 工具调用后恢复到的 agent，默认 build
 *
 * 认证：本地 opencode server 启用用户名/密码时（OPENCODE_SERVER_USERNAME /
 * OPENCODE_SERVER_PASSWORD），自动带 Basic Auth；未设置则直连。
 */

const DEFAULT_MODELS = ["deepseek-v4-pro", "deepseek-v4-flash"]
const ANCHOR_AGENT = "minimal"

function envList(name: string, fallback: string[]): string[] {
  const raw = process.env[name]
  if (!raw) return fallback
  return raw
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean)
}

function buildAuthHeaders(): Record<string, string> {
  const user = process.env.OPENCODE_SERVER_USERNAME
  const pass = process.env.OPENCODE_SERVER_PASSWORD
  if (!user || !pass) return {}
  const token = Buffer.from(`${user}:${pass}`, "utf8").toString("base64")
  return { Authorization: `Basic ${token}` }
}

export const AnchoredStandardPlugin: Plugin = async ({ client, serverUrl }) => {
  const modelWhitelist = envList("OPENCODE_ANCHOR_MODELS", DEFAULT_MODELS)
  const targetAgent = process.env.OPENCODE_ANCHOR_TARGET_AGENT || "build"

  const v2 = createOpencodeClient({
    baseUrl: serverUrl.toString(),
    headers: buildAuthHeaders(),
  })

  /** 已完成锚定切换的会话（首次 minimal 工具调用后标记；插件重启后重置，会重新锚定一次，无害） */
  const switched = new Set<string>()

  async function log(level: "info" | "warn", message: string, extra?: Record<string, unknown>) {
    try {
      await client.app.log({
        body: { service: "anchored-standard", level, message, extra },
      })
    } catch {
      /* 日志失败不阻断主流程 */
    }
  }

  async function maybeSwitch(sessionID: string): Promise<void> {
    try {
      const result = await v2.session.get({ sessionID }, { throwOnError: true })
      const session = result.data
      if (!session.agent || session.agent !== ANCHOR_AGENT) return
      const modelID = session.model?.id
      if (!modelID || !modelWhitelist.includes(modelID)) return
      await v2.v2.session.switchAgent({ sessionID, agent: targetAgent }, { throwOnError: true })
      switched.add(sessionID)
      await log("info", "anchored: switched to full tool agent", {
        sessionID,
        model: modelID,
        targetAgent,
      })
    } catch (err) {
      await log("warn", "anchored: check/switch failed", {
        sessionID,
        error: err instanceof Error ? err.message : String(err),
      })
    }
  }

  return {
    "chat.message": async (input, output) => {
      // 已锚定过的会话，后续 minimal 消息改写为 build：锚定只在会话首次请求
      // 发生一次（报告语义），后续消息恢复全工具。实测：turn 内工具面锁定
      // 消息级 agent，switchAgent 只改会话级标签、解除不了当前/后续消息的
      // 2 工具限制——若不改写，用户常驻 minimal 会被永久限制（BUG 修复
      // 2026-08-15）。
      if (input.agent !== ANCHOR_AGENT) return
      if (!switched.has(input.sessionID)) return
      const msg = output?.message as { info?: { agent?: string }; agent?: string } | undefined
      if (msg?.info) msg.info.agent = targetAgent
      else if (msg?.agent) msg.agent = targetAgent
      await maybeSwitch(input.sessionID)
    },
    "tool.execute.after": async (input) => {
      await maybeSwitch(input.sessionID)
    },
  }
}
