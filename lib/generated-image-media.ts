import { mkdir, readFile, stat, writeFile } from "node:fs/promises"
import { resolve } from "node:path"

const INTERNAL_PREFIX = "flowcut-image:"
const INTERNAL_PATTERN = /^[0-9a-f-]+\.(?:png|jpg|webp)$/i

function rootDirectory() {
  return resolve(
    /* turbopackIgnore: true */
    process.cwd(),
    process.env.GENERATED_MEDIA_DIR ?? "./data/generated-media"
  )
}

function dataImage(value: string) {
  const match = /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/=]+)$/.exec(value)
  if (!match) return null
  const extension = match[1] === "image/jpeg" ? "jpg" : match[1].split("/")[1]
  return { contentType: match[1], extension, bytes: Buffer.from(match[2], "base64") }
}

export async function persistGeneratedImage(generationId: string, remoteUrl: string) {
  const image = dataImage(remoteUrl)
  if (!image) return remoteUrl
  if (!image.bytes.length) throw new Error("图片供应商返回了空图片")

  const fileName = `${generationId}.${image.extension}`
  await mkdir(rootDirectory(), { recursive: true })
  try {
    await writeFile(resolve(/* turbopackIgnore: true */ rootDirectory(), fileName), image.bytes, { flag: "wx" })
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "EEXIST")) throw error
  }
  return `${INTERNAL_PREFIX}${fileName}`
}

export async function readGeneratedImage(value: string) {
  if (!value.startsWith(INTERNAL_PREFIX)) return null
  const fileName = value.slice(INTERNAL_PREFIX.length)
  if (!INTERNAL_PATTERN.test(fileName)) return null
  const path = resolve(/* turbopackIgnore: true */ rootDirectory(), fileName)
  const info = await stat(path)
  if (!info.isFile()) return null
  const contentType = fileName.endsWith(".jpg")
    ? "image/jpeg"
    : fileName.endsWith(".webp") ? "image/webp" : "image/png"
  return { bytes: await readFile(path), contentType, size: info.size }
}
