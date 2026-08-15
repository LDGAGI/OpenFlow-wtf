"use client"

import { ensureProjectMediaFolders, getSavedMediaDirectory } from "./directory"

function extension(contentType: string | null, kind: "image" | "video") {
  if (contentType?.includes("png")) return "png"
  if (contentType?.includes("webp")) return "webp"
  if (contentType?.includes("webm")) return "webm"
  return kind === "image" ? "jpg" : "mp4"
}

/** 把响应流写入本机：媒体根目录/项目文件夹/images|videos/，返回相对根目录的路径 */
async function writeStreamToProjectFolder(input: {
  id: string
  kind: "image" | "video"
  project: { id: string; title: string }
  body: ReadableStream
  contentType: string | null
}) {
  const root = await getSavedMediaDirectory(true)
  if (!root) return null
  const folders = await ensureProjectMediaFolders(root, input.project)
  const kindFolder = input.kind === "image" ? "images" : "videos"
  const folder = input.kind === "image" ? folders.images : folders.videos
  const fileName = `${input.id}.${extension(input.contentType, input.kind)}`
  const handle = await folder.getFileHandle(fileName, { create: true })
  const writable = await handle.createWritable()
  await input.body.pipeTo(writable)
  return `${folders.folderName}/${kindFolder}/${fileName}`
}

/**
 * 纯本地模式：经 /api/local/media 转发用户自己端点上的媒体并写入本机。
 * base/key 用于供应商需要鉴权的下载地址。
 */
export async function writeRemoteMediaFromUrl(input: {
  id: string
  kind: "image" | "video"
  project: { id: string; title: string }
  url: string
  base?: string
  key?: string
}) {
  const root = await getSavedMediaDirectory(true)
  if (!root) return null
  let response: Response | null = null
  try {
    response = await fetch(input.url, {
      cache: "no-store",
      ...(input.base && input.key && new URL(input.base).origin === new URL(input.url).origin
        ? { headers: { Authorization: `Bearer ${input.key}` } }
        : {}),
    })
  } catch {
    // 源站未开放 CORS 时回退同源代理。
  }
  if ((!response || !response.ok || !response.body) && !input.url.startsWith("data:")) {
    response = await fetch("/api/local/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: input.url,
          ...(input.base && input.key
            ? { credentials: { baseUrl: input.base, apiKey: input.key } }
            : {}),
        }),
      })
  }
  if (!response?.ok || !response.body) throw new Error("无法下载生成结果")
  const directResponse = response
  const responseBody = response.body
  return writeStreamToProjectFolder({
    id: input.id,
    kind: input.kind,
    project: input.project,
    body: responseBody,
    contentType: directResponse.headers.get("content-type"),
  })
}

/** 用户主动保存时把 OPFS 中的原始 File 流式写入本机，避免再次下载。 */
export async function writeCachedMedia(input: {
  id: string
  kind: "image" | "video"
  project: { id: string; title: string }
  blob: Blob
}) {
  return writeStreamToProjectFolder({
    id: input.id,
    kind: input.kind,
    project: input.project,
    body: input.blob.stream(),
    contentType: input.blob.type,
  })
}
