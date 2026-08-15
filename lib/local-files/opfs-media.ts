"use client"

const MEDIA_DIRECTORY = "media"
const THUMBNAIL_DIRECTORY = "thumbnails"
const REFERENCE_DIRECTORY = "references"
const THUMBNAIL_EDGE = 512

function extension(contentType: string | null, kind: "image" | "video") {
  if (contentType?.includes("png")) return "png"
  if (contentType?.includes("webp")) return "webp"
  if (contentType?.includes("gif")) return "gif"
  if (contentType?.includes("webm")) return "webm"
  if (contentType?.includes("quicktime")) return "mov"
  return kind === "image" ? "jpg" : "mp4"
}

function parseKey(key: string) {
  const [directory, fileName, ...rest] = key.split("/")
  if (
    rest.length ||
    (directory !== MEDIA_DIRECTORY && directory !== THUMBNAIL_DIRECTORY && directory !== REFERENCE_DIRECTORY) ||
    !fileName ||
    fileName.includes("..")
  ) throw new Error("本地媒体键不合法")
  return { directory, fileName }
}

export async function persistReferenceMedia(id: string, file: File) {
  const fileName = `${id}.${extension(file.type, "image")}`
  const references = await directory(REFERENCE_DIRECTORY, true)
  const handle = await references.getFileHandle(fileName, { create: true })
  const writable = await handle.createWritable()
  await file.stream().pipeTo(writable)
  return `${REFERENCE_DIRECTORY}/${fileName}`
}

async function directory(name: string, create: boolean) {
  const root = await navigator.storage.getDirectory()
  return root.getDirectoryHandle(name, { create })
}

export async function persistOriginalMedia(input: {
  id: string
  kind: "image" | "video"
  response: Response
}) {
  if (!input.response.body) throw new Error("媒体响应为空")
  void navigator.storage.persist?.().catch(() => false)
  const contentType = input.response.headers.get("content-type")
  const fileName = `${input.id}.${extension(contentType, input.kind)}`
  const media = await directory(MEDIA_DIRECTORY, true)
  const handle = await media.getFileHandle(fileName, { create: true })
  const writable = await handle.createWritable()
  await input.response.body.pipeTo(writable)
  return `${MEDIA_DIRECTORY}/${fileName}`
}

export async function readStoredMedia(key: string): Promise<File | null> {
  try {
    const parsed = parseKey(key)
    const folder = await directory(parsed.directory, false)
    const handle = await folder.getFileHandle(parsed.fileName)
    return await handle.getFile()
  } catch {
    return null
  }
}

function canvasBlob(canvas: HTMLCanvasElement) {
  return new Promise<Blob>((resolve, reject) => {
    canvas.toBlob(
      (blob) => blob ? resolve(blob) : reject(new Error("缩略图编码失败")),
      "image/webp",
      0.78
    )
  })
}

export async function createStoredImageThumbnail(id: string, originalKey: string) {
  const file = await readStoredMedia(originalKey)
  if (!file) throw new Error("本地原图不存在")
  const bitmap = await createImageBitmap(file)
  try {
    const scale = Math.min(1, THUMBNAIL_EDGE / Math.max(bitmap.width, bitmap.height))
    const canvas = document.createElement("canvas")
    canvas.width = Math.max(1, Math.round(bitmap.width * scale))
    canvas.height = Math.max(1, Math.round(bitmap.height * scale))
    const context = canvas.getContext("2d")
    if (!context) throw new Error("浏览器无法生成缩略图")
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height)
    const blob = await canvasBlob(canvas)
    const fileName = `${id}.webp`
    const thumbnails = await directory(THUMBNAIL_DIRECTORY, true)
    const handle = await thumbnails.getFileHandle(fileName, { create: true })
    const writable = await handle.createWritable()
    await writable.write(blob)
    await writable.close()
    return `${THUMBNAIL_DIRECTORY}/${fileName}`
  } finally {
    bitmap.close()
  }
}
