"use client"

import { idbRequest, openLocalDatabase, STORES } from "./db"
import type { ImageGenerationApproval } from "@/lib/chat-image-tools"

export type LocalChatMessage = {
  id: string
  projectId: string
  role: "user" | "assistant"
  content: string
  /** 附带图片（data URL），按发送顺序排列 */
  images?: string[]
  reasoning?: string
  reasoningSeconds?: number
  reasoningStatus?: "streaming" | "completed"
  responseStatus?: "streaming" | "completed" | "failed" | "stopped"
  completedAt?: number
  trace?: Array<{
    id: string
    label: string
    detail?: string
    status: "running" | "completed" | "failed"
    createdAt: number
  }>
  tool?: {
    name: "generate_image" | "propose_image_generation" | "read_skill_file"
    status: "running" | "completed" | "failed"
    label: string
    detail?: string
    generationId?: string
  }
  imageApproval?: ImageGenerationApproval
  createdAt: number
}

export async function saveChatMessage(message: LocalChatMessage) {
  const database = await openLocalDatabase()
  const transaction = database.transaction(STORES.chat, "readwrite")
  await idbRequest(transaction.objectStore(STORES.chat).put(message))
}

export async function listChatMessages(projectId: string) {
  const database = await openLocalDatabase()
  const transaction = database.transaction(STORES.chat, "readonly")
  const all = (await idbRequest(
    transaction.objectStore(STORES.chat).getAll()
  )) as LocalChatMessage[]
  return all
    .filter((message) => message.projectId === projectId)
    .sort((left, right) => left.createdAt - right.createdAt)
}

export async function clearChatMessages(projectId: string) {
  const database = await openLocalDatabase()
  const transaction = database.transaction(STORES.chat, "readwrite")
  const store = transaction.objectStore(STORES.chat)
  const all = (await idbRequest(store.getAll())) as LocalChatMessage[]
  await Promise.all(
    all
      .filter((message) => message.projectId === projectId)
      .map((message) => idbRequest(store.delete(message.id)))
  )
}
