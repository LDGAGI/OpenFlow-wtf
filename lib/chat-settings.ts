"use client"

export type ChatProviderType = "openai-compatible"

export type ChatProvider = {
  id: ChatProviderType
  name: string
  baseUrl: string
  apiKey: string
  models: string[]
}

export type ChatSettings = {
  version: 1
  providers: ChatProvider[]
  activeProviderId: ChatProviderType
  activeModel: string
}

export const CHAT_PROVIDER_PRESETS = {
  "openai-compatible": { name: "自定义 API", baseUrl: "" },
} satisfies Record<ChatProviderType, { name: string; baseUrl: string }>

const STORAGE_KEY = "openflow.chat.providers.v1"

export function loadChatSettings(): ChatSettings | null {
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY)
    if (!raw) return null
    const parsed = JSON.parse(raw) as Record<string, unknown>
    const item = Array.isArray(parsed.providers) ? parsed.providers[0] as Record<string, unknown> | undefined : undefined
    if (!item || typeof item.baseUrl !== "string" || typeof item.apiKey !== "string" || !Array.isArray(item.models)) return null
    const models = item.models.filter((model): model is string => typeof model === "string" && Boolean(model.trim()))
    if (!item.baseUrl.trim() || !item.apiKey.trim() || !models.length) return null
    const provider: ChatProvider = { id: "openai-compatible", name: "自定义 API", baseUrl: item.baseUrl, apiKey: item.apiKey, models }
    const activeModel = typeof parsed.activeModel === "string" && models.includes(parsed.activeModel) ? parsed.activeModel : models[0]!
    return { version: 1, providers: [provider], activeProviderId: provider.id, activeModel }
  } catch {
    return null
  }
}

export function saveChatSettings(settings: ChatSettings) {
  window.localStorage.setItem(STORAGE_KEY, JSON.stringify(settings))
}

export function clearChatSettings() {
  window.localStorage.removeItem(STORAGE_KEY)
}

export function activeChatProvider(settings: ChatSettings) {
  return settings.providers[0]!
}
