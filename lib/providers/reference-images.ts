import { readFile } from "node:fs/promises"

import { ReferenceUploadError, resolveReferenceUpload } from "@/lib/reference-uploads"

const MAX_REFERENCE_IMAGE_BYTES = 10 * 1024 * 1024
const SUPPORTED_IMAGE_TYPES = new Set(["image/jpeg", "image/png", "image/webp"])

export type LoadedReferenceImage = {
  blob: Blob
  fileName: string
}

function extension(contentType: string) {
  if (contentType === "image/jpeg") return "jpg"
  if (contentType === "image/webp") return "webp"
  return "png"
}

function parseDataImage(value: string, index: number): LoadedReferenceImage | null {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(value)
  if (!match) return null
  const bytes = Buffer.from(match[2], "base64")
  if (!bytes.length || bytes.length > MAX_REFERENCE_IMAGE_BYTES) {
    throw new Error("参考图片为空或超过 10MB 限制")
  }
  return {
    blob: new Blob([bytes], { type: match[1] }),
    fileName: `reference-${index + 1}.${extension(match[1])}`,
  }
}

async function loadSignedReference(value: string, index: number) {
  let url: URL
  try {
    url = new URL(value)
  } catch {
    throw new Error("参考图片地址无效")
  }
  const match = /^\/api\/reference-media\/([^/]+)$/.exec(url.pathname)
  if (!match) throw new Error("参考图片必须来自当前工作台上传")

  try {
    const media = await resolveReferenceUpload({
      id: decodeURIComponent(match[1]),
      expiresAt: url.searchParams.get("e"),
      contentType: url.searchParams.get("t"),
      extension: url.searchParams.get("x"),
      token: url.searchParams.get("s"),
    })
    if (!SUPPORTED_IMAGE_TYPES.has(media.contentType)) throw new Error("参考图片格式不受支持")
    if (media.size > MAX_REFERENCE_IMAGE_BYTES) throw new Error("参考图片超过 10MB 限制")
    const bytes = await readFile(media.path)
    return {
      blob: new Blob([bytes], { type: media.contentType }),
      fileName: `reference-${index + 1}.${extension(media.contentType)}`,
    }
  } catch (error) {
    if (error instanceof ReferenceUploadError) throw new Error(error.message)
    throw error
  }
}

export async function loadReferenceImages(values: readonly string[]) {
  return Promise.all(values.map(async (value, index) => {
    const dataImage = parseDataImage(value, index)
    return dataImage ?? loadSignedReference(value, index)
  }))
}

export function appendReferenceImages(form: FormData, images: readonly LoadedReferenceImage[]) {
  const field = images.length === 1 ? "image" : "image[]"
  for (const image of images) form.append(field, image.blob, image.fileName)
}
