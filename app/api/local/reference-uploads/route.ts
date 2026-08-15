import { badRequest } from "@/lib/http"
import {
  REFERENCE_UPLOAD_KINDS,
  ReferenceUploadError,
  saveReferenceUpload,
  type ReferenceUploadKind,
} from "@/lib/reference-uploads"

export const runtime = "nodejs"

export async function POST(request: Request) {
  const kind = new URL(request.url).searchParams.get("kind")
  if (!REFERENCE_UPLOAD_KINDS.includes(kind as ReferenceUploadKind)) {
    return badRequest("参考素材类型不合法")
  }
  if (!request.body) return badRequest("没有收到参考素材")

  const contentType = request.headers.get("content-type")?.split(";")[0]?.trim()
  if (!contentType) return badRequest("参考素材缺少文件类型")
  const rawLength = request.headers.get("content-length")
  const contentLength = rawLength ? Number(rawLength) : undefined

  try {
    const upload = await saveReferenceUpload({
      body: request.body,
      kind: kind as ReferenceUploadKind,
      contentType,
      contentLength:
        contentLength !== undefined && Number.isFinite(contentLength)
          ? contentLength
          : undefined,
      requestUrl: request.url,
      headers: request.headers,
    })
    return Response.json({ upload }, { status: 201 })
  } catch (error) {
    if (error instanceof ReferenceUploadError) {
      return Response.json({ error: error.message }, { status: error.status })
    }
    return Response.json({ error: "参考素材上传失败" }, { status: 500 })
  }
}
