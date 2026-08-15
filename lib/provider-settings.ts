"use client"

import { createClientId } from "./client-id"
import type { ChatProtocol, ReasoningEffort } from "./chat-capabilities"
import {
  inferMediaBinding,
  isProviderModelListed,
  isMediaAdapterCompatible,
  MEDIA_ADAPTER_IDS,
  MODEL_PROFILE_IDS,
  mediaAdapterForProfile,
  modelProfileKind,
  type MediaAdapterId,
  type ModelProfileId,
  type ModelDiscoveryAuth,
  type ProviderPathOverrides,
} from "./provider-models"

export type { ReasoningEffort }

export type ProviderKind = "chat" | "image" | "video"

export type ProviderModelBinding = {
  id: string
  adapter: MediaAdapterId
  capabilityProfile: ModelProfileId
  label?: string
}

export type ProviderConnection = {
  version: 3
  id: string
  kind: "image" | "video"
  name: string
  baseUrl: string
  apiKey: string
  paths?: ProviderPathOverrides
  modelDiscoveryAuth?: ModelDiscoveryAuth
  models: ProviderModelBinding[]
  activeModelId: string
  /** 迁移配置必须经用户确认协议后才会变为 true。 */
  confirmed: boolean
}

export type ProviderSettings = {
  /** 仅 chat 使用 */
  protocol?: ChatProtocol
  baseUrl: string
  apiKey: string
  /** 已入库的模型列表（可多选） */
  models: string[]
  /** 当前使用的模型（必须是 models 之一） */
  activeModel: string
  /** 仅 chat 使用；undefined 表示不向供应商传该参数 */
  reasoningEffort?: ReasoningEffort
  /** 图片/视频 v3：保留扁平字段兼容现有消费者，连接列表是数据源。 */
  connections?: ProviderConnection[]
  activeConnectionId?: string
  paths?: ProviderPathOverrides
  needsConfirmation?: boolean
}

const SETTINGS_KEY_PREFIX = "openflow.provider.settings."
const LEGACY_CHAT_SETTINGS_KEY = "openflow.chat.settings"

function storageKey(kind: ProviderKind) {
  return SETTINGS_KEY_PREFIX + kind
}

// 兼容旧版单模型结构 { protocol, baseUrl, apiKey, model }
type LegacySettings = {
  protocol?: string
  baseUrl?: string
  apiKey?: string
  model?: string
  models?: string[]
  activeModel?: string
  reasoningEffort?: string
  connections?: unknown
  activeConnectionId?: unknown
}

function validProfile(kind: "image" | "video", value: unknown): value is ModelProfileId {
  return typeof value === "string" &&
    MODEL_PROFILE_IDS.includes(value as ModelProfileId) &&
    modelProfileKind(value as ModelProfileId) === kind
}

function validAdapter(kind: "image" | "video", value: unknown): value is MediaAdapterId {
  return typeof value === "string" &&
    MEDIA_ADAPTER_IDS.includes(value as MediaAdapterId) &&
    (kind === "image" ? value !== "async-video" : value === "async-video")
}

function parseConnection(kind: "image" | "video", value: unknown): ProviderConnection | null {
  if (!value || typeof value !== "object") return null
  const item = value as Record<string, unknown>
  if (
    typeof item.id !== "string" ||
    typeof item.name !== "string" ||
    typeof item.baseUrl !== "string" ||
    typeof item.apiKey !== "string" ||
    !Array.isArray(item.models)
  ) return null
  const models = item.models.flatMap((model) => {
    if (!model || typeof model !== "object") return []
    const binding = model as Record<string, unknown>
    if (typeof binding.id !== "string") return []
    const legacyProfile = validProfile(kind, binding.profile) ? binding.profile : null
    const capabilityProfile = validProfile(kind, binding.capabilityProfile)
      ? binding.capabilityProfile
      : legacyProfile
    if (!capabilityProfile) return []
    const adapter = validAdapter(kind, binding.adapter)
      ? binding.adapter
      : mediaAdapterForProfile(capabilityProfile)
    const resolvedAdapter = adapter
    if (!isMediaAdapterCompatible(kind, resolvedAdapter, capabilityProfile)) return []
    if (!isProviderModelListed(kind, binding.id, capabilityProfile)) return []
    return [{
      id: binding.id,
      adapter: resolvedAdapter,
      capabilityProfile,
      ...(typeof binding.label === "string" ? { label: binding.label } : {}),
    }]
  })
  if (!models.length) return null
  const activeModelId = typeof item.activeModelId === "string" && models.some((model) => model.id === item.activeModelId)
    ? item.activeModelId
    : models[0]!.id
  const paths = item.paths && typeof item.paths === "object"
    ? Object.fromEntries(Object.entries(item.paths as Record<string, unknown>).filter((entry): entry is [string, string] => typeof entry[1] === "string"))
    : undefined
  const modelDiscoveryAuth = item.modelDiscoveryAuth === "x-api-key" || item.modelDiscoveryAuth === "query" || item.modelDiscoveryAuth === "none"
    ? item.modelDiscoveryAuth
    : "bearer"
  return {
    version: 3,
    id: item.id,
    kind,
    name: item.name,
    baseUrl: item.baseUrl,
    apiKey: item.apiKey,
    ...(paths ? { paths } : {}),
    modelDiscoveryAuth,
    models,
    activeModelId,
    confirmed: item.confirmed === true,
  }
}

function flattenConnections(connections: ProviderConnection[], activeConnectionId?: string): ProviderSettings | null {
  const active = connections.find((item) => item.id === activeConnectionId) ?? connections[0]
  if (!active) return null
  return {
    baseUrl: active.baseUrl,
    apiKey: active.apiKey,
    models: active.models.map((model) => model.id),
    activeModel: active.activeModelId,
    connections,
    activeConnectionId: active.id,
    paths: active.paths,
    needsConfirmation: !active.confirmed,
  }
}

export function createProviderConnection(input: {
  kind: "image" | "video"
  name?: string
  baseUrl: string
  apiKey: string
  models: string[]
  confirmed?: boolean
  paths?: ProviderPathOverrides
}): ProviderConnection {
  const bindings = input.models.flatMap((id) => {
    const binding = inferMediaBinding(input.kind, id)
    return binding && isProviderModelListed(input.kind, id, binding.capabilityProfile)
      ? [{ id, ...binding }]
      : []
  })
  return {
    version: 3,
    id: createClientId(),
    kind: input.kind,
    name: input.name?.trim() || (input.kind === "image" ? "" : "自有视频 API"),
    baseUrl: input.baseUrl.trim(),
    apiKey: input.apiKey.trim(),
    ...(input.paths ? { paths: input.paths } : {}),
    models: bindings,
    activeModelId: bindings[0]?.id ?? "",
    confirmed: input.confirmed ?? true,
  }
}

export function parseProviderSettingsJson(kind: ProviderKind, raw: string): ProviderSettings | null {
  try {
    const parsed = JSON.parse(raw) as LegacySettings
    if (kind !== "chat" && Array.isArray(parsed.connections)) {
      const connections = parsed.connections.flatMap((value) => {
        const connection = parseConnection(kind, value)
        return connection ? [connection] : []
      })
      return flattenConnections(
        connections,
        typeof parsed.activeConnectionId === "string" ? parsed.activeConnectionId : undefined
      )
    }
    if (
      kind === "chat" &&
      parsed.protocol !== "chat-completions" &&
      parsed.protocol !== "responses"
    ) {
      return null
    }
    if (
      typeof parsed.baseUrl !== "string" ||
      !parsed.baseUrl ||
      typeof parsed.apiKey !== "string" ||
      !parsed.apiKey
    ) {
      return null
    }
    const models = Array.isArray(parsed.models)
      ? parsed.models.filter((item): item is string => typeof item === "string" && !!item)
      : typeof parsed.model === "string" && parsed.model
        ? [parsed.model]
        : []
    if (!models.length) return null
    const activeModel =
      typeof parsed.activeModel === "string" && models.includes(parsed.activeModel)
        ? parsed.activeModel
        : models[0]
    const reasoningEffort: ReasoningEffort | undefined =
      parsed.reasoningEffort === "low" ||
      parsed.reasoningEffort === "medium" ||
      parsed.reasoningEffort === "high"
        ? parsed.reasoningEffort
        : undefined
    const legacy = {
      protocol: kind === "chat" ? (parsed.protocol as ProviderSettings["protocol"]) : undefined,
      baseUrl: parsed.baseUrl,
      apiKey: parsed.apiKey,
      models,
      activeModel,
      reasoningEffort: kind === "chat" ? reasoningEffort : undefined,
    }
    if (kind === "chat") return legacy
    const connection = createProviderConnection({
      kind,
      baseUrl: parsed.baseUrl,
      apiKey: parsed.apiKey,
      models,
      confirmed: false,
    })
    return flattenConnections([connection], connection.id)
  } catch {
    return null
  }
}

export function loadProviderSettings(kind: ProviderKind): ProviderSettings | null {
  try {
    const raw = window.localStorage.getItem(storageKey(kind))
    if (raw) {
      const parsed = parseProviderSettingsJson(kind, raw)
      if (kind !== "chat" && parsed?.connections && !raw.includes('"version":3')) {
        saveProviderSettings(kind, parsed)
      }
      return parsed
    }
    // 旧版对话配置迁移到新 key
    if (kind === "chat") {
      const legacy = window.localStorage.getItem(LEGACY_CHAT_SETTINGS_KEY)
      if (!legacy) return null
      const parsed = parseProviderSettingsJson(kind, legacy)
      if (parsed) {
        saveProviderSettings(kind, parsed)
        window.localStorage.removeItem(LEGACY_CHAT_SETTINGS_KEY)
      }
      return parsed
    }
    return null
  } catch {
    return null
  }
}

export function saveProviderSettings(kind: ProviderKind, settings: ProviderSettings) {
  if (kind !== "chat" && settings.connections?.length) {
    window.localStorage.setItem(storageKey(kind), JSON.stringify({
      version: 3,
      connections: settings.connections,
      activeConnectionId: settings.activeConnectionId,
    }))
    return
  }
  window.localStorage.setItem(storageKey(kind), JSON.stringify(settings))
}

export function settingsFromConnections(connections: ProviderConnection[], activeConnectionId?: string) {
  return flattenConnections(connections, activeConnectionId)
}

export function activateProviderModel(
  settings: ProviderSettings,
  connectionId: string,
  modelId: string
) {
  if (!settings.connections) return settings
  const connections = settings.connections.map((connection) =>
    connection.id === connectionId && connection.models.some((model) => model.id === modelId)
      ? { ...connection, activeModelId: modelId }
      : connection
  )
  return flattenConnections(connections, connectionId) ?? settings
}

export function clearProviderSettings(kind: ProviderKind) {
  window.localStorage.removeItem(storageKey(kind))
}

/** 开源版仅支持用户自有 API。 */
export type ModelChannel = "byok"

/** 模型选择器里的一个选项：同一模型名可能同时存在于两个来源，需要 source 区分 */
export type ModelOption = {
  source: ModelChannel
  model: string
  connectionId?: string
  adapter?: MediaAdapterId
  capabilityProfile?: ModelProfileId
  label?: string
  providerLabel?: string
}

const CHANNEL_KEY_PREFIX = "openflow.provider.channel."

/** 读取用户上次选择的模型来源；null 表示未选择过 */
export function loadModelChannel(kind: ProviderKind): ModelChannel | null {
  try {
    const value = window.localStorage.getItem(CHANNEL_KEY_PREFIX + kind)
    return value === "byok" ? value : null
  } catch {
    return null
  }
}

export function saveModelChannel(kind: ProviderKind, channel: ModelChannel) {
  window.localStorage.setItem(CHANNEL_KEY_PREFIX + kind, channel)
}
