import {
  IMAGE_FAMILY_SKUS,
} from "@/lib/image-model-families"

import { editNanoBananaImage, generateNanoBananaImage, getNanoBananaImageStatus } from "./nano-banana"
import { editGptImage, generateGptImage } from "./gpt-image"
import { createVideoModelTask, getVideoModelTaskStatus } from "./video-models"
import type {
  ProviderCredentials,
  ImageProviderOperation,
  ProviderImageResult,
  ProviderImageStatusResult,
  StandardImageGenerationRequest,
  StandardImageEditRequest,
  StandardVideoGenerationRequest,
} from "./types"
import { resolveModelCapabilities, type MediaAdapterId } from "@/lib/provider-models"
import { VIDEO_MODEL_KEYS } from "./types"

// 图片能力适配器用于解析用户配置的模型协议。
export const IMAGE_MODEL_KEYS = ["gpt-image-2", ...IMAGE_FAMILY_SKUS] as const
export { VIDEO_MODEL_KEYS } from "./types"

type ImageProvider = {
  generate(request: StandardImageGenerationRequest): Promise<ProviderImageResult>
  edit?(request: StandardImageEditRequest): Promise<ProviderImageResult>
  getStatus?(
    providerTaskId: string,
    operation: ImageProviderOperation,
    credentials?: ProviderCredentials
  ): Promise<ProviderImageStatusResult>
}

const gptImageProvider: ImageProvider = {
  generate: generateGptImage,
  edit: editGptImage,
}

const nanoBananaProvider: ImageProvider = {
  generate: generateNanoBananaImage,
  edit: editNanoBananaImage,
  getStatus: getNanoBananaImageStatus,
}

const imageProviders = new Map<string, ImageProvider>([
  ["gpt-image-2", gptImageProvider],
  ["nano-banana2-1k", nanoBananaProvider],
  ["nano-banana2-2k", nanoBananaProvider],
  ["nano-banana2-4k", nanoBananaProvider],
  ["nano-banana-pro-1k", nanoBananaProvider],
  ["nano-banana-pro-2k", nanoBananaProvider],
  ["nano-banana-pro-4k", nanoBananaProvider],
])

// BYOK 按显式协议分发；上游模型 ID 始终原样发送。
const byokImageAdapters = new Map<MediaAdapterId, ImageProvider>([
  ["openai-image", gptImageProvider],
  ["async-image", nanoBananaProvider],
])

export async function generateImage(request: StandardImageGenerationRequest) {
  // BYOK 使用公共模型类型选择参数转换器；上游真实模型 ID 不参与注册器命名。
  if (request.credentials) {
    const provider = request.credentials.adapter
      ? byokImageAdapters.get(request.credentials.adapter)
      : undefined
    if (!provider) throw new Error("请选择该上游模型使用的图片接口")
    if (request.reference_images?.length) {
      if (!provider.edit) throw new Error("当前图片模型不支持图生图")
      return provider.edit({
        ...request,
        reference_images: request.reference_images as [string, ...string[]],
      })
    }
    return provider.generate(request)
  }
  const provider = imageProviders.get(request.model)
  if (!provider) throw new Error(`图片模型 ${request.model} 未配置`)
  if (request.reference_images?.length) {
    if (!provider.edit) throw new Error("当前图片模型不支持图生图")
    return provider.edit({
      ...request,
      reference_images: request.reference_images as [string, ...string[]],
    })
  }
  return provider.generate(request)
}

export async function getImageStatus(
  model: string,
  providerTaskId: string,
  operation: ImageProviderOperation,
  credentials?: ProviderCredentials
) {
  const provider = credentials
    ? credentials.adapter ? byokImageAdapters.get(credentials.adapter) : undefined
    : imageProviders.get(model)
  if (!provider?.getStatus) throw new Error(`图片模型 ${model} 不支持异步状态查询`)
  return provider.getStatus(providerTaskId, operation, credentials)
}

export async function generateVideo(request: StandardVideoGenerationRequest) {
  if (request.credentials) {
    if (request.credentials.adapter !== "async-video") {
      throw new Error("请选择异步视频任务接口")
    }
    const capabilities = resolveModelCapabilities({
      kind: "video",
      source: "byok",
      model: request.model,
      capabilityProfile: request.credentials.capabilityProfile,
    })
    if (capabilities?.kind !== "video") {
      throw new Error("请选择该视频模型的能力模板")
    }
  }
  if (
    !request.credentials &&
    !(VIDEO_MODEL_KEYS as readonly string[]).includes(request.model)
  ) {
    throw new Error(`视频模型 ${request.model} 未配置`)
  }
  return createVideoModelTask(request)
}

export async function getVideoStatus(
  providerTaskId: string,
  credentials?: ProviderCredentials
) {
  return getVideoModelTaskStatus(providerTaskId, credentials)
}
