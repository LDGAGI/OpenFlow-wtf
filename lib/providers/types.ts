import type { MediaAdapterId, ModelProfileId, ProviderPathOverrides } from "@/lib/provider-models"

export const IMAGE_SIZES = [
  "1024x1024",
  "1536x864",
  "864x1536",
  "1024x768",
  "768x1024",
] as const

export const IMAGE_ASPECT_RATIOS = [
  "1:1", "5:4", "9:16", "21:9", "16:9", "3:2", "4:3", "4:5", "3:4", "2:3",
  "1:8", "1:4", "4:1", "8:1",
] as const
export type ImageAspectRatio = (typeof IMAGE_ASPECT_RATIOS)[number]

export type ImageSize = (typeof IMAGE_SIZES)[number]
export type ImageQuality = "low" | "medium" | "high"

/** BYOK 凭证：存在时优先于服务端 env 配置 */
export type ProviderCredentials = {
  baseUrl?: string
  apiKey?: string
  adapter?: MediaAdapterId
  capabilityProfile?: ModelProfileId
  paths?: ProviderPathOverrides
}

export type StandardImageGenerationRequest = {
  model: string
  prompt: string
  n: 1
  size: ImageSize
  quality: ImageQuality
  background: "auto" | "opaque" | "transparent"
  output_format: "png" | "jpeg" | "webp"
  output_compression?: number
  moderation: "auto"
  stream: false
  /** 模型原生画幅；Banana 等模型支持的比例多于 OpenAI 固定 size 枚举。 */
  aspect_ratio?: ImageAspectRatio
  resolution?: "1K" | "2K" | "4K"
  reference_images?: string[]
  credentials?: ProviderCredentials
}

export type StandardImageEditRequest = StandardImageGenerationRequest & {
  reference_images: [string, ...string[]]
  input_fidelity?: "low" | "high"
}

export type ImageProviderOperation = "image_generation" | "image_edit"

export type ProviderImageResult =
  | {
      dispatch: "completed"
      remoteUrl: string
      providerResponseId?: string
    }
  | {
      dispatch: "async"
      providerTaskId: string
      providerOperation: ImageProviderOperation
      status: string
    }

export type ProviderImageStatusResult = {
  providerTaskId: string
  providerOperation: ImageProviderOperation
  status: string
  remoteUrl?: string
  error?: string
}

export const VIDEO_ASPECT_RATIOS = [
  "21:9",
  "16:9",
  "4:3",
  "1:1",
  "3:4",
  "9:16",
] as const
export const VIDEO_DURATIONS = [4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30] as const
export const VIDEO_RESOLUTIONS = ["480p", "720p"] as const
export const VIDEO_MODEL_KEYS: readonly string[] = []

export type VideoAspectRatio = (typeof VIDEO_ASPECT_RATIOS)[number]
export type VideoDuration = (typeof VIDEO_DURATIONS)[number]
export type VideoResolution = (typeof VIDEO_RESOLUTIONS)[number]
export type VideoModel = string
export type VideoReferenceMode = "frame" | "media"

export type StandardVideoGenerationRequest = {
  /** BYOK（带 credentials）时允许任意模型名，否则限 VIDEO_MODEL_KEYS */
  model: string
  prompt: string
  duration: VideoDuration
  aspect_ratio: VideoAspectRatio
  generate_audio: boolean
  resolution: VideoResolution
  reference_mode?: VideoReferenceMode
  reference_image_urls?: string[]
  first_image_url?: string
  last_image_url?: string
  reference_videos?: string[]
  reference_audios?: string[]
  negative_prompt?: string
  seed?: number
  credentials?: ProviderCredentials
}

export type ProviderVideoCreateResult = {
  providerTaskId: string
  status: string
}

export type ProviderVideoStatusResult = {
  providerTaskId: string
  status: string
  remoteUrl?: string
  error?: string
}
