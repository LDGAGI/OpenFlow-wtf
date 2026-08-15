import { createHmac, randomUUID, timingSafeEqual } from "node:crypto"
import { createWriteStream } from "node:fs"
import { mkdir, rename, stat } from "node:fs/promises"
import { resolve } from "node:path"
import { Readable, Transform } from "node:stream"
import { pipeline } from "node:stream/promises"
import type { ReadableStream as NodeReadableStream } from "node:stream/web"


export const REFERENCE_UPLOAD_KINDS = ["image", "video", "audio"] as const
export type ReferenceUploadKind = (typeof REFERENCE_UPLOAD_KINDS)[number]

const UPLOAD_TTL_MS = 24 * 60 * 60 * 1000
const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i

const MEDIA_TYPES = {
  image: {
    maxBytes: 25 * 1024 * 1024,
    types: {
      "image/jpeg": ".jpg",
      "image/png": ".png",
      "image/webp": ".webp",
    },
  },
  video: {
    maxBytes: 200 * 1024 * 1024,
    types: {
      "video/mp4": ".mp4",
      "video/quicktime": ".mov",
    },
  },
  audio: {
    maxBytes: 15 * 1024 * 1024,
    types: {
      "audio/mpeg": ".mp3",
      "audio/wav": ".wav",
      "audio/x-wav": ".wav",
    },
  },
} as const

export class ReferenceUploadError extends Error {
  constructor(message: string, readonly status = 400) {
    super(message)
  }
}

function rootDirectory() {
  return resolve(
    /* turbopackIgnore: true */
    process.cwd(),
    process.env.REFERENCE_UPLOAD_DIR ?? "./data/reference-uploads"
  )
}

function signingSecret() {
  const value = process.env.REFERENCE_UPLOAD_SECRET?.trim()
  if (!value) throw new ReferenceUploadError("临时上传签名密钥未配置", 500)
  return value
}

function mediaConfig(kind: ReferenceUploadKind, contentType: string) {
  const config = MEDIA_TYPES[kind]
  const extension = (config.types as Record<string, string>)[contentType]
  if (!extension) {
    throw new ReferenceUploadError(`不支持的${kind === "image" ? "图片" : kind === "video" ? "视频" : "音频"}格式`)
  }
  return { extension, maxBytes: config.maxBytes }
}

function signature(input: {
  id: string
  extension: string
  contentType: string
  expiresAt: number
}) {
  return createHmac("sha256", signingSecret())
    .update(`${input.id}.${input.extension}.${input.contentType}.${input.expiresAt}`)
    .digest("base64url")
}

function publicBaseUrl(input: { requestUrl: string; headers?: Headers }) {
  const configured = process.env.REFERENCE_MEDIA_PUBLIC_BASE_URL?.trim()
  if (configured) return configured.replace(/\/$/, "")

  const origin = new URL(input.requestUrl)
  // `next start` 默认用监听地址（localhost/0.0.0.0）而不是 Host 头拼
  // request.url，域名部署时这种 origin 外部无法访问，必须优先用请求头里的
  // 真实 host；REFERENCE_MEDIA_PUBLIC_BASE_URL 仍可作为显式覆盖。
  const host =
    input.headers?.get("x-forwarded-host")?.split(",")[0]?.trim() ||
    input.headers?.get("host")?.trim()
  if (!host) return origin.origin.replace(/\/$/, "")
  const proto =
    input.headers?.get("x-forwarded-proto")?.split(",")[0]?.trim() ||
    origin.protocol.replace(":", "")
  return `${proto}://${host}`
}

export async function saveReferenceUpload(input: {
  body: ReadableStream<Uint8Array>
  kind: ReferenceUploadKind
  contentType: string
  contentLength?: number
  requestUrl: string
  headers?: Headers
  userId?: string
  projectId?: string
}) {
  const { extension, maxBytes } = mediaConfig(input.kind, input.contentType)
  if (input.contentLength !== undefined && input.contentLength > maxBytes) {
    throw new ReferenceUploadError("参考素材超过当前类型的大小限制", 413)
  }

  const id = randomUUID()
  const root = rootDirectory()
  await mkdir(root, { recursive: true })
  const finalPath = resolve(/* turbopackIgnore: true */ root, `${id}${extension}`)
  const partialPath = `${finalPath}.partial`
  let receivedBytes = 0
  const limiter = new Transform({
    transform(chunk: Buffer, _encoding, callback) {
      receivedBytes += chunk.length
      callback(
        receivedBytes > maxBytes
          ? new ReferenceUploadError("参考素材超过当前类型的大小限制", 413)
          : null,
        chunk
      )
    },
  })

  await pipeline(
    Readable.fromWeb(
      input.body as unknown as NodeReadableStream<Uint8Array>
    ),
    limiter,
    createWriteStream(partialPath, { flags: "wx" })
  )
  await rename(partialPath, finalPath)

  const expiresAt = Date.now() + UPLOAD_TTL_MS
  const token = signature({
    id,
    extension,
    contentType: input.contentType,
    expiresAt,
  })
  const params = new URLSearchParams({
    e: String(expiresAt),
    t: input.contentType,
    x: extension,
    s: token,
  })
  const url = `${publicBaseUrl({ requestUrl: input.requestUrl, headers: input.headers })}/api/reference-media/${id}?${params}`
  return { id, url, expiresAt, byteSize: receivedBytes }
}

export async function resolveReferenceUpload(input: {
  id: string
  expiresAt: string | null
  contentType: string | null
  extension: string | null
  token: string | null
}) {
  if (
    !UUID_PATTERN.test(input.id) ||
    !input.expiresAt ||
    !input.contentType ||
    !input.extension ||
    !input.token
  ) {
    throw new ReferenceUploadError("临时媒体地址无效", 403)
  }

  const expiresAt = Number(input.expiresAt)
  if (!Number.isSafeInteger(expiresAt) || expiresAt <= Date.now()) {
    throw new ReferenceUploadError("临时媒体地址已过期", 410)
  }

  const knownType = Object.values(MEDIA_TYPES).some(
    (config) =>
      (config.types as Record<string, string>)[input.contentType as string] ===
      input.extension
  )
  if (!knownType) throw new ReferenceUploadError("临时媒体类型无效", 403)

  const expected = signature({
    id: input.id,
    extension: input.extension,
    contentType: input.contentType,
    expiresAt,
  })
  const expectedBuffer = Buffer.from(expected)
  const receivedBuffer = Buffer.from(input.token)
  if (
    expectedBuffer.length !== receivedBuffer.length ||
    !timingSafeEqual(expectedBuffer, receivedBuffer)
  ) {
    throw new ReferenceUploadError("临时媒体签名无效", 403)
  }

  const path = resolve(
    /* turbopackIgnore: true */ rootDirectory(),
    `${input.id}${input.extension}`
  )
  try {
    const info = await stat(path)
    if (!info.isFile()) throw new Error("not a file")
    return { path, size: info.size, contentType: input.contentType, expiresAt }
  } catch {
    throw new ReferenceUploadError("临时媒体不存在", 404)
  }
}
