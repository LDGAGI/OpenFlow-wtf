import type { LocalMediaItem } from "@/lib/local-files/media-index"

export type Kind = "image" | "video"

export const HISTORY_IMAGE_DRAG_TYPE = "application/x-openflow-history-image"

export type MediaPage = {
  items: LocalMediaItem[]
  total: number
  totalPages: number
}

export type ImageTask = {
  clientId: string
  item: LocalMediaItem
}

export type Generation = {
  id: string
  kind: Kind
  prompt: string
  modelKey: string
  requestSnapshot: {
    ratio: string
    resolution: "1K" | "2K" | "4K"
    quality: "low" | "medium" | "high"
    background: "auto" | "opaque" | "transparent"
    outputFormat: "png" | "jpeg" | "webp"
    compression: number
  } | null
  remoteUrl: string | null
  status: "queued" | "running" | "succeeded" | "failed" | "cancelled"
  errorMessage: string | null
  createdAt: string
}

export const IMAGE_RATIOS = ["1:1", "5:4", "9:16", "21:9", "16:9", "3:2", "4:3", "4:5", "3:4", "2:3", "1:8", "1:4", "4:1", "8:1"] as const
export type ImageRatio = (typeof IMAGE_RATIOS)[number]

export type ImageQuality = "low" | "medium" | "high"

export const IMAGE_SIZES: Record<ImageRatio, string> = {
  "1:1": "1024x1024",
  "4:3": "1024x768",
  "3:4": "768x1024",
  "16:9": "1536x864",
  "9:16": "864x1536",
  "5:4": "1024x768",
  "21:9": "1536x864",
  "3:2": "1536x864",
  "4:5": "768x1024",
  "2:3": "768x1024",
  "1:8": "864x1536",
  "1:4": "864x1536",
  "4:1": "1536x864",
  "8:1": "1536x864",
}
