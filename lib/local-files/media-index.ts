"use client"

import { idbRequest, openLocalDatabase, STORES } from "./db"

export type ImageGenerationSnapshot = {
  prompt: string
  model: {
    source: "byok"
    model: string
    connectionId?: string
    label?: string
  }
  ratio: string
  resolution: "1K" | "2K" | "4K"
  quality: "low" | "medium" | "high"
  background: "auto" | "opaque" | "transparent"
  outputFormat: "png" | "jpeg" | "webp"
  compression: number
  references: {
    name: string
    localMediaKey: string
    thumbnailKey?: string
  }[]
  createdAt: number
}

export type LocalMediaItem = {
  id: string
  projectId: string
  kind: "image" | "video"
  prompt: string
  modelKey: string
  remoteUrl: string
  localFileName: string | null
  /** 浏览器 OPFS 中的原始媒体键；持久化后不再依赖供应商临时链接。 */
  localMediaKey?: string
  /** 浏览器 OPFS 中的轻量缩略图键，仅用于历史列表。 */
  thumbnailKey?: string
  createdAt: number
  /** 本地生成任务状态。 */
  status?: "queued" | "submitting" | "running" | "saving" | "succeeded" | "failed"
  /** 异步任务的供应商任务 id，用于状态对账。 */
  providerTaskId?: string
  /** 图片任务由哪个上游入口创建，决定轮询 generations 还是 edits。 */
  providerOperation?: "image_generation" | "image_edit" | "video"
  /** 创建任务时使用的本地 API 连接，避免切换渠道后用错凭证轮询。 */
  providerConnectionId?: string
  errorMessage?: string
  /** 图片任务提交时的不可变参数快照，用于详情与复用。 */
  requestSnapshot?: ImageGenerationSnapshot
  /** 仅存在于当前页面内的待处理参考图预览，不写入最终历史。 */
  transientReferencePreviews?: { name: string; url: string }[]
}

export function isServerManagedMedia(value: string) {
  return value.startsWith("flowcut-image:")
}

export async function saveMediaIndex(item: LocalMediaItem) {
  const database = await openLocalDatabase()
  const transaction = database.transaction(STORES.media, "readwrite")
  await idbRequest(transaction.objectStore(STORES.media).put(item))
}

export async function ensureMediaIndex(item: LocalMediaItem) {
  const database = await openLocalDatabase()
  const transaction = database.transaction(STORES.media, "readwrite")
  const store = transaction.objectStore(STORES.media)
  const existing = (await idbRequest(
    store.get(item.id)
  )) as LocalMediaItem | undefined
  if (!existing) {
    await idbRequest(store.put(item))
    return
  }
  // 服务端成功状态是权威结果，但保留浏览器中已经缓存的原图、缩略图和参数快照。
  await idbRequest(store.put({
    ...item,
    ...existing,
    requestSnapshot: existing.requestSnapshot ?? item.requestSnapshot,
    status: item.status ?? existing.status,
    remoteUrl: existing.localMediaKey ? existing.remoteUrl : item.remoteUrl,
  }))
}

export async function listMediaIndex(input: {
  projectId: string
  kind: LocalMediaItem["kind"]
  page: number
  pageSize?: number
}) {
  const database = await openLocalDatabase()
  const transaction = database.transaction(STORES.media, "readonly")
  const all = (await idbRequest(
    transaction.objectStore(STORES.media).getAll()
  )) as LocalMediaItem[]
  const repaired = all.map((item) => item.status === "saving" && (item.localMediaKey || item.remoteUrl)
    ? { ...item, status: "succeeded" as const }
    : item)
  const stale = repaired.filter((item, index) => item !== all[index])
  if (stale.length) {
    const repairTransaction = database.transaction(STORES.media, "readwrite")
    const repairStore = repairTransaction.objectStore(STORES.media)
    await Promise.all(stale.map((item) => idbRequest(repairStore.put(item))))
  }
  const filtered = repaired
    .filter(
      (item) => item.projectId === input.projectId && item.kind === input.kind
    )
    .sort((left, right) => right.createdAt - left.createdAt)
  const pageSize = input.pageSize ?? 9
  const offset = (input.page - 1) * pageSize
  return {
    items: filtered.slice(offset, offset + pageSize),
    total: filtered.length,
    totalPages: Math.max(1, Math.ceil(filtered.length / pageSize)),
  }
}
