import { createClientId } from "@/lib/client-id"

export type StoredSkillFile = {
  path: string
  type: string
  size: number
  content: Blob
}

export type StoredSkill = {
  id: string
  version: string
  name: string
  description: string
  instructions: string
  files: StoredSkillFile[]
  installedAt: number
}

const MAX_FILES = 500
const MAX_TOTAL_BYTES = 100 * 1024 * 1024

function frontmatter(markdown: string) {
  if (!markdown.startsWith("---")) return new Map<string, string>()
  const end = markdown.indexOf("\n---", 3)
  if (end === -1) return new Map<string, string>()
  const entries = markdown.slice(3, end).split("\n").flatMap((line) => {
    const separator = line.indexOf(":")
    if (separator === -1) return []
    const key = line.slice(0, separator).trim()
    const value = line.slice(separator + 1).trim().replace(/^['"]|['"]$/g, "")
    return key ? [[key, value] as const] : []
  })
  return new Map(entries)
}

function skillId(value: string) {
  const normalized = value.toLowerCase().trim().replace(/[^a-z0-9._-]+/g, "-").replace(/^-+|-+$/g, "")
  return normalized || createClientId()
}

export async function packageFromFolder(files: FileList | File[]): Promise<StoredSkill> {
  const selected = [...files]
  if (!selected.length) throw new Error("请选择 Skill 文件夹")
  if (selected.length > MAX_FILES) throw new Error(`Skill 文件不能超过 ${MAX_FILES} 个`)
  const totalBytes = selected.reduce((sum, file) => sum + file.size, 0)
  if (totalBytes > MAX_TOTAL_BYTES) throw new Error("Skill 文件夹不能超过 100 MB")

  const firstPath = selected[0]?.webkitRelativePath || selected[0]?.name || ""
  const root = firstPath.includes("/") ? firstPath.split("/")[0]! : ""
  const relativePath = (file: File) => {
    const path = file.webkitRelativePath || file.name
    return root && path.startsWith(`${root}/`) ? path.slice(root.length + 1) : path
  }
  const entry = selected.find((file) => relativePath(file) === "SKILL.md")
  if (!entry) throw new Error("文件夹根目录缺少 SKILL.md")
  const instructions = await entry.text()
  const metadata = frontmatter(instructions)
  const folderName = root || "local-skill"
  const name = metadata.get("name") || folderName
  return {
    id: skillId(metadata.get("id") || name || folderName),
    version: metadata.get("version") || "local",
    name,
    description: metadata.get("description") || "本地导入的 Skill",
    instructions,
    files: selected.map((file) => ({
      path: relativePath(file),
      type: file.type || "application/octet-stream",
      size: file.size,
      content: file.slice(0, file.size, file.type),
    })),
    installedAt: Date.now(),
  }
}
