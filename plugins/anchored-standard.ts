import type { Plugin } from "@opencode-ai/plugin"

/**
 * anchored-standard —— v5.4（2026-08-15）：精简模式为默认选项
 *
 * 本质：锚定 = 每个会话第一个模型请求的输入控制。精简是默认行为——
 * 任何会话（build/minimal/子代理）的第一个请求统一精简锚定，无需用户选择。
 * 恢复时间点统一为"第一个模型请求发起时"（system.transform 首次触发）。
 *
 * 机制（对齐 DeepSeek Harness 官方 minimal + anchored-standard 两阶段语义）：
 *   1. 会话首条消息（chat.message，count = 0）：记录恢复目标 + 改写 minimal
 *      （首轮窄工具面 read/bash/edit/write + webfetch）
 *   2. system 层（system.transform，每轮请求前必触发）：首次触发时
 *      ① system 替换为官方 persona 句 "You are a helpful software engineer assistant."
 *      ② 立即 switchAgent 回恢复目标 —— switchAgent 语义是
 *         "subsequent provider turns"，不影响当前请求，因此：
 *         第一个请求仍 minimal（窄工具面 + persona 生效），第二个请求起全工具
 *   3. 第二条消息兜底（chat.message，count > 0 且仍 minimal）：消息 agent 改回
 *      恢复目标（防 switchAgent 失败；消息级改写只对本回合生效）
 *   4. 恢复目标 = 会话自身 agent：build 会话 → build；子代理 general → general；
 *      用户手动选 minimal → restoreAgent（build）
 *
 * 第一性原理：模型思维只受输入内容影响——极简模式 = 控制"输入中的
 * system prompt + 工具 schema"；首轮窄面选轨迹，随后恢复完整能力。
 *
 * 配置（环境变量，可选）：
 *   OPENCODE_ANCHOR_RESTORE_AGENT —— 恢复目标（用户手动选 minimal 的会话），默认 build
 */

const MINIMAL_AGENT = "minimal"
const DEFAULT_RESTORE_AGENT = "build"
// 官方 minimal persona（minimal-preset.snapshot.ts 快照锁定原文，含句号）
const PERSONA = "You are a helpful software engineer assistant."

// 默认激活：精简是默认选项，任何会话（build/minimal/子代理）首条统一锚定
// 锚定会话（首条消息已极简锚定、system 被替换）
const anchored = new Set<string>()
// 恢复目标（主会话 minimal→build；子代理 general→general）
const restoreTarget = new Map<string, string>()
// 已完成 switchAgent 恢复（system.transform 每轮触发，避免重复）
const restored = new Set<string>()

export const AnchoredStandardPlugin: Plugin = async ({ client }) => {
  const restoreAgent = process.env.OPENCODE_ANCHOR_RESTORE_AGENT?.trim() || DEFAULT_RESTORE_AGENT

  return {
    "chat.message": async (input, output) => {
      const sessionID = input.sessionID

      // 判定是否首条消息（chat.message 在当前消息保存前触发，首次计数为 0）
      let count = 0
      try {
        const result = await client.session.messages({
          path: { id: sessionID },
          query: { limit: 10 },
        })
        count = result.data?.length ?? 0
      } catch {
        return // 查询失败 → 不干预（宁可错过锚定，不破坏消息）
      }

      if (count === 0) {
        // 首条消息：记录恢复目标 + 改写 minimal（首轮窄工具面 + persona）
        // 恢复目标 = 会话自身 agent（build→build，general→general）；
        // 用户手动选 minimal → restoreAgent（build）
        const target = input.agent === MINIMAL_AGENT ? restoreAgent : input.agent || restoreAgent
        restoreTarget.set(sessionID, target)
        restored.delete(sessionID)
        anchored.add(sessionID)
        if (input.agent !== MINIMAL_AGENT) {
          const msg = output?.message as { info?: { agent?: string }; agent?: string } | undefined
          if (msg?.info) msg.info.agent = MINIMAL_AGENT
          else if (msg?.agent) msg.agent = MINIMAL_AGENT
        }
        return
      }

      // 第二条消息兜底：若 switchAgent 尚未生效（仍是 minimal），改回恢复目标
      if (anchored.has(sessionID) && input.agent === MINIMAL_AGENT) {
        const target = restoreTarget.get(sessionID) || restoreAgent
        if (target !== MINIMAL_AGENT) {
          const msg = output?.message as { info?: { agent?: string }; agent?: string } | undefined
          if (msg?.info) msg.info.agent = target
          else if (msg?.agent) msg.agent = target
        }
      }
    },

    // system 层 + 统一恢复点：
    // 锚定会话首次请求时替换 system + 立即 switchAgent 回恢复目标。
    // switchAgent 只影响 subsequent provider turns，当前请求保持 minimal；
    // 第二个请求起全工具。之后 system 保持 persona（官方 anchored 全程 minimal system）。
    "experimental.chat.system.transform": async (input: any, output: any) => {
      const sessionID = input?.sessionID
      if (!sessionID || !anchored.has(sessionID)) return
      const system = output?.system
      if (Array.isArray(system)) {
        system.splice(0, system.length, PERSONA)
      }
      if (!restored.has(sessionID)) {
        const target = restoreTarget.get(sessionID)
        if (target && target !== MINIMAL_AGENT) {
          restored.add(sessionID)
          try {
            await client.session.switchAgent({ sessionID, agent: target })
          } catch {
            // 切回失败不阻断（主会话第二条消息兜底）
          }
        }
      }
    },
  }
}
