import { z } from "zod"

import { badRequest } from "@/lib/http"

function remoteUrl(value: string) {
  try {
    const url = new URL(value)
    return url.protocol === "https:" || url.protocol === "http:" ? url : null
  } catch {
    return null
  }
}

const requestSchema = z.object({
  url: z.string().trim().url(),
  credentials: z.object({
    baseUrl: z.string().trim().url(),
    apiKey: z.string().trim().min(1),
  }).optional(),
})

// 纯本地模式的媒体转发：凭证只放请求体，避免进入 URL、历史和访问日志。
export async function POST(request: Request) {
  const parsed = requestSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return badRequest("媒体请求不合法")
  const target = remoteUrl(parsed.data.url)
  if (!target) return badRequest("媒体地址不合法")

  let authorization: string | undefined
  if (parsed.data.credentials) {
    const baseUrl = remoteUrl(parsed.data.credentials.baseUrl)
    if (baseUrl && baseUrl.origin === target.origin) {
      authorization = `Bearer ${parsed.data.credentials.apiKey}`
    }
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), 30_000)
  try {
    const upstream = await fetch(target, {
      signal: controller.signal,
      cache: "no-store",
      headers: authorization ? { Authorization: authorization } : undefined,
    })
    if (!upstream.ok || !upstream.body) {
      return Response.json({ error: "供应商媒体下载失败" }, { status: 502 })
    }
    return new Response(upstream.body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": upstream.headers.get("content-type") ?? "video/mp4",
      },
    })
  } catch {
    return Response.json({ error: "供应商媒体下载超时" }, { status: 504 })
  } finally {
    clearTimeout(timeout)
  }
}
