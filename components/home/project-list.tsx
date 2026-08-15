"use client"

import Link from "next/link"
import { useRouter } from "next/navigation"
import { useEffect, useMemo, useState } from "react"
import { FolderOpen, ImageIcon, Pencil, Plus, Trash2 } from "lucide-react"

import {
  chooseMediaDirectory,
  ensureProjectMediaFolders,
  getSavedMediaDirectory,
  supportsLocalDirectory,
} from "@/lib/local-files/directory"
import { getBackend, type ProjectItem } from "@/lib/workspace/backend"

import { DirectorySetupDialog } from "./directory-setup-dialog"
import { HomeShell } from "./home-shell"
import styles from "./project-list.module.css"

type PendingAction = { type: "open"; projectId: string }

export function ProjectList({ initialProjects, guest = false }: {
  initialProjects: ProjectItem[]
  /** 纯本地模式：项目存浏览器 IndexedDB，不进服务器数据库 */
  guest?: boolean
}) {
  const router = useRouter()
  const backend = useMemo(() => getBackend(), [])
  const [projects, setProjects] = useState(initialProjects)
  const [creating, setCreating] = useState(false)
  const [editor, setEditor] = useState<{ mode: "create" | "rename"; project?: ProjectItem } | null>(null)
  const [projectTitle, setProjectTitle] = useState("")
  const [projectError, setProjectError] = useState("")
  const [pendingAction, setPendingAction] = useState<PendingAction | null>(null)
  const [deleting, setDeleting] = useState<ProjectItem | null>(null)
  const [deleteBusy, setDeleteBusy] = useState(false)
  const [deleteError, setDeleteError] = useState("")
  // 新建项目弹窗内的本机目录选择状态
  const [mediaDirName, setMediaDirName] = useState<string | null>(null)
  const [mediaDirChoosing, setMediaDirChoosing] = useState(false)
  const [mediaDirError, setMediaDirError] = useState("")

  // 纯本地模式：挂载后从 IndexedDB 加载项目列表
  useEffect(() => {
    if (!guest) return
    let cancelled = false
    backend
      .listProjects()
      .then((items) => {
        if (!cancelled) setProjects(items)
      })
      .catch(() => {})
    return () => {
      cancelled = true
    }
  }, [guest, backend])

  function runAction(action: PendingAction) {
    router.push("/projects/" + action.projectId)
  }

  // 前置守卫：打开项目时未连接本机目录先弹授权引导（新建项目在弹窗内直接选择）
  async function ensureDirectory(action: PendingAction) {
    if (!supportsLocalDirectory()) {
      runAction(action)
      return
    }
    const saved = await getSavedMediaDirectory()
    if (saved) runAction(action)
    else setPendingAction(action)
  }

  function openProject(event: React.MouseEvent<HTMLAnchorElement>, projectId: string) {
    event.preventDefault()
    void ensureDirectory({ type: "open", projectId })
  }

  function openCreateProject() {
    setProjectTitle("未命名项目")
    setProjectError("")
    setMediaDirError("")
    setMediaDirName(null)
    setEditor({ mode: "create" })
    // 已连接过目录时直接回显目录名
    if (supportsLocalDirectory()) {
      void getSavedMediaDirectory().then((root) => setMediaDirName(root?.name ?? null))
    }
  }

  /** 新建项目弹窗内选择本机媒体目录；必须在点击手势内直接发起 */
  async function chooseCreateMediaDir() {
    if (mediaDirChoosing) return
    setMediaDirChoosing(true)
    setMediaDirError("")
    try {
      const root = await chooseMediaDirectory()
      setMediaDirName(root.name)
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") {
        setMediaDirError("目录授权失败，请重试")
      }
    } finally {
      setMediaDirChoosing(false)
    }
  }

  function openRenameProject(item: ProjectItem) {
    setProjectTitle(item.title)
    setProjectError("")
    setEditor({ mode: "rename", project: item })
  }

  function openDeleteProject(item: ProjectItem) {
    setDeleteError("")
    setDeleting(item)
  }

  async function confirmDeleteProject() {
    if (!deleting || deleteBusy) return
    setDeleteBusy(true)
    setDeleteError("")
    try {
      await backend.deleteProject(deleting.id)
      setProjects((current) =>
        current.filter((project) => project.id !== deleting.id)
      )
      setDeleting(null)
    } catch (error) {
      setDeleteError(error instanceof Error ? error.message : "删除失败，请重试")
    } finally {
      setDeleteBusy(false)
    }
  }

  async function saveProject(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault()
    const title = projectTitle.trim()
    if (!title) return
    setCreating(true)
    setProjectError("")
    const isCreate = editor?.mode === "create"
    try {
      if (isCreate) {
        const project = await backend.createProject(title)
        // 已连接本机目录时立即创建项目媒体文件夹（images/videos 分组），不阻塞项目创建
        if (supportsLocalDirectory()) {
          try {
            const root = await getSavedMediaDirectory()
            if (root) await ensureProjectMediaFolders(root, project)
          } catch { /* 生成写入时会自动补建 */ }
        }
        setEditor(null)
        router.push("/projects/" + project.id)
      } else if (editor?.project) {
        const project = await backend.renameProject(editor.project.id, title)
        setEditor(null)
        setProjects((current) =>
          current.map((item) =>
            item.id === project.id
              ? { ...item, title: project.title, updatedAt: project.updatedAt }
              : item
          )
        )
      }
    } catch (error) {
      setProjectError(error instanceof Error ? error.message : "无法保存项目")
    } finally {
      setCreating(false)
    }
  }

  return (
    <HomeShell guest={guest}>
      <section className={styles.projectSection}>
        <div className={styles.pageHeader}>
          <span className={styles.eyebrow}>PROJECTS</span>
          <h1>项目</h1>
          <p className={styles.subtitle}>
            {guest
              ? "纯本地模式：项目和生成记录只保存在这台设备的浏览器中。"
              : "选择项目继续创作，或创建一个新项目开始生成。"}
          </p>
        </div>

        <div className={styles.projectGrid}>
          <button className={styles.createCard} onClick={() => openCreateProject()} disabled={creating}>
            <span className={`${styles.thumb} ${styles.createThumb}`}>
              <Plus size={20} />
              <strong>开始创作</strong>
            </span>
            <span className={styles.cardCaption}>创建新项目，从图片或视频生成开始</span>
          </button>
          {projects.map((item) => (
            <article className={styles.projectCard} key={item.id}>
              <Link
                href={`/projects/${item.id}`}
                className={styles.thumb}
                aria-label={`打开项目 ${item.title}`}
                onClick={(event) => openProject(event, item.id)}
              >
                <ImageIcon size={22} />
              </Link>
              <div className={styles.cardMeta}>
                <div className={styles.metaRow}>
                  <Link
                    href={`/projects/${item.id}`}
                    className={styles.cardTitle}
                    onClick={(event) => openProject(event, item.id)}
                  >
                    {item.title}
                  </Link>
                  <div className={styles.cardActions}>
                    <button
                      className={styles.cardEdit}
                      onClick={() => openRenameProject(item)}
                      title="重命名"
                      aria-label={`重命名 ${item.title}`}
                    >
                      <Pencil size={13} />
                    </button>
                    <button
                      className={`${styles.cardEdit} ${styles.cardDelete}`}
                      onClick={() => openDeleteProject(item)}
                      title="删除项目"
                      aria-label={`删除 ${item.title}`}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>

        {deleting ? (
          <div
            className={styles.dialogBackdrop}
            role="presentation"
            onMouseDown={(event) => {
              if (event.currentTarget === event.target && !deleteBusy) setDeleting(null)
            }}
          >
            <section
              className={styles.projectDialog}
              role="dialog"
              aria-modal="true"
              aria-labelledby="delete-dialog-title"
            >
              <div className={styles.deleteDialogBody}>
                <div>
                  <h2 id="delete-dialog-title">删除项目</h2>
                  <p>
                    将删除「{deleting.title}」及其在浏览器中的生成记录；本机目录中的媒体文件会保留，不会删除。
                  </p>
                </div>
                {deleteError ? <p className="error">{deleteError}</p> : null}
                <div className={styles.dialogActions}>
                  <button
                    className="button"
                    type="button"
                    disabled={deleteBusy}
                    onClick={() => setDeleting(null)}
                  >
                    取消
                  </button>
                  <button
                    className={`button ${styles.deleteButton}`}
                    type="button"
                    disabled={deleteBusy}
                    onClick={() => void confirmDeleteProject()}
                  >
                    {deleteBusy ? "删除中…" : "删除项目"}
                  </button>
                </div>
              </div>
            </section>
          </div>
        ) : null}

        {pendingAction ? (
          <DirectorySetupDialog
            onDone={() => {
              const action = pendingAction
              setPendingAction(null)
              runAction(action)
            }}
            onCancel={() => setPendingAction(null)}
          />
        ) : null}

        {editor ? (
          <div
            className={styles.dialogBackdrop}
            role="presentation"
            onMouseDown={(event) => {
              if (event.currentTarget === event.target && !creating) setEditor(null)
            }}
          >
            <section
              className={styles.projectDialog}
              role="dialog"
              aria-modal="true"
              aria-labelledby="project-dialog-title"
            >
              <form onSubmit={saveProject}>
                <div>
                  <h2 id="project-dialog-title">
                    {editor.mode === "create" ? "新建项目" : "重命名项目"}
                  </h2>
                  <p>项目只保存生成记录和链接，媒体仍写入你的本机目录。</p>
                </div>
                <label>
                  <span>项目名称</span>
                  <input
                    className="field"
                    autoFocus
                    value={projectTitle}
                    onChange={(event) => setProjectTitle(event.target.value)}
                    maxLength={80}
                    required
                  />
                </label>
                {editor.mode === "create" ? (
                  <div className={styles.dirPicker}>
                    {supportsLocalDirectory() ? (
                      mediaDirName ? (
                        <div className={styles.dirConnected}>
                          <FolderOpen size={14} />
                          <span title={mediaDirName}>媒体将保存到「{mediaDirName}」</span>
                          <button
                            className={styles.dirButton}
                            type="button"
                            disabled={mediaDirChoosing}
                            onClick={() => void chooseCreateMediaDir()}
                          >
                            更换
                          </button>
                        </div>
                      ) : (
                        <div className={styles.dirPrompt}>
                          <p>选择一个本机目录，生成的图片/视频会按项目自动归档保存；也可以跳过，之后在工作台随时连接。</p>
                          {mediaDirError ? <p className="error">{mediaDirError}</p> : null}
                          <button
                            className="button"
                            type="button"
                            disabled={mediaDirChoosing}
                            onClick={() => void chooseCreateMediaDir()}
                          >
                            <FolderOpen size={13} />
                            {mediaDirChoosing ? "等待授权…" : "选择本机目录"}
                          </button>
                        </div>
                      )
                    ) : (
                      <p className={styles.dirUnsupported}>当前浏览器不支持本机目录访问，生成媒体仅保留远程链接。</p>
                    )}
                  </div>
                ) : null}
                {projectError ? <p className="error">{projectError}</p> : null}
                <div className={styles.dialogActions}>
                  <button className="button" type="button" disabled={creating} onClick={() => setEditor(null)}>
                    取消
                  </button>
                  <button
                    className="button button-primary"
                    disabled={creating || !projectTitle.trim()}
                  >
                    {creating ? "保存中" : editor.mode === "create" ? "创建并打开" : "保存名称"}
                  </button>
                </div>
              </form>
            </section>
          </div>
        ) : null}
      </section>
    </HomeShell>
  )
}
