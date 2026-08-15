import { resolveVideoModelCapabilities } from "@/lib/provider-models"
import type {
  ProviderCredentials,
  ProviderVideoCreateResult,
  ProviderVideoStatusResult,
  StandardVideoGenerationRequest,
} from "./types"
const CREATE_TIMEOUT_MS = 60_000
const STATUS_TIMEOUT_MS = 20_000

function baseUrl(credentials?: ProviderCredentials) {
  const value = credentials?.baseUrl?.trim()
  if (!value) throw new Error("视频 API 地址未配置")
  return value.replace(/\/$/, "")
}

function providerApiKey(credentials?: ProviderCredentials) {
  const value = credentials?.apiKey?.trim()
  if (!value) throw new Error("视频 API Key 未配置")
  return value
}

function asRecord(value: unknown): Record<string, unknown> | undefined {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : undefined
}

function responseData(payload: unknown) {
  const record = asRecord(payload)
  return asRecord(record?.data) ?? record
}

function stringField(value: unknown, ...keys: string[]) {
  const record = asRecord(value)
  if (!record) return undefined
  for (const key of keys) {
    const field = record[key]
    if (typeof field === "string" && field.trim()) return field.trim()
  }
  return undefined
}

function errorMessage(payload: unknown) {
  const direct = stringField(responseData(payload), "error", "message", "detail")
  if (direct) return direct
  const error = asRecord(responseData(payload)?.error)
  return error ? stringField(error, "message", "detail", "code") : undefined
}

function absoluteProviderUrl(value: string, credentials?: ProviderCredentials) {
  try {
    const url = new URL(value, `${baseUrl(credentials)}/`)
    return url.protocol === "https:" || url.protocol === "http:"
      ? url.toString()
      : undefined
  } catch {
    return undefined
  }
}

function videoUrl(payload: unknown, credentials?: ProviderCredentials) {
  const record = responseData(payload)
  if (!record) return undefined
  const direct = stringField(record, "video_url", "url")
  if (direct) return absoluteProviderUrl(direct, credentials)

  const metadata = asRecord(record.metadata)
  const metadataUrl = stringField(metadata, "video_url", "url")
  if (metadataUrl) return absoluteProviderUrl(metadataUrl, credentials)

  for (const container of [record.output, record.result]) {
    const url = stringField(container, "video_url", "url")
    if (url) return absoluteProviderUrl(url, credentials)
  }

  const data = Array.isArray(record.data) ? record.data : []
  for (const item of data) {
    const url = stringField(item, "video_url", "url")
    if (url) return absoluteProviderUrl(url, credentials)
  }
  return undefined
}

async function providerFetch(
  path: string,
  init: RequestInit,
  timeoutMs: number,
  credentials?: ProviderCredentials
) {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), timeoutMs)
  try {
    return await fetch(`${baseUrl(credentials)}${path}`, {
      ...init,
      headers: {
        Authorization: `Bearer ${providerApiKey(credentials)}`,
        ...init.headers,
      },
      signal: controller.signal,
    })
  } catch (error) {
    if (error instanceof DOMException && error.name === "AbortError") {
      throw new Error("视频供应商请求超时")
    }
    throw error
  } finally {
    clearTimeout(timeout)
  }
}

export function buildVideoModelRequest(request: StandardVideoGenerationRequest) {
  // credentials 仅用于连接，不透传给供应商；BYOK 时模型名原样传递
  const { credentials, resolution, ...body } = request
  if (!credentials) throw new Error("视频 API 配置缺失")
  const model = request.model
  // 固定输出规格的模型不传 resolution，避免上游拒绝。
  const capabilities = resolveVideoModelCapabilities({
    source: "byok",
    model: request.model,
    capabilityProfile: credentials?.capabilityProfile,
  })
  const filtered: Record<string, unknown> = { ...body, model }
  delete filtered.reference_mode
  if (!capabilities.fixedResolution) filtered.resolution = resolution
  if (!capabilities.supportsAudio) delete filtered.generate_audio
  if (!capabilities.supportsSeed) delete filtered.seed
  if (!capabilities.supportsNegativePrompt) delete filtered.negative_prompt
  if (!capabilities.supportsFirstLastFrame) {
    delete filtered.first_image_url
    delete filtered.last_image_url
  }
  if (!capabilities.supportsReferenceImages) delete filtered.reference_image_urls
  if (!capabilities.supportsReferenceVideos) delete filtered.reference_videos
  if (!capabilities.supportsReferenceAudios) delete filtered.reference_audios
  return filtered
}

export async function createVideoModelTask(
  request: StandardVideoGenerationRequest
): Promise<ProviderVideoCreateResult> {
  const response = await providerFetch(
    request.credentials?.paths?.videoCreate ?? "/videos",
    {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildVideoModelRequest(request)),
    },
    CREATE_TIMEOUT_MS,
    request.credentials
  )
  const payload = (await response.json().catch(() => undefined)) as unknown
  if (!response.ok) {
    throw new Error(errorMessage(payload) ?? "视频供应商创建任务失败")
  }

  const providerTaskId = stringField(responseData(payload), "id", "task_id", "taskId")
  if (!providerTaskId) throw new Error("视频供应商未返回任务 ID")
  return {
    providerTaskId,
    status: stringField(payload, "status") ?? "queued",
  }
}

export async function getVideoModelTaskStatus(
  providerTaskId: string,
  credentials?: ProviderCredentials
): Promise<ProviderVideoStatusResult> {
  const response = await providerFetch(
    (credentials?.paths?.videoStatus ?? "/videos/{taskId}").replace("{taskId}", encodeURIComponent(providerTaskId)),
    { method: "GET", cache: "no-store" },
    STATUS_TIMEOUT_MS,
    credentials
  )
  const payload = (await response.json().catch(() => undefined)) as unknown
  if (!response.ok) {
    throw new Error(errorMessage(payload) ?? "视频供应商查询任务失败")
  }

  const data = responseData(payload)
  const status = stringField(data, "status") ?? "unknown"
  const completed = ["completed", "succeeded", "success"].includes(
    status.toLowerCase()
  )
  return {
    providerTaskId:
      stringField(data, "id", "task_id", "taskId") ?? providerTaskId,
    status,
    remoteUrl:
      videoUrl(payload, credentials) ??
      (completed
      ? `${baseUrl(credentials)}/videos/${encodeURIComponent(providerTaskId)}/content`
        : undefined),
    error: errorMessage(payload),
  }
}
