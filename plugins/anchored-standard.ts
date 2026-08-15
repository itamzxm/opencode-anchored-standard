import type { Plugin } from "@opencode-ai/plugin"

/**
 * anchored-standard —— A 方案（v5，2026-08-15）：手动极简模式
 *
 * 触发：用户手动选择 minimal（极简）agent 后，插件才生效；不选择则完全不干预。
 *
 * 机制（对齐 DeepSeek Harness 官方 minimal + anchored-standard 两阶段语义）：
 *   1. 首条消息（消息数 = 0）：保持 minimal —— 首轮窄工具面
 *      （read/bash/edit/write，官方 bash+str_replace_editor 功能等价）+ system 替换为
 *      官方 persona 句 "You are a helpful software engineer assistant."
 *   2. 第二条消息起：把消息 agent 改写为恢复目标（默认 build）—— 本回合起全工具
 *      （官方 anchored-standard：首个工具调用后恢复完整 Standard 目录）
 *   3. system 全程保持官方 persona（官方 anchored-standard "Keep the Minimal complete
 *      system prompt"，与工具目录两阶段一致）
 *   4. 子代理：继承 minimal 时直接改回恢复目标（v2 实证：子代理全程窄工具会受限
 *      无法读外部目录）；子代理不进锚定 Set，system 不被替换
 *   5. 用户切换回非 minimal agent → 停止干预
 *
 * 第一性原理：模型思维只受输入内容影响——极简模式 = 控制"输入中的
 * system prompt + 工具 schema"；首轮窄面选轨迹，随后恢复完整能力。
 *
 * 配置（环境变量，可选）：
 *   OPENCODE_ANCHOR_RESTORE_AGENT —— 首轮后恢复的 agent，默认 build
 */

const MINIMAL_AGENT = "minimal"
const DEFAULT_RESTORE_AGENT = "build"
// 官方 minimal persona（minimal-preset.snapshot.ts 快照锁定原文，含句号）
const PERSONA = "You are a helpful software engineer assistant."

// 锚定会话（用户手动选择极简模式且未切走）
const anchored = new Set<string>()

export const AnchoredStandardPlugin: Plugin = async ({ client }) => {
  const restoreAgent = process.env.OPENCODE_ANCHOR_RESTORE_AGENT?.trim() || DEFAULT_RESTORE_AGENT

  return {
    "chat.message": async (input, output) => {
      const sessionID = input.sessionID

      // 用户不在极简模式 → 停止干预（切走即退出）
      if (input.agent !== MINIMAL_AGENT) {
        anchored.delete(sessionID)
        return
      }

      // 子代理（有 parentID）：不继承极简限制——本回合直接恢复目标 agent，
      // 不进锚定 Set、system 不被替换（v2 实证：子代理窄工具会权限受限）
      try {
        const sess = await client.session.get({ path: { id: sessionID } })
        if (sess?.data?.parentID) {
          const msg = output?.message as { info?: { agent?: string }; agent?: string } | undefined
          if (msg?.info) msg.info.agent = restoreAgent
          else if (msg?.agent) msg.agent = restoreAgent
          return
        }
      } catch {
        // 查询失败不阻断（继续走极简判定）
      }

      // 主会话：判定是否首条消息（chat.message 在当前消息保存前触发，首次计数为 0）
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

      anchored.add(sessionID)

      // 首条消息（count = 0）：保持 minimal（首轮窄工具面），不改写
      if (count === 0) return

      // 第二条消息起：本回合起恢复全工具（消息级 agent 改写只对本回合生效，
      // 实证 2026-08-15；官方 anchored-standard 首个工具调用后恢复完整目录）
      const msg = output?.message as { info?: { agent?: string }; agent?: string } | undefined
      if (msg?.info) msg.info.agent = restoreAgent
      else if (msg?.agent) msg.agent = restoreAgent
    },

    // system 层：锚定会话全程替换为官方 persona（官方 anchored-standard 保留
    // minimal 完整 system prompt；切走后 Set 移除，恢复原 system）
    "experimental.chat.system.transform": async (input: any, output: any) => {
      const sessionID = input?.sessionID
      if (!sessionID || !anchored.has(sessionID)) return
      const system = output?.system
      if (Array.isArray(system)) {
        system.splice(0, system.length, PERSONA)
      }
    },
  }
}
