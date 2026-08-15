import type { StoredSkill, StoredSkillFile } from "./types"

export const MAX_SKILL_FILE_BYTES = 200 * 1024
export const MAX_SKILL_READ_BYTES = 1024 * 1024
export const MAX_SKILL_READS = 20

const TEXT_EXTENSIONS = new Set(["md", "txt", "json", "yaml", "yml", "csv"])

export type SkillFileManifestItem = Pick<StoredSkillFile, "path" | "type" | "size">

export function isSafeSkillPath(path: string) {
  if (!path || path.startsWith("/") || path.startsWith("\\") || /^[a-z]:/i.test(path)) return false
  const parts = path.replaceAll("\\", "/").split("/")
  return parts.every((part) => Boolean(part) && part !== "." && part !== "..")
}

export function isReadableSkillFile(file: SkillFileManifestItem) {
  const extension = file.path.toLowerCase().split(".").pop() ?? ""
  return isSafeSkillPath(file.path) && TEXT_EXTENSIONS.has(extension)
}

export function skillFileManifest(skill: Pick<StoredSkill, "files">): SkillFileManifestItem[] {
  return skill.files
    .filter((file) => file.path !== "SKILL.md" && isReadableSkillFile(file))
    .map(({ path, type, size }) => ({ path, type, size }))
}

export function skillReferenceFileCount(skill: Pick<StoredSkill, "files">) {
  return skillFileManifest(skill).length
}

export async function readSkillTextFile(
  skill: Pick<StoredSkill, "files">,
  requestedPath: string
): Promise<{ path: string; content: string; bytes: number }> {
  const path = requestedPath.trim().replaceAll("\\", "/")
  if (!isSafeSkillPath(path)) throw new Error("文件路径不合法")
  const file = skill.files.find((item) => item.path === path)
  if (!file) throw new Error("Skill 中不存在该文件")
  if (!isReadableSkillFile(file)) throw new Error("该文件类型暂不支持读取")
  if (file.size > MAX_SKILL_FILE_BYTES) throw new Error("单个参考文件不能超过 200 KB")
  return { path, content: await file.content.text(), bytes: file.size }
}
