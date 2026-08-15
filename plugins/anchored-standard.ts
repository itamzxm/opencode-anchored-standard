import type { Plugin } from "@opencode-ai/plugin"

/**
 * anchored-standard —— 官方对齐版（v4，2026-08-15）
 *
 * 对齐目标：DeepSeek Harness 官方 minimal preset（apps/cli/config/agent-presets/minimal/agent.cordis.yml）
 * 的 wire 层效果，两阶段 anchored：
 *
 * 首轮（会话第一个模型请求）：
 *   1. system 层：system prompt 替换为官方 minimal 唯一 persona 句
 *      "You are a helpful software engineer assistant."（官方 snapshot 锁定原文，
 *      等价官方 complete: true 屏蔽全部其他 system 段）
 *   2. 工具面：chat.message 把首条消息 agent 改写为 minimal（permission 仅
 *      read/bash/edit/write，功能等价官方 bash + str_replace_editor；
 *      报告微探针实测该组合保持 minimal 轨迹，glob 破坏）
 *   3. 子代理会话同样获得 persona system（不改写 agent，工具面不受限）
 *
 * 首轮之后：不再干预，system 与工具面恢复完整。
 *
 * 第一性原理：模型思维只受输入内容影响——锚定 = 控制"首次请求输入中的
 * system prompt + 工具 schema"。
 *
 * 配置（环境变量，可选）：
 *   OPENCODE_ANCHOR_MODELS —— 生效的模型白名单，逗号分隔，默认 deepseek-v4-pro,deepseek-v4-flash
 */

const DEFAULT_MODELS = ["deepseek-v4-pro", "deepseek-v4-flash"]
const ANCHOR_AGENT = "minimal"
// 官方 minimal persona（minimal-preset.snapshot.ts 快照锁定原文，含句号）
const PERSONA = "You are a helpful software engineer assistant."

// 已锚定会话：首轮 system 替换只做一次（本进程内）。重启后旧会话消息数 > 1
// 不满足判定，不会误锚定；工具回合时 count=2 且已在集合中，直接跳过。
const anchored = new Set<string>()

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
      // 排除子代理会话：task 工具派发的子代理是新会话，首条消息会被误判为
      // 用户首次消息而改写为 minimal，导致子代理全程 2 工具、权限受限
      // （实证：2026-08-15 子代理状态栏显示 Minimal、无法读外部目录）。
      // 子代理会话均有 parentID（v1 Session.parentID），存在即跳过。
      try {
        const sess = await client.session.get({ path: { id: input.sessionID } })
        if (sess?.data?.parentID) return
      } catch {
        // 查询失败不阻断（继续走首次判定）
      }

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

      // 功能 2：首次消息 → 拦截工具描述，只保留 minimal 工具集（改写消息
      // agent=minimal，其 permission 使其余工具描述不进入请求）
      const msg = output?.message as { info?: { agent?: string }; agent?: string } | undefined
      if (msg?.info) msg.info.agent = ANCHOR_AGENT
      else if (msg?.agent) msg.agent = ANCHOR_AGENT
    },

    // 功能 3：首轮 system 对齐（wire 层，官方 minimal persona）
    // 判定：陌生会话 + 消息数 == 1（首个模型请求时刻，用户消息已保存、assistant
    // 尚未创建）→ 替换 system 并记录；工具回合/后续轮次/旧会话均不干预。
    "experimental.chat.system.transform": async (input: any, output: any) => {
      const sessionID = input?.sessionID
      if (!sessionID || anchored.has(sessionID)) return

      let count = 0
      try {
        const result = await client.session.messages({
          path: { id: sessionID },
          query: { limit: 10 },
        })
        count = result.data?.length ?? 0
      } catch {
        return // 查询失败 → 不干预
      }
      if (count !== 1) return

      anchored.add(sessionID)
      const system = output?.system
      if (Array.isArray(system)) {
        system.splice(0, system.length, PERSONA)
      }
    },
  }
}
