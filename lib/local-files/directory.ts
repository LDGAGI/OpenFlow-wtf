"use client"

import { idbRequest, openLocalDatabase, STORES } from "./db"

const DIRECTORY_KEY = "media-root"

export function supportsLocalDirectory() {
  return typeof window !== "undefined" && "showDirectoryPicker" in window
}

export async function chooseMediaDirectory() {
  const root = await window.showDirectoryPicker({ mode: "readwrite" })
  const database = await openLocalDatabase()
  const transaction = database.transaction(STORES.settings, "readwrite")
  await idbRequest(
    transaction.objectStore(STORES.settings).put(root, DIRECTORY_KEY)
  )
  return root
}

export async function getSavedMediaDirectory(requestPermission = false) {
  const database = await openLocalDatabase()
  const transaction = database.transaction(STORES.settings, "readonly")
  const root = (await idbRequest(
    transaction.objectStore(STORES.settings).get(DIRECTORY_KEY)
  )) as FileSystemDirectoryHandle | undefined
  if (!root) return null
  let permission = await root.queryPermission({ mode: "readwrite" })
  if (permission !== "granted" && requestPermission) {
    permission = await root.requestPermission({ mode: "readwrite" })
  }
  return permission === "granted" ? root : null
}

const ILLEGAL_NAME_CHARS = /[\\/:*?"<>|]/g

/**
 * 项目文件夹名：净化标题 + 项目 id 前 8 位。
 * 防重名、防特殊字符；项目改名不联动改文件夹名。
 */
export function projectFolderName(title: string, projectId: string) {
  const base =
    title.replace(ILLEGAL_NAME_CHARS, " ").trim().replace(/\s+/g, " ").slice(0, 40) ||
    "未命名项目"
  return `${base}-${projectId.slice(0, 8)}`
}

/** 获取（必要时创建）项目的媒体目录结构：项目文件夹/images|videos */
export async function ensureProjectMediaFolders(
  root: FileSystemDirectoryHandle,
  project: { id: string; title: string }
) {
  const folderName = projectFolderName(project.title, project.id)
  const dir = await root.getDirectoryHandle(folderName, { create: true })
  const [images, videos] = await Promise.all([
    dir.getDirectoryHandle("images", { create: true }),
    dir.getDirectoryHandle("videos", { create: true }),
  ])
  return { folderName, dir, images, videos }
}
