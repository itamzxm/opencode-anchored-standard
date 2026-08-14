import type { Plugin } from "@opencode-ai/plugin"

/**
 * anchored-standard —— 首轮锚定插件（基于 modeltest 研究报告 2026-08-14）
 *
 * 核心方案（2026-08-15 用户定义）：
 *   1. 检测是否为会话第一次发送消息：AI 无法主动发起消息，用户消息之前
 *      会话必为 0 条 → 读取会话消息总数即可判定（无状态、跨进程准确）；
 *   2. 非首次（消息数 > 0）→ 直接退出；
 *      首次（消息数 = 0）→ 拦截工具描述：把该消息的 agent 改写为 minimal，
 *              wire 层只发送 read+bash 两个工具 schema，模型只看到这 2 个工具；
 *   3. 不需要其他功能（不切换 agent、不恢复工具、不改写后续消息）。
 *
 * 第一性原理：模型思维只受输入内容影响——锚定的全部意义就是控制
 * "首次请求输入中的工具 schema"。minimal agent 的 permission deny 效果
 * 即工具描述根本不进请求（底层工具未被禁用），与"拦截描述"等价。
 *
 * 配置（环境变量，可选）：
 *   OPENCODE_ANCHOR_MODELS —— 生效的模型白名单，逗号分隔，默认 deepseek-v4-pro,deepseek-v4-flash
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

export const AnchoredStandardPlugin: Plugin = async ({ client }) => {
  const modelWhitelist = envList("OPENCODE_ANCHOR_MODELS", DEFAULT_MODELS)

  return {
    "chat.message": async (input, output) => {
      // 功能 1：读取会话消息总数判定是否首次（chat.message 在当前消息保存前
      // 触发，首次时计数为 0；AI 无法主动发起消息，无需其他状态）
      let count = 0
      try {
        const result = await client.session.messages({
          path: { id: input.sessionID },
          query: { limit: 10 },
        })
        count = result.data?.length ?? 0
      } catch {
        return // 查询失败 → 不干预（宁可错过锚定，不破坏消息）
      }
      if (count > 0) return // 非首次 → 退出

      // 用户手动选择了 minimal 模式 → 不干预（用户明确意图）
      if (input.agent === ANCHOR_AGENT) return

      // 模型白名单之外 → 退出
      const modelID = input.model?.modelID
      if (!modelID || !modelWhitelist.includes(modelID)) return

      // 功能 2：首次消息 → 拦截工具描述，只保留 2 个工具（改写消息 agent=minimal，
      // 其 permission deny 使 read+bash 之外的工具描述不进入请求）
      const msg = output?.message as { info?: { agent?: string }; agent?: string } | undefined
      if (msg?.info) msg.info.agent = ANCHOR_AGENT
      else if (msg?.agent) msg.agent = ANCHOR_AGENT
    },
  }
}
