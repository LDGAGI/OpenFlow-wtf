"use client"

import { createClientId } from "@/lib/client-id"

import { idbRequest, openLocalDatabase, STORES } from "./db"

export type LocalProject = {
  id: string
  title: string
  createdAt: number
  updatedAt: number
}

export async function listProjects(): Promise<LocalProject[]> {
  const database = await openLocalDatabase()
  const transaction = database.transaction(STORES.projects, "readonly")
  const all = (await idbRequest(
    transaction.objectStore(STORES.projects).getAll()
  )) as LocalProject[]
  return all.sort((left, right) => right.updatedAt - left.updatedAt)
}

export async function getProject(id: string): Promise<LocalProject | null> {
  const database = await openLocalDatabase()
  const transaction = database.transaction(STORES.projects, "readonly")
  const item = (await idbRequest(
    transaction.objectStore(STORES.projects).get(id)
  )) as LocalProject | undefined
  return item ?? null
}

export async function createProject(title: string): Promise<LocalProject> {
  const now = Date.now()
  const project: LocalProject = {
    id: createClientId(),
    title,
    createdAt: now,
    updatedAt: now,
  }
  const database = await openLocalDatabase()
  const transaction = database.transaction(STORES.projects, "readwrite")
  await idbRequest(transaction.objectStore(STORES.projects).put(project))
  return project
}

export async function renameProject(
  id: string,
  title: string
): Promise<LocalProject | null> {
  const existing = await getProject(id)
  if (!existing) return null
  const next: LocalProject = { ...existing, title, updatedAt: Date.now() }
  const database = await openLocalDatabase()
  const transaction = database.transaction(STORES.projects, "readwrite")
  await idbRequest(transaction.objectStore(STORES.projects).put(next))
  return next
}

/** 删除项目，并清理该项目在浏览器中的媒体与对话记录（本机目录文件保留） */
export async function deleteProject(id: string): Promise<void> {
  const database = await openLocalDatabase()

  const projectTx = database.transaction(STORES.projects, "readwrite")
  await idbRequest(projectTx.objectStore(STORES.projects).delete(id))

  for (const storeName of [STORES.media, STORES.chat] as const) {
    const transaction = database.transaction(storeName, "readwrite")
    const store = transaction.objectStore(storeName)
    const all = (await idbRequest(store.getAll())) as {
      id: string
      projectId: string
    }[]
    await Promise.all(
      all
        .filter((item) => item.projectId === id)
        .map((item) => idbRequest(store.delete(item.id)))
    )
  }
}
