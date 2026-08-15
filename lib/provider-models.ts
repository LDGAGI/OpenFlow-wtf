export const MODEL_PROFILE_IDS = [
  "gpt-image-2",
  "nano-banana-2",
  "nano-banana-pro",
  "seedance-2.0",
  "seedance-2.0-fast",
  "minimax-h3",
  "sd-2.5",
] as const
export type ModelProfileId = (typeof MODEL_PROFILE_IDS)[number]

export const MEDIA_ADAPTER_IDS = [
  "openai-image",
  "async-image",
  "async-video",
] as const
export type MediaAdapterId = (typeof MEDIA_ADAPTER_IDS)[number]

const UNLISTED_MODEL_PROFILES = new Set<ModelProfileId>(["sd-2.5"])

/** 控制模型是否出现在平台列表、BYOK 拉取结果和已保存的前端配置中。 */
export function isModelProfileListed(profile: ModelProfileId | null | undefined) {
  return Boolean(profile && !UNLISTED_MODEL_PROFILES.has(profile))
}

export function isProviderModelListed(
  kind: "image" | "video",
  model: string,
  profile?: ModelProfileId | null
) {
  const resolvedProfile = profile ?? inferModelProfile(kind, model)
  return resolvedProfile !== "sd-2.5"
}

export type ProviderPathOverrides = {
  models?: string
  imageGenerate?: string
  imageGenerateStatus?: string
  imageEdit?: string
  imageEditStatus?: string
  imageContent?: string
  videoCreate?: string
  videoStatus?: string
  videoContent?: string
}

export type ModelDiscoveryAuth = "bearer" | "x-api-key" | "query" | "none"

export type ImageModelCapabilities = {
  kind: "image"
  aspectRatios: readonly string[]
  resolutions: readonly string[]
  qualities: readonly ("low" | "medium" | "high")[]
  backgrounds: readonly ("auto" | "opaque" | "transparent")[]
  outputFormats: readonly ("png" | "jpeg" | "webp")[]
  supportsReferenceImages: boolean
  maxReferenceImages: number
  maxReferenceImageBytes: number
  maxOutputs: 1
  dispatchMode: "sync" | "async"
  pollIntervalMs?: number
  maxPollAttempts?: number
  supportsCustomDimensions: boolean
  supportsModeration: boolean
}

export type VideoModelCapabilities = {
  kind: "video"
  durations: readonly number[]
  aspectRatios: readonly string[]
  resolutions: readonly string[]
  fixedResolution?: string
  supportsAudio: boolean
  supportsSeed: boolean
  supportsNegativePrompt: boolean
  supportsFirstLastFrame: boolean
  supportsReferenceImages: boolean
  supportsReferenceVideos: boolean
  supportsReferenceAudios: boolean
  maxReferenceImages: number
  maxReferenceVideos: number
  maxReferenceAudios: number
  referenceVideoDuration?: { min: number; max: number; total?: number }
  referenceAudioMaxDuration?: number
  referenceVideoDimensions?: { min: number; max: number }
}
export type VideoModelCapabilitiesV2 = VideoModelCapabilities

export type ModelCapabilities = ImageModelCapabilities | VideoModelCapabilitiesV2

export type SupportedProviderKind = "chat" | "image" | "video"

export type DiscoveredProviderModel = {
  id: string
  kind: SupportedProviderKind
  profile?: ModelProfileId
}

const IMAGE_RATIOS = ["16:9", "9:16", "1:1", "4:3", "3:4"] as const
const NANO_BANANA_2_RATIOS = ["1:1", "4:3", "3:4", "16:9", "9:16", "1:8", "1:4", "4:1", "8:1"] as const
const NANO_BANANA_PRO_RATIOS = ["1:1", "5:4", "9:16", "21:9", "16:9", "3:2", "4:3", "4:5", "3:4", "2:3"] as const
const VIDEO_RATIOS = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"] as const
const SEEDANCE_DURATIONS = Array.from({ length: 12 }, (_, index) => index + 4)
const MINIMAX_DURATIONS = Array.from({ length: 11 }, (_, index) => index + 5)
const SD_25_DURATIONS = Array.from({ length: 27 }, (_, index) => index + 4)

export const MODEL_CAPABILITIES: Record<ModelProfileId, ModelCapabilities> = {
  "gpt-image-2": {
    kind: "image",
    aspectRatios: IMAGE_RATIOS,
    resolutions: [],
    qualities: ["low", "medium", "high"],
    backgrounds: ["auto", "opaque", "transparent"],
    outputFormats: ["png", "jpeg", "webp"],
    supportsReferenceImages: true,
    maxReferenceImages: 16,
    maxReferenceImageBytes: 10 * 1024 * 1024,
    maxOutputs: 1,
    dispatchMode: "sync",
    supportsCustomDimensions: true,
    supportsModeration: true,
  },
  "nano-banana-2": {
    kind: "image",
    aspectRatios: NANO_BANANA_2_RATIOS,
    resolutions: ["1K", "2K", "4K"],
    qualities: [],
    backgrounds: [],
    outputFormats: ["png"],
    supportsReferenceImages: true,
    maxReferenceImages: 9,
    maxReferenceImageBytes: 10 * 1024 * 1024,
    maxOutputs: 1,
    dispatchMode: "async",
    pollIntervalMs: 5000,
    maxPollAttempts: 72,
    supportsCustomDimensions: false,
    supportsModeration: false,
  },
  "nano-banana-pro": {
    kind: "image",
    aspectRatios: NANO_BANANA_PRO_RATIOS,
    resolutions: ["1K", "2K", "4K"],
    qualities: [],
    backgrounds: [],
    outputFormats: ["png"],
    supportsReferenceImages: true,
    maxReferenceImages: 9,
    maxReferenceImageBytes: 10 * 1024 * 1024,
    maxOutputs: 1,
    dispatchMode: "async",
    pollIntervalMs: 5000,
    maxPollAttempts: 72,
    supportsCustomDimensions: false,
    supportsModeration: false,
  },
  "seedance-2.0": {
    kind: "video",
    durations: SEEDANCE_DURATIONS,
    aspectRatios: VIDEO_RATIOS,
    resolutions: ["480p", "720p"],
    supportsAudio: true,
    supportsSeed: false,
    supportsNegativePrompt: false,
    supportsFirstLastFrame: true,
    supportsReferenceImages: true,
    supportsReferenceVideos: true,
    supportsReferenceAudios: true,
    maxReferenceImages: 4,
    maxReferenceVideos: 3,
    maxReferenceAudios: 1,
    referenceVideoDuration: { min: 4, max: 10, total: 15 },
    referenceAudioMaxDuration: 15,
    referenceVideoDimensions: { min: 720, max: 2160 },
  },
  "seedance-2.0-fast": {
    kind: "video",
    durations: SEEDANCE_DURATIONS,
    aspectRatios: VIDEO_RATIOS,
    resolutions: ["480p", "720p"],
    supportsAudio: true,
    supportsSeed: false,
    supportsNegativePrompt: false,
    supportsFirstLastFrame: true,
    supportsReferenceImages: true,
    supportsReferenceVideos: true,
    supportsReferenceAudios: true,
    maxReferenceImages: 4,
    maxReferenceVideos: 3,
    maxReferenceAudios: 1,
    referenceVideoDuration: { min: 4, max: 10, total: 15 },
    referenceAudioMaxDuration: 15,
    referenceVideoDimensions: { min: 720, max: 2160 },
  },
  "minimax-h3": {
    kind: "video",
    durations: MINIMAX_DURATIONS,
    aspectRatios: VIDEO_RATIOS,
    resolutions: ["2K"],
    fixedResolution: "2K",
    supportsAudio: true,
    supportsSeed: true,
    supportsNegativePrompt: true,
    supportsFirstLastFrame: true,
    supportsReferenceImages: true,
    supportsReferenceVideos: false,
    supportsReferenceAudios: true,
    maxReferenceImages: 5,
    maxReferenceVideos: 0,
    maxReferenceAudios: 3,
  },
  "sd-2.5": {
    kind: "video",
    durations: SD_25_DURATIONS,
    aspectRatios: ["21:9", "16:9", "9:16", "1:1", "4:3", "3:4"],
    resolutions: ["720p"],
    fixedResolution: "720p",
    supportsAudio: true,
    supportsSeed: false,
    supportsNegativePrompt: false,
    supportsFirstLastFrame: false,
    supportsReferenceImages: true,
    supportsReferenceVideos: true,
    supportsReferenceAudios: true,
    maxReferenceImages: 5,
    maxReferenceVideos: 3,
    maxReferenceAudios: 3,
  },
}

const seedanceCapabilities = MODEL_CAPABILITIES["seedance-2.0"] as VideoModelCapabilities

export type ModelCapabilitySelection = {
  kind: "image" | "video"
  source: "byok"
  model: string
  capabilityProfile?: ModelProfileId | null
}

/** 所有 UI、API 校验和供应商适配器统一从这里解析最终能力。 */
export function resolveModelCapabilities(selection: ModelCapabilitySelection): ModelCapabilities | null {
  const profile = selection.capabilityProfile ?? inferModelProfile(selection.kind, selection.model)
  return modelCapabilities(profile)
}

export function resolveVideoModelCapabilities(selection: Omit<ModelCapabilitySelection, "kind">): VideoModelCapabilities {
  const capabilities = resolveModelCapabilities({ ...selection, kind: "video" })
  return capabilities?.kind === "video" ? capabilities : seedanceCapabilities
}

export function modelProfileKind(profile: ModelProfileId): "image" | "video" {
  return MODEL_CAPABILITIES[profile].kind
}

export function mediaAdapterKind(adapter: MediaAdapterId): "image" | "video" {
  return adapter === "async-video" ? "video" : "image"
}

export function mediaAdapterForProfile(profile: ModelProfileId): MediaAdapterId {
  if (profile === "gpt-image-2") return "openai-image"
  if (MODEL_CAPABILITIES[profile].kind === "image") return "async-image"
  return "async-video"
}

export function compatibleModelProfiles(kind: "image" | "video", adapter?: MediaAdapterId | null) {
  return MODEL_PROFILE_IDS.filter((profile) => {
    if (!isModelProfileListed(profile)) return false
    if (modelProfileKind(profile) !== kind) return false
    return !adapter || mediaAdapterForProfile(profile) === adapter
  })
}

export function isMediaAdapterCompatible(
  kind: "image" | "video",
  adapter: MediaAdapterId,
  capabilityProfile: ModelProfileId
) {
  return mediaAdapterKind(adapter) === kind &&
    modelProfileKind(capabilityProfile) === kind &&
    mediaAdapterForProfile(capabilityProfile) === adapter
}

export function inferMediaBinding(kind: "image" | "video", model: string) {
  const capabilityProfile = inferModelProfile(kind, model)
  return capabilityProfile
    ? { adapter: mediaAdapterForProfile(capabilityProfile), capabilityProfile }
    : null
}

export function mediaAdapterLabel(adapter: MediaAdapterId) {
  if (adapter === "openai-image") return "OpenAI 图片接口"
  if (adapter === "async-image") return "异步图片任务"
  return "异步视频任务"
}

export function inferModelProfile(kind: "image" | "video", model: string): ModelProfileId | null {
  const value = model.toLowerCase()
  if (kind === "image") {
    if (value.includes("banana") && value.includes("pro")) return "nano-banana-pro"
    if (value.includes("banana")) return "nano-banana-2"
    if (value.includes("gpt") && value.includes("image")) return "gpt-image-2"
    return null
  }
  if (
    value === "sd_2.5" ||
    value === "sd-2.5" ||
    value.includes("sd_2.5") ||
    value.includes("sd-2.5") ||
    value.includes("seedance-2.5") ||
    value.includes("seedance_2.5")
  ) return "sd-2.5"
  if (value.includes("seedance") && value.includes("fast")) return "seedance-2.0-fast"
  if (value.includes("seedance")) return "seedance-2.0"
  if (value.includes("minimax") && value.includes("h3")) return "minimax-h3"
  return null
}

const NON_CHAT_MODEL_TOKENS = [
  "audio",
  "embedding",
  "moderation",
  "music",
  "rerank",
  "speech",
  "tts",
  "voice",
  "whisper",
] as const

const CHAT_MODEL_TOKENS = [
  "baichuan",
  "chatgpt",
  "claude",
  "codex",
  "command-r",
  "deepseek",
  "doubao",
  "gemini",
  "glm",
  "gpt-",
  "grok",
  "hunyuan",
  "kimi",
  "llama",
  "minimax-m",
  "mistral",
  "mixtral",
  "moonshot",
  "qwen",
  "qwq",
  "step-",
] as const

const OPENAI_REASONING_MODEL_PATTERN = /(?:^|[._-])o[134](?:[._-]|$)/
const KIMI_CODE_K3_MODEL_PATTERN = /^k3(?:-256k)?$/

/** 将通用 /models 结果限制为 OpenFlow 实际支持的对话、图片、视频三类。 */
export function classifyDiscoveredModel(model: string): DiscoveredProviderModel | null {
  const id = model.trim()
  if (!id) return null

  const imageProfile = inferModelProfile("image", id)
  if (imageProfile) {
    return isModelProfileListed(imageProfile) ? { id, kind: "image", profile: imageProfile } : null
  }

  const videoProfile = inferModelProfile("video", id)
  if (videoProfile) {
    return isModelProfileListed(videoProfile) ? { id, kind: "video", profile: videoProfile } : null
  }

  const value = id.toLowerCase()
  if (NON_CHAT_MODEL_TOKENS.some((token) => value.includes(token))) return null
  if (
    CHAT_MODEL_TOKENS.some((token) => value.includes(token)) ||
    OPENAI_REASONING_MODEL_PATTERN.test(value) ||
    KIMI_CODE_K3_MODEL_PATTERN.test(value)
  ) {
    return { id, kind: "chat" }
  }
  return null
}

export function discoverModelsForKind(kind: SupportedProviderKind, models: readonly string[]) {
  const discovered = new Map<string, DiscoveredProviderModel>()
  for (const model of models) {
    const classification = classifyDiscoveredModel(model)
    if (classification?.kind === kind && !discovered.has(classification.id)) {
      discovered.set(classification.id, classification)
    }
  }
  return [...discovered.values()]
}

export function modelCapabilities(profile: ModelProfileId | null) {
  return profile ? MODEL_CAPABILITIES[profile] : null
}

export function modelProfileLabel(profile: ModelProfileId) {
  if (profile === "gpt-image-2") return "GPT Image 2"
  if (profile === "nano-banana-2") return "Nano Banana 2"
  if (profile === "nano-banana-pro") return "Nano Banana Pro"
  if (profile === "seedance-2.0") return "Seedance 2.0"
  if (profile === "seedance-2.0-fast") return "Seedance 2.0 Fast"
  if (profile === "sd-2.5") return "Seedance 2.5"
  return "MiniMax H3"
}
