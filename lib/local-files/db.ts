"use client"

const DB_NAME = "openflow"
// v4：增加本地 Skill 包存储；升级时保留已有项目、媒体和对话数据。
const DB_VERSION = 4

export const STORES = {
  settings: "settings",
  media: "media",
  chat: "chat",
  projects: "projects",
  skills: "skills",
} as const

export function openLocalDatabase(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION)
    request.onupgradeneeded = () => {
      const database = request.result
      if (!database.objectStoreNames.contains(STORES.settings)) {
        database.createObjectStore(STORES.settings)
      }
      if (!database.objectStoreNames.contains(STORES.media)) {
        const media = database.createObjectStore(STORES.media, { keyPath: "id" })
        media.createIndex("project_kind_created", [
          "projectId",
          "kind",
          "createdAt",
        ])
      }
      if (!database.objectStoreNames.contains(STORES.chat)) {
        const chat = database.createObjectStore(STORES.chat, { keyPath: "id" })
        chat.createIndex("project_created", ["projectId", "createdAt"])
      }
      if (!database.objectStoreNames.contains(STORES.projects)) {
        database.createObjectStore(STORES.projects, { keyPath: "id" })
      }
      if (!database.objectStoreNames.contains(STORES.skills)) {
        database.createObjectStore(STORES.skills, { keyPath: "id" })
      }
    }
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}

export async function idbRequest<T>(request: IDBRequest<T>): Promise<T> {
  return await new Promise((resolve, reject) => {
    request.onsuccess = () => resolve(request.result)
    request.onerror = () => reject(request.error)
  })
}
