export type ReferenceKind = "image" | "video" | "audio"

export const REFERENCE_MEDIA_LIMITS: Record<ReferenceKind, {
  maxBytes: number
  mimeTypes: readonly string[]
}> = {
  image: { maxBytes: 25 * 1024 * 1024, mimeTypes: ["image/jpeg", "image/png", "image/webp"] },
  video: { maxBytes: 200 * 1024 * 1024, mimeTypes: ["video/mp4", "video/quicktime"] },
  audio: { maxBytes: 15 * 1024 * 1024, mimeTypes: ["audio/mpeg", "audio/wav", "audio/x-wav"] },
}

export type ReferenceUploadItem = {
  id: string
  kind: ReferenceKind
  name: string
  file: File
  previewUrl: string
  providerUrl?: string
  state: "uploading" | "ready" | "failed"
  error?: string
  metadata?: { durationSeconds?: number; width?: number; height?: number }
}

export const REFERENCE_ACCEPT: Record<ReferenceKind, string> = {
  image: REFERENCE_MEDIA_LIMITS.image.mimeTypes.join(","),
  video: REFERENCE_MEDIA_LIMITS.video.mimeTypes.join(","),
  audio: REFERENCE_MEDIA_LIMITS.audio.mimeTypes.join(","),
}

export function referenceFileError(file: File, kind: ReferenceKind) {
  const limits = REFERENCE_MEDIA_LIMITS[kind]
  if (!limits.mimeTypes.includes(file.type)) {
    const label = kind === "image" ? "图片" : kind === "video" ? "视频" : "音频"
    return `不支持的${label}格式，仅支持 ${limits.mimeTypes.map((type) => type.split("/")[1]).join("、")}`
  }
  if (file.size > limits.maxBytes) {
    const label = kind === "image" ? "图片" : kind === "video" ? "视频" : "音频"
    return `${label}不能超过 ${Math.round(limits.maxBytes / 1024 / 1024)}MB`
  }
  return null
}

export async function inspectReferenceMedia(file: File, kind: ReferenceKind) {
  const url = URL.createObjectURL(file)
  try {
    if (kind === "image") {
      const image = new Image()
      image.src = url
      await image.decode()
      return { width: image.naturalWidth, height: image.naturalHeight }
    }
    if (kind === "video") {
      const video = document.createElement("video")
      video.preload = "metadata"
      video.src = url
      await new Promise<void>((resolve, reject) => {
        video.onloadedmetadata = () => resolve()
        video.onerror = () => reject(new Error("无法读取视频元数据"))
      })
      return { durationSeconds: video.duration, width: video.videoWidth, height: video.videoHeight }
    }
    const audio = document.createElement("audio")
    audio.preload = "metadata"
    audio.src = url
    await new Promise<void>((resolve, reject) => {
      audio.onloadedmetadata = () => resolve()
      audio.onerror = () => reject(new Error("无法读取音频元数据"))
    })
    return { durationSeconds: audio.duration }
  } finally {
    URL.revokeObjectURL(url)
  }
}

export function referenceMetadataError(kind: ReferenceKind, metadata: ReferenceUploadItem["metadata"], limits?: {
  videoDuration?: { min: number; max: number }
  audioMaxDuration?: number
  videoDimensions?: { min: number; max: number }
}) {
  if (!metadata) return null
  if (kind === "video") {
    if (limits?.videoDuration && metadata.durationSeconds !== undefined && (metadata.durationSeconds < limits.videoDuration.min || metadata.durationSeconds > limits.videoDuration.max)) {
      return `参考视频单条时长必须为 ${limits.videoDuration.min}-${limits.videoDuration.max} 秒`
    }
    if (limits?.videoDimensions && metadata.width !== undefined && metadata.height !== undefined && (metadata.width < limits.videoDimensions.min || metadata.width > limits.videoDimensions.max || metadata.height < limits.videoDimensions.min || metadata.height > limits.videoDimensions.max)) {
      return `参考视频宽高必须分别在 ${limits.videoDimensions.min}-${limits.videoDimensions.max} 像素之间`
    }
  }
  if (kind === "audio" && limits?.audioMaxDuration && metadata.durationSeconds !== undefined && metadata.durationSeconds > limits.audioMaxDuration) {
    return `参考音频时长不能超过 ${limits.audioMaxDuration} 秒`
  }
  return null
}
