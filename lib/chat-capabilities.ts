export const CHAT_PROTOCOLS = ["chat-completions", "responses"] as const
export type ChatProtocol = (typeof CHAT_PROTOCOLS)[number]

export const REASONING_EFFORTS = ["low", "medium", "high"] as const
export type ReasoningEffort = (typeof REASONING_EFFORTS)[number]

export type ChatModelCapabilities = {
  contextTokens: number | null
  outputReserveTokens: number
  reasoningEfforts: readonly ReasoningEffort[] | null
  source: "unknown"
}

export type ChatModelDescriptor = {
  id: string
  capabilities: ChatModelCapabilities
}

const UNKNOWN_CAPABILITIES: ChatModelCapabilities = {
  contextTokens: null,
  outputReserveTokens: 16_000,
  reasoningEfforts: null,
  source: "unknown",
}

/** User-defined models are treated conservatively because their limits are unknown. */
export function getChatModelCapabilities(model: string): ChatModelCapabilities {
  void model
  return UNKNOWN_CAPABILITIES
}

export function describeChatModel(id: string): ChatModelDescriptor {
  return { id, capabilities: getChatModelCapabilities(id) }
}

/** 已知模型严格校验；未知兼容模型允许透传用户显式选择的值。 */
export function normalizeReasoningEffort(
  model: string,
  effort: ReasoningEffort | undefined
): ReasoningEffort | undefined {
  if (!effort) return undefined
  const supported = getChatModelCapabilities(model).reasoningEfforts
  return !supported || supported.includes(effort) ? effort : undefined
}
