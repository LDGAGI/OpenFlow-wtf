import type { VideoModelCapabilities } from "@/lib/provider-models"

export type VideoReferenceMode = "frame" | "media"

export type VideoRequestPolicyInput = {
  capabilities: VideoModelCapabilities
  duration: number
  referenceMode?: VideoReferenceMode
  referenceImageCount: number
  referenceVideoCount: number
  referenceAudioCount: number
  hasFirstFrame: boolean
  hasLastFrame: boolean
}

export type VideoRequestPolicyIssue = {
  message: string
  path: "duration" | "reference_mode" | "reference_image_urls" | "reference_videos" | "reference_audios" | "first_image_url"
}

export function validateVideoRequestPolicy(input: VideoRequestPolicyInput): VideoRequestPolicyIssue[] {
  const issues: VideoRequestPolicyIssue[] = []
  const { capabilities } = input
  const hasFrame = input.hasFirstFrame || input.hasLastFrame
  const hasMedia = input.referenceImageCount + input.referenceVideoCount + input.referenceAudioCount > 0

  if (!capabilities.durations.includes(input.duration)) {
    issues.push({
      message: `该模型时长必须是 ${capabilities.durations[0]}-${capabilities.durations[capabilities.durations.length - 1]} 秒整数`,
      path: "duration",
    })
  }
  if (input.hasFirstFrame !== input.hasLastFrame) {
    issues.push({ message: "首尾帧必须成对提供", path: "first_image_url" })
  }
  if (hasFrame && hasMedia) {
    issues.push({ message: "首尾帧和全能参考不能同时使用", path: "reference_mode" })
  }
  if (hasFrame && input.referenceMode !== "frame") {
    issues.push({ message: "首尾帧必须使用 frame 模式", path: "reference_mode" })
  }
  if (hasMedia && input.referenceMode !== "media") {
    issues.push({ message: "参考素材必须使用 media 模式", path: "reference_mode" })
  }
  if (input.referenceMode === "frame" && !hasFrame) {
    issues.push({ message: "frame 模式必须提供成对首尾帧", path: "first_image_url" })
  }
  if (input.referenceMode === "media" && !hasMedia) {
    issues.push({ message: "media 模式至少需要一项参考素材", path: "reference_image_urls" })
  }
  if (hasFrame && !capabilities.supportsFirstLastFrame) {
    issues.push({ message: "该模型不支持首尾帧模式", path: "reference_mode" })
  }
  if (!capabilities.supportsReferenceImages && input.referenceImageCount > 0) {
    issues.push({ message: "该模型不支持参考图", path: "reference_image_urls" })
  } else if (input.referenceImageCount > capabilities.maxReferenceImages) {
    issues.push({ message: `该模型参考图最多 ${capabilities.maxReferenceImages} 张`, path: "reference_image_urls" })
  }
  if (!capabilities.supportsReferenceVideos && input.referenceVideoCount > 0) {
    issues.push({ message: "该模型不支持参考视频", path: "reference_videos" })
  } else if (input.referenceVideoCount > capabilities.maxReferenceVideos) {
    issues.push({ message: `该模型参考视频最多 ${capabilities.maxReferenceVideos} 段`, path: "reference_videos" })
  }
  if (!capabilities.supportsReferenceAudios && input.referenceAudioCount > 0) {
    issues.push({ message: "该模型不支持参考音频", path: "reference_audios" })
  } else if (input.referenceAudioCount > capabilities.maxReferenceAudios) {
    issues.push({ message: `该模型参考音频最多 ${capabilities.maxReferenceAudios} 个`, path: "reference_audios" })
  }
  return issues
}
