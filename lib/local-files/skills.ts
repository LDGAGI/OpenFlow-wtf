import { idbRequest, openLocalDatabase, STORES } from "./db"
import type { StoredSkill } from "@/lib/skills/types"

export async function listLocalSkills(): Promise<StoredSkill[]> {
  const database = await openLocalDatabase()
  const transaction = database.transaction(STORES.skills, "readonly")
  const items = await idbRequest(transaction.objectStore(STORES.skills).getAll()) as StoredSkill[]
  return items.sort((a, b) => b.installedAt - a.installedAt)
}

export async function saveLocalSkill(skill: StoredSkill) {
  const database = await openLocalDatabase()
  const transaction = database.transaction(STORES.skills, "readwrite")
  await idbRequest(transaction.objectStore(STORES.skills).put(skill))
}

export async function deleteLocalSkill(id: string) {
  const database = await openLocalDatabase()
  const transaction = database.transaction(STORES.skills, "readwrite")
  await idbRequest(transaction.objectStore(STORES.skills).delete(id))
}
