import { createReadStream } from "node:fs"
import { Readable } from "node:stream"

import {
  ReferenceUploadError,
  resolveReferenceUpload,
} from "@/lib/reference-uploads"

export const runtime = "nodejs"

async function serve(
  request: Request,
  uploadId: string,
  includeBody: boolean
) {
  const url = new URL(request.url)
  try {
    const media = await resolveReferenceUpload({
      id: uploadId,
      expiresAt: url.searchParams.get("e"),
      contentType: url.searchParams.get("t"),
      extension: url.searchParams.get("x"),
      token: url.searchParams.get("s"),
    })
    const range = request.headers.get("range")
    let start = 0
    let end = media.size - 1
    let status = 200
    if (range) {
      const match = /^bytes=(\d+)-(\d*)$/.exec(range)
      if (!match) return new Response(null, { status: 416 })
      start = Number(match[1])
      end = match[2] ? Number(match[2]) : end
      if (start > end || end >= media.size) return new Response(null, { status: 416 })
      status = 206
    }

    const contentLength = end - start + 1
    const headers = new Headers({
      "Accept-Ranges": "bytes",
      "Cache-Control": `private, max-age=${Math.max(0, Math.floor((media.expiresAt - Date.now()) / 1000))}`,
      "Content-Length": String(contentLength),
      "Content-Type": media.contentType,
      "X-Content-Type-Options": "nosniff",
    })
    if (status === 206) {
      headers.set("Content-Range", `bytes ${start}-${end}/${media.size}`)
    }
    const body = includeBody
      ? Readable.toWeb(createReadStream(media.path, { start, end }))
      : null
    return new Response(body as BodyInit | null, { status, headers })
  } catch (error) {
    const status = error instanceof ReferenceUploadError ? error.status : 500
    const message =
      error instanceof ReferenceUploadError ? error.message : "临时媒体读取失败"
    return Response.json({ error: message }, { status })
  }
}

export async function GET(
  request: Request,
  { params }: { params: Promise<{ uploadId: string }> }
) {
  return serve(request, (await params).uploadId, true)
}

export async function HEAD(
  request: Request,
  { params }: { params: Promise<{ uploadId: string }> }
) {
  return serve(request, (await params).uploadId, false)
}
