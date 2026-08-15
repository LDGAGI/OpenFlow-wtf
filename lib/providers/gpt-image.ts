import type {
  ImageSize,
  ImageQuality,
  ProviderCredentials,
  ProviderImageResult,
  StandardImageEditRequest,
  StandardImageGenerationRequest,
} from "./types"
import { parseImageResponse } from "./image-response"
import { appendReferenceImages, loadReferenceImages } from "./reference-images"

// GPT Image edits can take several minutes for high-fidelity reference workflows.
const REQUEST_TIMEOUT_MS = 300_000

function baseUrl(credentials?: ProviderCredentials) {
  const value = credentials?.baseUrl?.trim()
  if (!value) throw new Error("图片 API 地址未配置")
  return value.replace(/\/$/, "")
}

function apiKey(credentials?: ProviderCredentials) {
  const value = credentials?.apiKey?.trim()
  if (!value) throw new Error("图片 API Key 未配置")
  return value
}

function providerError(payload: unknown) {
  if (!payload || typeof payload !== "object") return "图片供应商请求失败"
  const record = payload as Record<string, unknown>
  if (typeof record.error === "string") return record.error
  if (record.error && typeof record.error === "object") {
    const error = record.error as Record<string, unknown>
    if (typeof error.message === "string") return error.message
  }
  if (typeof record.message === "string") return record.message
  return "图片供应商请求失败"
}

export function buildStandardImageRequest(input: {
  model: string
  prompt: string
  size: ImageSize
  quality: ImageQuality
  resolution?: "1K" | "2K" | "4K"
  background?: "auto" | "opaque" | "transparent"
  output_format?: "png" | "jpeg" | "webp"
  output_compression?: number
}): StandardImageGenerationRequest {
  return {
    model: input.model,
    prompt: input.prompt,
    n: 1,
    size: input.size,
    quality: input.quality,
    background: input.background ?? "opaque",
    output_format: input.output_format ?? "png",
    ...(input.output_compression !== undefined ? { output_compression: input.output_compression } : {}),
    moderation: "auto",
    stream: false,
    ...(input.resolution ? { resolution: input.resolution } : {}),
  }
}

function providerEndpoint(path: string, credentials?: ProviderCredentials) {
  return `${baseUrl(credentials)}${path.startsWith("/") ? path : `/${path}`}`
}

async function imageResponse(response: Response, credentials?: ProviderCredentials) {
  const payload = (await response.json().catch(() => undefined)) as unknown
  if (!response.ok) throw new Error(providerError(payload))
  return parseImageResponse(payload, baseUrl(credentials))
}

export async function generateGptImage(input: {
  model: string
  prompt: string
  size: ImageSize
  quality: ImageQuality
  background?: "auto" | "opaque" | "transparent"
  output_format?: "png" | "jpeg" | "webp"
  output_compression?: number
  reference_images?: string[]
  resolution?: "1K" | "2K" | "4K"
  credentials?: ProviderCredentials
}): Promise<ProviderImageResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const path = input.credentials?.paths?.imageGenerate ?? "/images/generations"
    const response = await fetch(providerEndpoint(path, input.credentials), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey(input.credentials)}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify(buildStandardImageRequest(input)),
      signal: controller.signal,
    })
    return await imageResponse(response, input.credentials)
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("图片生成请求超时")
    }
    throw error instanceof Error ? error : new Error("图片生成失败")
  } finally {
    clearTimeout(timeout)
  }
}

export async function editGptImage(input: StandardImageEditRequest): Promise<ProviderImageResult> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)

  try {
    const references = await loadReferenceImages(input.reference_images)
    const form = buildGptImageEditForm(input, references)
    const path = input.credentials?.paths?.imageEdit ?? "/images/edits"
    const response = await fetch(providerEndpoint(path, input.credentials), {
      method: "POST",
      headers: { Authorization: `Bearer ${apiKey(input.credentials)}` },
      body: form,
      signal: controller.signal,
    })
    return await imageResponse(response, input.credentials)
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("图片编辑请求超时")
    }
    throw error instanceof Error ? error : new Error("图片编辑失败")
  } finally {
    clearTimeout(timeout)
  }
}

export function buildGptImageEditForm(
  input: StandardImageEditRequest,
  references: Parameters<typeof appendReferenceImages>[1]
) {
  const form = new FormData()
  form.set("model", input.model)
  form.set("prompt", input.prompt)
  form.set("n", "1")
  form.set("size", input.size)
  form.set("quality", input.quality)
  form.set("background", input.background)
  form.set("output_format", input.output_format)
  form.set("moderation", input.moderation)
  form.set("input_fidelity", input.input_fidelity ?? "high")
  if (input.output_compression !== undefined) {
    form.set("output_compression", String(input.output_compression))
  }
  appendReferenceImages(form, references)
  return form
}
