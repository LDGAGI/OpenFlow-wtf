"use client"

import { listMediaIndex, type LocalMediaItem } from "@/lib/local-files/media-index"
import {
  createProject as createLocalProject,
  deleteProject as deleteLocalProject,
  listProjects as listLocalProjects,
  renameProject as renameLocalProject,
  type LocalProject,
} from "@/lib/local-files/project-index"
import type { ProviderCredentials } from "@/lib/providers/types"

export type ProjectItem = {
  id: string
  title: string
  createdAt: string
  updatedAt: string
  userId: string
}

export type MediaPage = {
  items: LocalMediaItem[]
  page: number
  pageSize: number
  total: number
  totalPages: number
  hasPending: boolean
}

export interface WorkspaceBackend {
  listProjects(): Promise<ProjectItem[]>
  createProject(title: string): Promise<ProjectItem>
  renameProject(id: string, title: string): Promise<ProjectItem>
  deleteProject(id: string): Promise<void>
  listMedia(input: { projectId: string; kind: "image" | "video"; page: number; credentials?: ProviderCredentials }): Promise<MediaPage>
}

function toProjectItem(project: LocalProject): ProjectItem {
  return {
    id: project.id,
    title: project.title,
    createdAt: new Date(project.createdAt).toISOString(),
    updatedAt: new Date(project.updatedAt).toISOString(),
    userId: "local",
  }
}

const localBackend: WorkspaceBackend = {
  async listProjects() {
    return (await listLocalProjects()).map(toProjectItem)
  },
  async createProject(title) {
    return toProjectItem(await createLocalProject(title))
  },
  async renameProject(id, title) {
    const project = await renameLocalProject(id, title)
    if (!project) throw new Error("项目不存在")
    return toProjectItem(project)
  },
  async deleteProject(id) {
    await deleteLocalProject(id)
  },
  async listMedia({ projectId, kind, page }) {
    const result = await listMediaIndex({ projectId, kind, page })
    const all = await listMediaIndex({ projectId, kind, page: 1, pageSize: 100000 })
    return {
      ...result,
      page,
      pageSize: 9,
      hasPending: all.items.some((item) => item.status === "running"),
    }
  },
}

export function getBackend(): WorkspaceBackend {
  return localBackend
}
