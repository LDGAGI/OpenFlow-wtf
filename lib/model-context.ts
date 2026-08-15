import { getChatModelCapabilities } from "./chat-capabilities"

/** 查询模型的总上下文 tokens；无内置数据时返回 null */
export function getModelContextTokens(model: string): number | null {
  return getChatModelCapabilities(model).contextTokens
}

/** 对中日韩字符和其它文本分别做保守估算，并预留消息结构开销。 */
export function estimateTokens(text: string): number {
  const cjk = text.match(/[\p{Script=Han}\p{Script=Hiragana}\p{Script=Katakana}\p{Script=Hangul}]/gu)?.length ?? 0
  const other = Array.from(text).length - cjk
  return Math.ceil(cjk * 1.25 + other / 3) + 4
}

/** 图片实际消耗取决于模型和尺寸；未知 detail 下按张做保守预留。 */
const IMAGE_TOKENS = 8_192
/** 无内置上下文数据的模型退回的保守条数上限（没有预算可依时的兜底） */
const FALLBACK_MAX_MESSAGES = 20

/**
 * 在上下文预算内挑选历史消息：从最新往旧装，装满预算为止——上下文预算才是上限，
 * 不设条数硬上限。模型无内置上下文数据时退回固定条数的保守行为。
 * 历史图片和当前图片都会随请求发送并计入预算。
 */
export function fitHistoryToBudget<T extends { content: string; images?: readonly unknown[] }>(input: {
  messages: T[]
  model?: string
  currentMessage: string
  currentImages?: number
}): T[] {
  const capabilities = input.model ? getChatModelCapabilities(input.model) : null
  const contextTokens = capabilities?.contextTokens ?? null
  if (!contextTokens) return input.messages.slice(-FALLBACK_MAX_MESSAGES)
  const outputReserveTokens = capabilities?.outputReserveTokens ?? 16_000
  let remaining =
    contextTokens -
    outputReserveTokens -
    estimateTokens(input.currentMessage) -
    (input.currentImages ?? 0) * IMAGE_TOKENS
  const picked: T[] = []
  for (let i = input.messages.length - 1; i >= 0 && remaining > 0; i--) {
    const message = input.messages[i]
    const cost = estimateTokens(message.content) + (message.images?.length ?? 0) * IMAGE_TOKENS
    if (cost > remaining) break
    picked.unshift(message)
    remaining -= cost
  }
  return picked
}
