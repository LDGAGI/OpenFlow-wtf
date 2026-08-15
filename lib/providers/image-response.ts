import type { ProviderImageResult } from "./types"

function absoluteUrl(value: string, baseUrl?: string) {
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null
  } catch {
    if (!baseUrl || !value.startsWith("/")) return null
    try {
      const url = new URL(value, baseUrl)
      return url.protocol === "https:" || url.protocol === "http:" ? url.toString() : null
    } catch {
      return null
    }
  }
}

function isLikelyBase64(value: string) {
  return value.length >= 32 && /^[A-Za-z0-9+/]+={0,2}$/.test(value)
}

/** Normalize OpenAI-compatible image responses, which may contain a URL or base64 data. */
export function parseImageResponse(
  payload: unknown,
  baseUrl?: string
): Extract<ProviderImageResult, { dispatch: "completed" }> {
  if (!payload || typeof payload !== "object") throw new Error("图片供应商返回了无效响应")
  const record = payload as Record<string, unknown>

  const topLevelUrl = ["url", "image_url", "imageUrl", "output_url"].map((key) => record[key]).find((value) => typeof value === "string")
  if (typeof topLevelUrl === "string") {
    const url = absoluteUrl(topLevelUrl.trim(), baseUrl)
    if (url) return { dispatch: "completed", remoteUrl: url, providerResponseId: typeof record.id === "string" ? record.id : undefined }
  }

  const candidates: unknown[] = []
  for (const key of ["data", "images", "output", "result"] as const) {
    const value = record[key]
    if (Array.isArray(value)) candidates.push(...value)
    else if (value) candidates.push(value)
  }
  if (!candidates.length) candidates.push(payload)

  for (const candidate of candidates) {
    if (typeof candidate === "string") {
      const value = candidate.trim()
      const url = absoluteUrl(value, baseUrl)
      if (url) return { dispatch: "completed", remoteUrl: url, providerResponseId: typeof record.id === "string" ? record.id : undefined }
      if (isLikelyBase64(value)) return { dispatch: "completed", remoteUrl: `data:image/png;base64,${value}`, providerResponseId: typeof record.id === "string" ? record.id : undefined }
      continue
    }
    if (!candidate || typeof candidate !== "object") continue
    const item = candidate as Record<string, unknown>
    const urlValue = ["url", "image_url", "imageUrl", "uri"].map((key) => item[key]).find((value) => typeof value === "string")
    const url = typeof urlValue === "string" ? absoluteUrl(urlValue.trim(), baseUrl) : null
    if (url) {
      return {
        dispatch: "completed",
        remoteUrl: url,
        providerResponseId: typeof record.id === "string" ? record.id : undefined,
      }
    }
    const nestedUrl = item.image_url && typeof item.image_url === "object"
      ? (item.image_url as Record<string, unknown>).url
      : undefined
    const nestedRemoteUrl = typeof nestedUrl === "string" ? absoluteUrl(nestedUrl.trim(), baseUrl) : null
    if (nestedRemoteUrl) {
      return { dispatch: "completed", remoteUrl: nestedRemoteUrl, providerResponseId: typeof record.id === "string" ? record.id : undefined }
    }
    const base64Value = ["b64_json", "base64", "base64_json", "image_base64", "imageBase64", "image"].map((key) => item[key]).find((value) => typeof value === "string")
    const base64 = typeof base64Value === "string" ? base64Value.trim() : ""
    if (isLikelyBase64(base64) || base64.startsWith("data:image/")) {
      if (base64.startsWith("data:image/")) {
        return { dispatch: "completed", remoteUrl: base64, providerResponseId: typeof record.id === "string" ? record.id : undefined }
      }
      const mime = typeof item.mime_type === "string" ? item.mime_type : typeof item.content_type === "string" ? item.content_type : "image/png"
      return {
        dispatch: "completed",
        remoteUrl: `data:${mime};base64,${base64}`,
        providerResponseId: typeof record.id === "string" ? record.id : undefined,
      }
    }
  }

  const fields = Object.keys(record).slice(0, 12).join(", ") || "无"
  const firstCandidate = candidates[0]
  const nestedFields = firstCandidate && typeof firstCandidate === "object"
    ? Object.keys(firstCandidate as Record<string, unknown>).slice(0, 12).join(", ")
    : ""
  throw new Error(`图片供应商未返回可保存的 URL 或图片数据（响应字段：${fields}${nestedFields ? `；图片字段：${nestedFields}` : ""}）`)
}
