"use client"

export async function writeThumbnailCache(key: string, blob: Blob) {
  const root = await navigator.storage.getDirectory()
  const directory = await root.getDirectoryHandle("thumbnails", { create: true })
  const file = await directory.getFileHandle(key, { create: true })
  const writable = await file.createWritable()
  await writable.write(blob)
  await writable.close()
}
