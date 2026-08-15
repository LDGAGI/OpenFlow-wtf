import { imageModelResolution } from "@/lib/image-model-families"

import type {
  ImageProviderOperation,
  ImageSize,
  ProviderCredentials,
  ProviderImageResult,
  ProviderImageStatusResult,
  StandardImageEditRequest,
} from "./types"
import { parseImageResponse } from "./image-response"
import { appendReferenceImages, loadReferenceImages } from "./reference-images"

const CREATE_TIMEOUT_MS = 30_000
const STATUS_TIMEOUT_MS = 30_000

/** 标准尺寸到上游画幅的映射。 */
const SIZE_ASPECT_RATIOS: Record<ImageSize, string> = {
  "1024x1024": "1:1",
  "1536x864": "16:9",
  "864x1536": "9:16",
  "1024x768": "4:3",
  "768x1024": "3:4",
}

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

function stringField(payload: unknown, ...keys: string[]) {
  if (!payload || typeof payload !== "object") return undefined
  const record = payload as Record<string, unknown>
  for (const key of keys) {
    if (typeof record[key] === "string" && record[key]) return record[key] as string
  }
  return undefined
}

function endpoint(path: string, credentials?: ProviderCredentials) {
  return `${baseUrl(credentials)}${path.startsWith("/") ? path : `/${path}`}`
}

async function providerFetch(path: string, init: RequestInit, timeoutMs: number, credentials?: ProviderCredentials) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(endpoint(path, credentials), {
      ...init,
      headers: {
        Authorization: `Bearer ${apiKey(credentials)}`,
        ...init.headers,
      },
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("图片供应商请求超时")
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

/** Nano Banana 固定档位统一使用异步 JSON 协议。 */
export async function generateNanoBananaImage(input: {
  model: string
  prompt: string
  size: ImageSize
  resolution?: "1K" | "2K" | "4K"
  aspect_ratio?: string
  credentials?: ProviderCredentials
}): Promise<ProviderImageResult> {
  // 显式模型分辨率优先于界面残留状态。
  const imageSize = imageModelResolution(input.model) ?? input.resolution
  if (!imageSize) throw new Error(`图片模型 ${input.model} 未配置`)

  try {
    const path = input.credentials?.paths?.imageGenerate ?? "/images/generations"
    const response = await providerFetch(path, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildNanoBananaRequest({ ...input, resolution: imageSize })),
    }, CREATE_TIMEOUT_MS, input.credentials)
    const payload = (await response.json().catch(() => undefined)) as unknown

    if (!response.ok) throw new Error(providerError(payload))
    const providerTaskId = stringField(payload, "id", "task_id", "taskId")
    if (!providerTaskId) {
      const completed = parseImageResponse(payload, baseUrl(input.credentials))
      return completed
    }
    return {
      dispatch: "async",
      providerTaskId,
      providerOperation: "image_generation",
      status: stringField(payload, "status") ?? "queued",
    }
  } catch (error) {
    throw error instanceof Error ? error : new Error("图片生成失败")
  }
}

export async function editNanoBananaImage(input: StandardImageEditRequest): Promise<ProviderImageResult> {
  const imageSize = imageModelResolution(input.model) ?? input.resolution
  if (!imageSize) throw new Error(`图片模型 ${input.model} 未配置`)

  try {
    const references = await loadReferenceImages(input.reference_images)
    const form = buildNanoBananaEditForm(input, references, imageSize)
    const path = input.credentials?.paths?.imageEdit ?? "/images/edits"
    const response = await providerFetch(path, { method: "POST", body: form }, CREATE_TIMEOUT_MS, input.credentials)
    const payload = (await response.json().catch(() => undefined)) as unknown
    if (!response.ok) throw new Error(providerError(payload))

    const providerTaskId = stringField(payload, "id", "task_id", "taskId")
    if (!providerTaskId) return parseImageResponse(payload, baseUrl(input.credentials))
    return {
      dispatch: "async",
      providerTaskId,
      providerOperation: "image_edit",
      status: stringField(payload, "status") ?? "queued",
    }
  } catch (error) {
    throw error instanceof Error ? error : new Error("图片编辑失败")
  }
}

export function buildNanoBananaEditForm(
  input: StandardImageEditRequest,
  references: Parameters<typeof appendReferenceImages>[1],
  resolution: "1K" | "2K" | "4K"
) {
  const imageSize = imageModelResolution(input.model) ?? resolution
  const form = new FormData()
  form.set("model", input.model)
  form.set("prompt", input.prompt)
  form.set("aspect_ratio", input.aspect_ratio ?? SIZE_ASPECT_RATIOS[input.size])
  form.set("image_size", imageSize)
  form.set("async", "true")
  appendReferenceImages(form, references)
  return form
}

export async function getNanoBananaImageStatus(
  providerTaskId: string,
  operation: ImageProviderOperation,
  credentials?: ProviderCredentials
): Promise<ProviderImageStatusResult> {
  const template = operation === "image_edit"
    ? credentials?.paths?.imageEditStatus ?? "/images/edits/{taskId}"
    : credentials?.paths?.imageGenerateStatus ?? "/images/generations/{taskId}"
  const path = template.replace("{taskId}", encodeURIComponent(providerTaskId))
  const response = await providerFetch(path, { method: "GET", cache: "no-store" }, STATUS_TIMEOUT_MS, credentials)
  const payload = (await response.json().catch(() => undefined)) as unknown
  if (!response.ok) throw new Error(providerError(payload))

  const status = stringField(payload, "status") ?? "unknown"
  const completed = ["completed", "succeeded", "success"].includes(status.toLowerCase())
  let remoteUrl: string | undefined
  if (completed) {
    try {
      const result = parseImageResponse(payload, baseUrl(credentials))
      remoteUrl = result.remoteUrl
    } catch {
      remoteUrl = undefined
    }
  }
  return {
    providerTaskId: stringField(payload, "id", "task_id", "taskId") ?? providerTaskId,
    providerOperation: operation,
    status,
    remoteUrl,
    error: ["failed", "error", "cancelled", "canceled"].includes(status.toLowerCase())
      ? providerError(payload)
      : undefined,
  }
}

export function buildNanoBananaRequest(input: {
  model: string
  prompt: string
  size: ImageSize
  resolution: "1K" | "2K" | "4K"
  aspect_ratio?: string
}) {
  const imageSize = imageModelResolution(input.model) ?? input.resolution
  return {
    model: input.model,
    prompt: input.prompt,
    n: 1,
    aspect_ratio: input.aspect_ratio ?? SIZE_ASPECT_RATIOS[input.size],
    image_size: imageSize,
    async: true,
  }
}
