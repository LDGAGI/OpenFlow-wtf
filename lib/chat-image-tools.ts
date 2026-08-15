import type { ModelOption } from "./provider-settings"

export type ChatToolMode = "ask" | "auto"
export type ChatImageResolution = "1K" | "2K" | "4K"
export type ChatImageQuality = "low" | "medium" | "high"
export type ChatImageBackground = "auto" | "opaque" | "transparent"
export type ChatImageOutputFormat = "png" | "jpeg" | "webp"

export type ImageGenerationProposal = {
  prompt: string
  model?: string
  aspectRatio?: string
  resolution?: ChatImageResolution
  quality?: ChatImageQuality
  background?: ChatImageBackground
  outputFormat?: ChatImageOutputFormat
  count: number
}

export type ImageGenerationApproval = ImageGenerationProposal & {
  modelOption: ModelOption
  status: "draft" | "submitting" | "submitted" | "failed"
  error?: string
}

export type ChatImageToolContext = {
  current: {
    modelOption: ModelOption
    aspectRatio: string
    resolution?: ChatImageResolution
    quality: ChatImageQuality
    background: ChatImageBackground
    outputFormat: ChatImageOutputFormat
  }
  models: Array<ModelOption & {
    label: string
    aspectRatios: readonly string[]
    resolutions: readonly ChatImageResolution[]
    qualities: readonly ChatImageQuality[]
    backgrounds: readonly ChatImageBackground[]
    outputFormats: readonly ChatImageOutputFormat[]
    points: number | null
  }>
}

export type ChatImageGenerationRequest = {
  prompt: string
  modelOption: ModelOption
  aspectRatio: string
  resolution?: ChatImageResolution
  quality?: ChatImageQuality
  background?: ChatImageBackground
  outputFormat?: ChatImageOutputFormat
}
