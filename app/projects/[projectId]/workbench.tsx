"use client"

import Link from "next/link"
import { useCallback, useEffect, useMemo, useRef, useState } from "react"
import { ImageIcon, Settings, Video } from "lucide-react"

import { createClientId } from "@/lib/client-id"
import { imageModelLabel, imageModelResolution } from "@/lib/image-model-families"
import { chooseMediaDirectory, getSavedMediaDirectory, supportsLocalDirectory } from "@/lib/local-files/directory"
import { listMediaIndex, saveMediaIndex, type ImageGenerationSnapshot, type LocalMediaItem } from "@/lib/local-files/media-index"
import { createStoredImageThumbnail, persistOriginalMedia, persistReferenceMedia, readStoredMedia } from "@/lib/local-files/opfs-media"
import { writeCachedMedia, writeRemoteMediaFromUrl } from "@/lib/local-files/media-writer"
import { getProject } from "@/lib/local-files/project-index"
import {
  activateProviderModel,
  loadModelChannel,
  loadProviderSettings,
  saveModelChannel,
  saveProviderSettings,
  type ModelChannel,
  type ModelOption,
  type ProviderSettings,
} from "@/lib/provider-settings"
import {
  inferModelProfile,
  isProviderModelListed,
  modelCapabilities,
  resolveModelCapabilities,
  resolveVideoModelCapabilities,
} from "@/lib/provider-models"
import type { VideoModel } from "@/lib/providers/types"
import { validateVideoRequestPolicy } from "@/lib/video-request-policy"
import { getBackend } from "@/lib/workspace/backend"
import { resolveEffectiveChannel, type EffectiveChannel } from "@/lib/workspace/channel-routing"
import type { ChatImageGenerationRequest, ChatImageToolContext } from "@/lib/chat-image-tools"
import { ProviderSettingsDialog } from "@/components/home/provider-settings-dialog"

import { ChatPanel } from "./chat-panel"
import { Composer } from "./composer"
import { buildPromptReferences } from "./prompt-editor"
import { MediaSidebar } from "./media-sidebar"
import { MediaDetails } from "./media-details"
import { ImageReferenceControls, type ImageReferenceControlsHandle } from "./image-reference-controls"
import { PreviewStage } from "./preview-stage"
import {
  VideoReferenceControls,
  type VideoReferenceControlsHandle,
  type VideoMode,
} from "./video-reference-controls"
import type { ReferenceUploadItem } from "./reference-upload-types"
import {
  VideoToolbarControls,
  type VideoRatio,
} from "./video-toolbar-controls"
import {
  IMAGE_SIZES,
  type ImageQuality,
  type ImageRatio,
  type ImageTask,
  type Kind,
  type MediaPage,
} from "./workbench-types"
import styles from "./workbench.module.css"

const EMPTY_PAGE: MediaPage = { items: [], total: 0, totalPages: 1 }

const DEFAULT_IMAGE_MODEL = "gpt-image-2"

type Channel = EffectiveChannel
const currentTimestamp = () => new Date().getTime()
type SubmittedImageRequest = { snapshot: ImageGenerationSnapshot; providerReferenceUrls: string[] }

function terminalFromProviderStatus(status: string): "succeeded" | "failed" | null {
  const value = status.toLowerCase()
  if (["completed", "succeeded", "success"].includes(value)) return "succeeded"
  if (["failed", "error", "cancelled", "canceled"].includes(value)) return "failed"
  return null
}

export function Workbench({
  project,
  guest = false,
}: {
  project: { id: string; title: string }
  /** 纯本地模式：数据只存浏览器 IndexedDB + 本地目录，生成必须走自有 API */
  guest?: boolean
}) {
  const [kind, setKind] = useState<Kind>("image")
  const [prompt, setPrompt] = useState("")
  const [ratio, setRatio] = useState<ImageRatio>("16:9")
  const [quality, setQuality] = useState<ImageQuality>("medium")
  const [imageResolution, setImageResolution] = useState<"1K" | "2K" | "4K">("1K")
  const [imageBackground, setImageBackground] = useState<"auto" | "opaque" | "transparent">("opaque")
  const [imageOutputFormat, setImageOutputFormat] = useState<"png" | "jpeg" | "webp">("png")
  const [imageCompression, setImageCompression] = useState(90)
  const [imageModel, setImageModel] = useState<string>(DEFAULT_IMAGE_MODEL)
  const [videoRatio, setVideoRatio] = useState<VideoRatio>("16:9")
  const [videoModel] = useState<VideoModel>("seedance-2.0")
  const [duration, setDuration] = useState("5")
  const [resolution, setResolution] = useState<"480p" | "720p">("720p")
  const [generateAudio, setGenerateAudio] = useState(true)
  const [videoMode, setVideoMode] = useState<VideoMode>("media")
  const [firstFrame, setFirstFrame] = useState<ReferenceUploadItem | null>(null)
  const [lastFrame, setLastFrame] = useState<ReferenceUploadItem | null>(null)
  const [references, setReferences] = useState<ReferenceUploadItem[]>([])
  const [imageReferences, setImageReferences] = useState<ReferenceUploadItem[]>([])
  const imageReferenceControlsRef = useRef<ImageReferenceControlsHandle>(null)
  const videoReferenceControlsRef = useRef<VideoReferenceControlsHandle>(null)
  const migratingMediaRef = useRef(new Set<string>())
  const mediaPersistenceTasksRef = useRef(new Map<string, Promise<LocalMediaItem>>())
  const [status, setStatus] = useState("准备就绪")
  const [generating, setGenerating] = useState(false)
  const [selected, setSelected] = useState<LocalMediaItem | null>(null)
  const [imageTasks, setImageTasks] = useState<ImageTask[]>([])
  const [activeImageTaskId, setActiveImageTaskId] = useState<string | null>(null)
  const [detailsOpen, setDetailsOpen] = useState(false)
  const [reuseNotice, setReuseNotice] = useState("")
  const undoSnapshotRef = useRef<{
    prompt: string
    ratio: ImageRatio
    quality: ImageQuality
    imageResolution: "1K" | "2K" | "4K"
    imageBackground: "auto" | "opaque" | "transparent"
    imageOutputFormat: "png" | "jpeg" | "webp"
    imageCompression: number
    imageModel: string
    imageReferenceFiles: File[]
  } | null>(null)
  const [directoryState, setDirectoryState] = useState<"unsupported" | "disconnected" | "connected">("disconnected")
  const [imagePage, setImagePage] = useState(1)
  const [videoPage, setVideoPage] = useState(1)
  const [images, setImages] = useState<MediaPage>(EMPTY_PAGE)
  const [videos, setVideos] = useState<MediaPage>(EMPTY_PAGE)
  const [hasPendingImages, setHasPendingImages] = useState(false)
  const [hasPendingVideos, setHasPendingVideos] = useState(false)
  // 纯本地模式：项目在 IndexedDB 中，挂载后解析标题
  const [resolvedTitle, setResolvedTitle] = useState(project.title)
  const [projectMissing, setProjectMissing] = useState(false)
  const [imageSettings, setImageSettings] = useState<ProviderSettings | null>(null)
  const [videoSettings, setVideoSettings] = useState<ProviderSettings | null>(null)
  const [channelByKind, setChannelByKind] = useState<Record<Kind, ModelChannel>>({
    image: "byok",
    video: "byok",
  })
  const [settingsVersion, setSettingsVersion] = useState(0)
  const [settingsDialog, setSettingsDialog] = useState<"image" | "video" | null>(null)
  const backend = useMemo(() => getBackend(), [])

  const updateImageTask = useCallback((clientId: string, update: (item: LocalMediaItem) => LocalMediaItem) => {
    setImageTasks((current) => current.map((task) =>
      task.clientId === clientId ? { ...task, item: update(task.item) } : task
    ))
  }, [])

  const publishCompletedImage = useCallback(async (item: LocalMediaItem) => {
    const completed = { ...item, status: "succeeded" as const }
    await saveMediaIndex(completed)
    setImages((current) => {
      const existingIndex = current.items.findIndex((candidate) => candidate.id === completed.id)
      if (existingIndex >= 0) {
        return {
          ...current,
          items: current.items.map((candidate) => candidate.id === completed.id ? completed : candidate),
        }
      }
      if (imagePage !== 1) return current
      return {
        ...current,
        items: [completed, ...current.items].slice(0, 9),
        total: current.total + 1,
        totalPages: Math.max(1, Math.ceil((current.total + 1) / 9)),
      }
    })
    return completed
  }, [imagePage])

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setImageSettings(loadProviderSettings("image"))
      setVideoSettings(loadProviderSettings("video"))
      setChannelByKind({
        image: loadModelChannel("image") ?? "byok",
        video: loadModelChannel("video") ?? "byok",
      })
    }, 0)
    return () => window.clearTimeout(timer)
  }, [settingsVersion])

  useEffect(() => {
    if (!guest) return
    let cancelled = false
    void getProject(project.id).then((item) => {
      if (cancelled) return
      if (item) setResolvedTitle(item.title)
      else setProjectMissing(true)
    })
    return () => {
      cancelled = true
    }
  }, [guest, project.id])

  const persistMediaItem = useCallback(async (
    item: LocalMediaItem,
    connection?: { baseUrl: string; apiKey: string }
  ) => {
    const existing = mediaPersistenceTasksRef.current.get(item.id)
    if (existing) return existing

    const task = (async () => {
      let response: Response
      if (item.remoteUrl.startsWith("data:")) {
        response = await fetch(item.remoteUrl)
      } else {
        try {
          response = await fetch(item.remoteUrl, {
            cache: "no-store",
            ...(connection && new URL(connection.baseUrl).origin === new URL(item.remoteUrl).origin
              ? { headers: { Authorization: `Bearer ${connection.apiKey}` } }
              : {}),
          })
        } catch {
          response = await fetch("/api/local/media", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: item.remoteUrl, ...(connection ? { credentials: connection } : {}) }),
          })
        }
        if (!response.ok || !response.body) {
          response = await fetch("/api/local/media", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ url: item.remoteUrl, ...(connection ? { credentials: connection } : {}) }),
          })
        }
      }
      if (!response.ok || !response.body) throw new Error("原图保存失败，临时链接可能已失效")
      const localMediaKey = await persistOriginalMedia({ id: item.id, kind: item.kind, response })
      let thumbnailKey: string | undefined
      if (item.kind === "image") {
        try {
          thumbnailKey = await createStoredImageThumbnail(item.id, localMediaKey)
        } catch {
          // 原图已经安全写入，缩略图失败不影响历史资产。
        }
      }
      const stored: LocalMediaItem = { ...item, remoteUrl: "", localMediaKey, thumbnailKey, status: "succeeded" }
      await saveMediaIndex(stored)
      setSelected((current) => current?.id === stored.id ? stored : current)
      return stored
    })().finally(() => {
      mediaPersistenceTasksRef.current.delete(item.id)
    })
    mediaPersistenceTasksRef.current.set(item.id, task)
    return task
  }, [])

  async function persistReferenceSnapshot(items: ReferenceUploadItem[]) {
    return Promise.all(items.filter((item) => item.kind === "image").map(async (item) => {
      const localMediaKey = await persistReferenceMedia(item.id, item.file)
      let thumbnailKey: string | undefined
      try { thumbnailKey = await createStoredImageThumbnail(`reference-${item.id}`, localMediaKey) } catch { /* 原参考图仍可恢复 */ }
      return { name: item.name, localMediaKey, ...(thumbnailKey ? { thumbnailKey } : {}) }
    }))
  }

  async function imageSnapshot(input: { prompt: string; model: ModelOption; references: ReferenceUploadItem[]; ratio?: ImageRatio; resolution?: "1K" | "2K" | "4K"; quality?: ImageQuality; background?: "auto" | "opaque" | "transparent"; outputFormat?: "png" | "jpeg" | "webp" }): Promise<ImageGenerationSnapshot> {
    const fixedResolution = imageModelResolution(input.model.model)
    return {
      prompt: input.prompt,
      model: {
        source: input.model.source,
        model: input.model.model,
        ...(input.model.connectionId ? { connectionId: input.model.connectionId } : {}),
        ...(input.model.label ? { label: input.model.label } : {}),
      },
      ratio: input.ratio ?? ratio,
      resolution: fixedResolution ?? input.resolution ?? imageResolution,
      quality: input.quality ?? quality,
      background: input.background ?? imageBackground,
      outputFormat: input.outputFormat ?? imageOutputFormat,
      compression: imageCompression,
      references: await persistReferenceSnapshot(input.references),
      createdAt: currentTimestamp(),
    }
  }

  // 纯本地模式：对账 IndexedDB 里进行中的图片/视频任务。
  const reconcileGuestTasks = useCallback(async (target: Kind) => {
    const settings = loadProviderSettings(target)
    if (!settings) return
    const all = await listMediaIndex({ projectId: project.id, kind: target, page: 1, pageSize: 100000 })
    const running = all.items.filter((item) => item.status === "running" && item.providerTaskId)
    await Promise.allSettled(
      running.map(async (item) => {
        const connection = settings.connections?.find((candidate) =>
          candidate.id === item.providerConnectionId
        ) ?? settings.connections?.find((candidate) =>
          candidate.models.some((binding) => binding.id === item.modelKey)
        )
        const binding = connection?.models.find((candidate) => candidate.id === item.modelKey)
        if (!connection || !binding) return
        const response = await fetch(target === "image" ? "/api/local/images/status" : "/api/local/videos/status", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            credentials: {
              baseUrl: connection.baseUrl,
              apiKey: connection.apiKey,
              adapter: binding.adapter,
              capabilityProfile: binding.capabilityProfile,
              paths: connection.paths,
            },
            providerTaskId: item.providerTaskId,
            ...(target === "image" ? {
              model: item.modelKey,
              providerOperation: item.providerOperation ?? "image_generation",
            } : {}),
          }),
        })
        if (!response.ok) return
        const data = (await response.json()) as { status: string; remoteUrl?: string; error?: string }
        const terminal = terminalFromProviderStatus(data.status)
        if (terminal === "succeeded" && data.remoteUrl) {
          await persistMediaItem(
            { ...item, status: "succeeded", remoteUrl: data.remoteUrl },
            { baseUrl: connection.baseUrl, apiKey: connection.apiKey }
          )
        } else if (terminal === "succeeded") {
          await saveMediaIndex({ ...item, status: "failed", errorMessage: `供应商已完成任务，但未返回${target === "image" ? "图片" : "视频"}地址` })
        } else if (terminal === "failed") {
          await saveMediaIndex({ ...item, status: "failed", errorMessage: data.error ?? `${target === "image" ? "图片" : "视频"}生成失败` })
        }
      })
    )
  }, [persistMediaItem, project.id])

  const reloadMedia = useCallback(async () => {
    if (guest) await Promise.all([reconcileGuestTasks("image"), reconcileGuestTasks("video")])
    const imageConnection = imageSettings?.connections?.find((connection) => connection.id === imageSettings.activeConnectionId)
    const imageBinding = imageConnection?.models.find((binding) => binding.id === imageSettings?.activeModel)
    const videoConnection = videoSettings?.connections?.find((connection) => connection.id === videoSettings.activeConnectionId)
    const videoBinding = videoConnection?.models.find((binding) => binding.id === videoSettings?.activeModel)
    const [nextImages, nextVideos] = await Promise.all([
      backend.listMedia({
        projectId: project.id, kind: "image", page: imagePage,
        credentials: imageConnection && imageBinding ? {
          baseUrl: imageConnection.baseUrl, apiKey: imageConnection.apiKey,
          adapter: imageBinding.adapter, capabilityProfile: imageBinding.capabilityProfile, paths: imageConnection.paths,
        } : undefined,
      }),
      backend.listMedia({
        projectId: project.id, kind: "video", page: videoPage,
        credentials: videoConnection && videoBinding ? {
          baseUrl: videoConnection.baseUrl, apiKey: videoConnection.apiKey,
          adapter: videoBinding.adapter, capabilityProfile: videoBinding.capabilityProfile, paths: videoConnection.paths,
        } : undefined,
      }),
    ])
    setImages(nextImages)
    setVideos(nextVideos)
    setHasPendingImages(nextImages.hasPending)
    setHasPendingVideos(nextVideos.hasPending)
  }, [backend, guest, imagePage, imageSettings, project.id, reconcileGuestTasks, videoPage, videoSettings])

  useEffect(() => {
    const timer = window.setTimeout(() => { void reloadMedia() }, 0)
    return () => window.clearTimeout(timer)
  }, [reloadMedia])
  useEffect(() => {
    if (!hasPendingImages && !hasPendingVideos) return
    const timer = window.setInterval(() => { void reloadMedia() }, 5000)
    return () => window.clearInterval(timer)
  }, [hasPendingImages, hasPendingVideos, reloadMedia])
  useEffect(() => {
    const timer = window.setTimeout(() => {
      if (!supportsLocalDirectory()) { setDirectoryState("unsupported"); return }
      void getSavedMediaDirectory().then((handle) => setDirectoryState(handle ? "connected" : "disconnected"))
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  async function connectDirectory() {
    try {
      await chooseMediaDirectory()
      setDirectoryState("connected")
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") setStatus("目录授权失败")
    }
  }

  function changeKind(next: Kind) {
    if (generating) return
    if (kind === "video" && next !== "video") {
      setFirstFrame(null)
      setLastFrame(null)
      setReferences([])
    }
    setKind(next)
    setSelected(null)
  }

  function changeVideoMode(next: VideoMode) {
    if (next === videoMode) return
    setFirstFrame(null)
    setLastFrame(null)
    setReferences([])
    setGenerateAudio(next !== "frame")
    setVideoMode(next)
  }

  /** 切换 BYOK 配置里的当前模型（写回 localStorage） */
  function switchActiveModel(target: "image" | "video", option: ModelOption) {
    const settings = loadProviderSettings(target)
    if (!settings) return
    const connection = option.connectionId
      ? settings.connections?.find((item) => item.id === option.connectionId)
      : undefined
    if (connection && !connection.models.some((model) => model.id === option.model)) return
    if (!connection && !settings.models.includes(option.model)) return
    const next = connection
      ? activateProviderModel(settings, connection.id, option.model)
      : { ...settings, activeModel: option.model }
    saveProviderSettings(target, next)
    setSettingsVersion((version) => version + 1)
  }

  /** 实际生效的通道：只有用户自己的 API 配置可用。 */
  function effectiveChannel(target: Kind): Channel {
    const settings = target === "image" ? imageSettings : videoSettings
    return resolveEffectiveChannel({
      preferred: channelByKind[target],
      hasReadyByok: Boolean(settings && !settings.needsConfirmation),
    })
  }

  /** 切换模型后把时长收敛到该模型支持的范围内 */
  function clampVideoDuration(option: ModelOption) {
    const durations = resolveVideoModelCapabilities({
      source: option.source,
      model: option.model,
      capabilityProfile: option.capabilityProfile,
    }).durations
    setDuration((current) => {
      const value = Number(current)
      if (value < durations[0]) return String(durations[0])
      if (value > durations[durations.length - 1]) return String(durations[durations.length - 1])
      return current
    })
  }

  /** 选择模型并写回当前连接。 */
  function selectModel(target: "image" | "video", option: ModelOption) {
    saveModelChannel(target, option.source)
    setChannelByKind((current) => ({ ...current, [target]: option.source }))
    switchActiveModel(target, option)
    if (target === "video") {
      clampVideoDuration(option)
      const capabilities = resolveVideoModelCapabilities({
        source: option.source,
        model: option.model,
        capabilityProfile: option.capabilityProfile,
      })
      if (videoMode === "frame" && !capabilities.supportsFirstLastFrame) changeVideoMode("text")
    }
    if (target === "image") {
      const profile = option.capabilityProfile ?? inferModelProfile("image", option.model)
      const fixedResolution = imageModelResolution(option.model)
      if (fixedResolution) {
        setImageResolution(fixedResolution)
      } else if (option.source === "byok" && (profile === "nano-banana-2" || profile === "nano-banana-pro")) {
        setImageResolution("1K")
      }
      const capabilities = modelCapabilities(profile)
      if (capabilities?.kind === "image" && !capabilities.aspectRatios.includes(ratio)) {
        const nextRatio = capabilities.aspectRatios.includes("16:9")
          ? "16:9"
          : capabilities.aspectRatios[0]
        setRatio(nextRatio as ImageRatio)
      }
    }
  }

  async function reuseMedia(item: LocalMediaItem) {
    const snapshot = item.requestSnapshot
    if (!snapshot) {
      setPrompt(item.prompt)
      setDetailsOpen(false)
      setReuseNotice("已载入提示词")
      return
    }
    undoSnapshotRef.current = {
      prompt,
      ratio,
      quality,
      imageResolution,
      imageBackground,
      imageOutputFormat,
      imageCompression,
      imageModel,
      imageReferenceFiles: imageReferences.map((item) => item.file),
    }
    setPrompt(snapshot.prompt)
    setRatio(snapshot.ratio as ImageRatio)
    setQuality(snapshot.quality)
    setImageResolution(snapshot.resolution)
    setImageBackground(snapshot.background)
    setImageOutputFormat(snapshot.outputFormat)
    setImageCompression(snapshot.compression)
    if (imageSettings?.connections?.some((connection) => connection.id === snapshot.model.connectionId && connection.models.some((binding) => binding.id === snapshot.model.model))) {
      setChannelByKind((current) => ({ ...current, image: "byok" }))
      saveModelChannel("image", "byok")
      switchActiveModel("image", { source: "byok", model: snapshot.model.model, connectionId: snapshot.model.connectionId })
    } else {
      setReuseNotice("原模型当前不可用，已保留提示词并使用当前模型")
    }
    const restored = await Promise.all(snapshot.references.map(async (reference) => {
      const file = await readStoredMedia(reference.localMediaKey)
      return file ? new File([file], reference.name, { type: file.type || "image/png" }) : null
    }))
    imageReferenceControlsRef.current?.replaceFiles(restored.filter((file): file is File => Boolean(file)))
    setDetailsOpen(false)
    setReuseNotice(restored.filter(Boolean).length === snapshot.references.length ? "已载入历史设置和参考图" : `已载入设置，参考图恢复 ${restored.filter(Boolean).length}/${snapshot.references.length} 张`)
    window.setTimeout(() => document.querySelector<HTMLTextAreaElement>("textarea")?.focus(), 0)
  }

  function undoReuse() {
    const previous = undoSnapshotRef.current
    if (!previous) return
    setPrompt(previous.prompt)
    setRatio(previous.ratio)
    setQuality(previous.quality)
    setImageResolution(previous.imageResolution)
    setImageBackground(previous.imageBackground)
    setImageOutputFormat(previous.imageOutputFormat)
    setImageCompression(previous.imageCompression)
    setImageModel(previous.imageModel)
    imageReferenceControlsRef.current?.replaceFiles(previous.imageReferenceFiles)
    undoSnapshotRef.current = null
    setReuseNotice("")
  }

  function validateVideoRequest(cleanPrompt: string, model: string, capabilityProfile?: ModelOption["capabilityProfile"]) {
    const capabilities = resolveVideoModelCapabilities({
      source: "byok",
      model,
      capabilityProfile,
    })
    if (cleanPrompt.length > 5000) throw new Error("视频提示词最多 5000 字符")
    const activeReferences = videoMode === "frame"
      ? [firstFrame, lastFrame].filter((item): item is ReferenceUploadItem => Boolean(item))
      : videoMode === "media"
        ? references
        : []
    if (activeReferences.some((item) => item.state === "uploading")) {
      throw new Error("参考素材仍在上传，请稍候")
    }
    if (activeReferences.some((item) => item.state === "failed" || !item.providerUrl)) {
      throw new Error("存在上传失败的参考素材，请重试或移除")
    }
    if (activeReferences.some((item) => !item.providerUrl?.startsWith("https://"))) {
      throw new Error("参考素材需要公网 HTTPS 地址，请配置 REFERENCE_MEDIA_PUBLIC_BASE_URL")
    }
    const issues = validateVideoRequestPolicy({
      capabilities,
      duration: Number(duration),
      referenceMode: videoMode === "text" ? undefined : videoMode,
      referenceImageCount: videoMode === "media" ? references.filter((item) => item.kind === "image").length : 0,
      referenceVideoCount: videoMode === "media" ? references.filter((item) => item.kind === "video").length : 0,
      referenceAudioCount: videoMode === "media" ? references.filter((item) => item.kind === "audio").length : 0,
      hasFirstFrame: videoMode === "frame" && Boolean(firstFrame),
      hasLastFrame: videoMode === "frame" && Boolean(lastFrame),
    })
    if (issues[0]) throw new Error(issues[0].message)
  }

  function videoRequestFields(model: string, cleanPrompt: string) {
    return {
      model,
      prompt: cleanPrompt,
      duration: Number(duration),
      aspect_ratio: videoRatio,
      generate_audio: generateAudio,
      resolution,
      ...(videoMode === "frame" ? {
        reference_mode: "frame",
        first_image_url: firstFrame?.providerUrl,
        last_image_url: lastFrame?.providerUrl,
      } : {}),
      ...(videoMode === "media" ? {
        reference_mode: "media",
        reference_image_urls: references.filter((item) => item.kind === "image").map((item) => item.providerUrl as string),
        reference_videos: references.filter((item) => item.kind === "video").map((item) => item.providerUrl as string),
        reference_audios: references.filter((item) => item.kind === "audio").map((item) => item.providerUrl as string),
      } : {}),
    }
  }

  /** 纯本地模式：经 /api/local/* 无状态代理直连用户端点，记录只写 IndexedDB */
  async function generateLocally(generationKind: Kind, settings: ProviderSettings, cleanPrompt: string, submittedImage?: SubmittedImageRequest, clientTaskId?: string) {
    const activeConnection = settings.connections?.find((connection) => connection.id === settings.activeConnectionId)
    const activeBinding = activeConnection?.models.find((binding) => binding.id === settings.activeModel)
    if (!activeConnection || !activeBinding) throw new Error("请先配置该模型的接口方式和能力模板")
    const imageCapabilities = modelCapabilities(activeBinding.capabilityProfile)
    const credentials = {
      baseUrl: settings.baseUrl,
      apiKey: settings.apiKey,
      adapter: activeBinding.adapter,
      capabilityProfile: activeBinding.capabilityProfile,
      paths: settings.paths,
    }
    const id = createClientId()

    if (generationKind === "image") {
      const response = await fetch("/api/local/images/generations", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          credentials,
          model: submittedImage?.snapshot.model.model ?? settings.activeModel,
          prompt: cleanPrompt,
          size: IMAGE_SIZES[(submittedImage?.snapshot.ratio as ImageRatio | undefined) ?? ratio],
          aspect_ratio: submittedImage?.snapshot.ratio ?? ratio,
          ...(imageCapabilities?.kind === "image" && imageCapabilities.qualities.length ? { quality: submittedImage?.snapshot.quality ?? quality } : {}),
          ...(imageCapabilities?.kind === "image" && imageCapabilities.resolutions.length ? { resolution: submittedImage?.snapshot.resolution ?? imageResolution } : {}),
          ...(imageCapabilities?.kind === "image" && imageCapabilities.backgrounds.length ? { background: submittedImage?.snapshot.background ?? imageBackground } : {}),
          ...(imageCapabilities?.kind === "image" && imageCapabilities.outputFormats.length ? { output_format: submittedImage?.snapshot.outputFormat ?? imageOutputFormat } : {}),
          ...(imageCapabilities?.kind === "image" && imageCapabilities.outputFormats.length && (submittedImage?.snapshot.outputFormat ?? imageOutputFormat) !== "png" ? { output_compression: submittedImage?.snapshot.compression ?? imageCompression } : {}),
          ...(submittedImage?.providerReferenceUrls.length ? { reference_images: submittedImage.providerReferenceUrls } : {}),
        }),
      })
      const data = (await response.json()) as {
        dispatch?: "completed" | "async"
        remoteUrl?: string
        providerTaskId?: string
        providerOperation?: "image_generation" | "image_edit"
        error?: string
      }
      if (!response.ok) throw new Error(data.error ?? "生成失败")
      if (data.dispatch === "async" && data.providerTaskId) {
        const pendingItem: LocalMediaItem = {
          id, projectId: project.id, kind: "image", prompt: cleanPrompt,
          modelKey: settings.activeModel, providerConnectionId: activeConnection.id,
          remoteUrl: "", localFileName: null, createdAt: currentTimestamp(), status: "running",
          providerTaskId: data.providerTaskId,
          providerOperation: data.providerOperation ?? "image_generation",
          ...(submittedImage ? { requestSnapshot: submittedImage.snapshot } : {}),
        }
        await saveMediaIndex(pendingItem)
        if (clientTaskId) updateImageTask(clientTaskId, () => pendingItem)
        else setSelected(pendingItem)
        await reloadMedia()
        const imageCapabilities = modelCapabilities(activeBinding.capabilityProfile)
        const maxPollAttempts = imageCapabilities?.kind === "image"
          ? imageCapabilities.maxPollAttempts ?? 72
          : 72
        const pollIntervalMs = imageCapabilities?.kind === "image"
          ? imageCapabilities.pollIntervalMs ?? 5000
          : 5000
        let pollAttempts = 0
        while (pollAttempts < maxPollAttempts) {
          setStatus("图片生成中，正在查询任务状态")
          await new Promise((resolve) => window.setTimeout(resolve, pollIntervalMs))
          pollAttempts += 1
          const pollResponse = await fetch("/api/local/images/status", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              credentials,
              model: settings.activeModel,
              providerTaskId: data.providerTaskId,
              providerOperation: pendingItem.providerOperation,
            }),
          })
          if (!pollResponse.ok) continue
          const result = (await pollResponse.json()) as { status: string; remoteUrl?: string; error?: string }
          const terminal = terminalFromProviderStatus(result.status)
          if (terminal === "succeeded" && result.remoteUrl) {
            const completed: LocalMediaItem = { ...pendingItem, status: "succeeded", remoteUrl: result.remoteUrl }
            if (clientTaskId) updateImageTask(clientTaskId, () => completed)
            else setSelected(completed)
            await publishCompletedImage(completed)
            setStatus("生成完成，正在后台保存原图")
            void persistMediaItem(completed, { baseUrl: activeConnection.baseUrl, apiKey: activeConnection.apiKey })
              .then(async (stored) => {
                if (clientTaskId) updateImageTask(clientTaskId, () => ({ ...stored, status: "succeeded" }))
                setStatus("生成完成，原图已保存在浏览器")
                await reloadMedia()
              })
              .catch((error) => {
                if (clientTaskId) updateImageTask(clientTaskId, (item) => ({ ...item, status: "succeeded" }))
                setStatus(error instanceof Error ? error.message : "原图保存失败")
              })
            return
          }
          if (terminal) {
            const message = result.error ?? (terminal === "succeeded" ? "供应商已完成任务，但未返回图片地址" : "图片生成失败")
            await saveMediaIndex({ ...pendingItem, status: "failed", errorMessage: message })
            await reloadMedia()
            throw new Error(message)
          }
        }
        throw new Error("图片生成查询超时，请稍后从历史记录继续查看")
      }
      if (data.dispatch !== "completed" || !data.remoteUrl) throw new Error("图片供应商未返回图片或任务 ID")
      const previewItem: LocalMediaItem = { id, projectId: project.id, kind: "image", prompt: cleanPrompt, modelKey: submittedImage?.snapshot.model.model ?? settings.activeModel, providerConnectionId: activeConnection.id, remoteUrl: data.remoteUrl, localFileName: null, createdAt: currentTimestamp(), status: "succeeded", ...(submittedImage ? { requestSnapshot: submittedImage.snapshot } : {}) }
      if (clientTaskId) updateImageTask(clientTaskId, () => previewItem)
      else setSelected(previewItem)
      await publishCompletedImage(previewItem)
      setStatus("生成完成，正在后台保存原图")
      void persistMediaItem(previewItem, { baseUrl: activeConnection.baseUrl, apiKey: activeConnection.apiKey }).then(async (stored) => {
        if (clientTaskId) updateImageTask(clientTaskId, () => ({ ...stored, status: "succeeded" }))
        setStatus("生成完成，原图已保存在浏览器")
        await reloadMedia()
      }).catch((error) => {
        if (clientTaskId) updateImageTask(clientTaskId, (item) => ({ ...item, status: "succeeded" }))
        setStatus(error instanceof Error ? error.message : "原图保存失败")
      })
      return
    }

    // 视频：创建任务 → 写进行中记录 → 轮询状态
    const response = await fetch("/api/local/videos", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ credentials, ...videoRequestFields(settings.activeModel, cleanPrompt) }),
    })
    const created = (await response.json()) as { providerTaskId?: string; error?: string }
    if (!response.ok || !created.providerTaskId) throw new Error(created.error ?? "视频任务创建失败")
    const pendingItem: LocalMediaItem = { id, projectId: project.id, kind: "video", prompt: cleanPrompt, modelKey: settings.activeModel, providerConnectionId: activeConnection?.id, remoteUrl: "", localFileName: null, createdAt: currentTimestamp(), status: "running", providerTaskId: created.providerTaskId }
    await saveMediaIndex(pendingItem)
    setSelected(pendingItem)
    await reloadMedia()

    let pollAttempts = 0
    while (pollAttempts < 1440) {
      setStatus("视频生成中，正在查询任务状态")
      await new Promise((resolve) => window.setTimeout(resolve, 5000))
      pollAttempts += 1
      const pollResponse = await fetch("/api/local/videos/status", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ credentials, providerTaskId: created.providerTaskId }),
      })
      if (!pollResponse.ok) continue
      const result = (await pollResponse.json()) as { status: string; remoteUrl?: string; error?: string }
      const terminal = terminalFromProviderStatus(result.status)
      if (terminal === "succeeded" && result.remoteUrl) {
        const item: LocalMediaItem = { ...pendingItem, status: "succeeded", remoteUrl: result.remoteUrl }
        setSelected(item)
        setStatus("生成完成，正在后台保存原图")
        void persistMediaItem(item, { baseUrl: activeConnection.baseUrl, apiKey: activeConnection.apiKey }).then(async () => {
          setStatus("生成完成，原图已保存在浏览器")
          await reloadMedia()
        }).catch((error) => setStatus(error instanceof Error ? error.message : "原图保存失败"))
        return
      }
      if (terminal === "succeeded") {
        const message = "供应商已完成任务，但未返回视频地址"
        await saveMediaIndex({ ...pendingItem, status: "failed", errorMessage: message })
        await reloadMedia()
        throw new Error(message)
      }
      if (terminal === "failed") {
        await saveMediaIndex({ ...pendingItem, status: "failed", errorMessage: result.error ?? "视频生成失败" })
        await reloadMedia()
        throw new Error(result.error ?? "视频生成失败")
      }
    }
    throw new Error("视频生成查询超时，请稍后从历史记录继续查看")
  }

  async function generate(promptOverride?: string, kindOverride?: Kind, imageOverride?: ChatImageGenerationRequest) {
    const cleanPrompt = (promptOverride ?? prompt).trim()
    if (!cleanPrompt) return
    const generationKind = kindOverride ?? kind
    if (generating) {
      if (generationKind !== "image") {
        if (promptOverride) throw new Error("当前已有生成任务正在提交")
        return
      }
    }
    const overrideConnection = imageOverride?.modelOption.source === "byok"
      ? imageSettings?.connections?.find((connection) => connection.id === imageOverride.modelOption.connectionId)
      : undefined
    const settings = generationKind === "image"
      ? imageOverride?.modelOption.source === "byok" && imageSettings && overrideConnection
        ? activateProviderModel(imageSettings, overrideConnection.id, imageOverride.modelOption.model)
        : imageSettings
      : videoSettings
    const currentChannel: Channel = generationKind === "image" && imageOverride
      ? imageOverride.modelOption.source
      : effectiveChannel(generationKind)
    if (currentChannel === "needs-config") {
      setStatus(`请先配置${generationKind === "image" ? "图片" : "视频"} API 再生成`)
      setSettingsDialog(generationKind)
      if (promptOverride) throw new Error(`请先配置${generationKind === "image" ? "图片" : "视频"} API`)
      return
    }
    setGenerating(true)
    setStatus("正在提交生成请求")
    try {
      if (generationKind === "image" && imageReferences.length) {
        if (imageReferences.some((item) => item.state === "uploading")) throw new Error("参考图仍在上传，请稍候")
        if (imageReferences.some((item) => item.state === "failed" || !item.providerUrl)) throw new Error("存在上传失败的参考图，请重试或移除")
        const activeConnection = settings?.connections?.find((connection) => connection.id === settings.activeConnectionId)
        const profile = imageOverride?.modelOption.capabilityProfile ?? activeConnection?.models.find((binding) => binding.id === settings?.activeModel)?.capabilityProfile ?? inferModelProfile("image", imageOverride?.modelOption.model ?? imageModel)
        const capabilities = modelCapabilities(profile)
        if (capabilities?.kind === "image" && imageReferences.length > capabilities.maxReferenceImages) throw new Error(`该模型最多支持 ${capabilities.maxReferenceImages} 张参考图`)
      }
      if (generationKind === "video") {
        const model = currentChannel === "byok" && settings ? settings.activeModel : videoModel
        const activeConnection = settings?.connections?.find((connection) => connection.id === settings.activeConnectionId)
        const profile = activeConnection?.models.find((binding) => binding.id === settings?.activeModel)?.capabilityProfile
        validateVideoRequest(cleanPrompt, model, profile ?? undefined)
      }
      if (generationKind === "image") {
        const submittedAt = currentTimestamp()
        const clientId = createClientId()
        const placeholder: LocalMediaItem = {
          id: `pending-${clientId}`,
          projectId: project.id,
          kind: "image",
          prompt: cleanPrompt,
          modelKey: imageOverride?.modelOption.model ?? activeOption.model,
          remoteUrl: "",
          localFileName: null,
          createdAt: submittedAt,
          status: "submitting",
          requestSnapshot: {
            prompt: cleanPrompt,
            model: imageOverride?.modelOption ?? { source: activeOption.source, model: activeOption.model, ...(activeOption.connectionId ? { connectionId: activeOption.connectionId } : {}), ...(activeOption.label ? { label: activeOption.label } : {}) },
            ratio: imageOverride?.aspectRatio ?? ratio,
            resolution: imageOverride?.resolution ?? imageResolution,
            quality: imageOverride?.quality ?? quality,
            background: imageOverride?.background ?? imageBackground,
            outputFormat: imageOverride?.outputFormat ?? imageOutputFormat,
            compression: imageCompression,
            references: [],
            createdAt: submittedAt,
          },
        }
        setImageTasks((current) => [...current, { clientId, item: placeholder }])
        setActiveImageTaskId(clientId)
        if (!promptOverride) setPrompt("")
        setStatus("已提交，可继续输入下一条提示词")
        setGenerating(false)
        void imageSnapshot({ prompt: cleanPrompt, model: imageOverride?.modelOption ?? activeOption, references: imageReferences, ratio: imageOverride?.aspectRatio as ImageRatio | undefined, resolution: imageOverride?.resolution, quality: imageOverride?.quality, background: imageOverride?.background, outputFormat: imageOverride?.outputFormat }).then(async (snapshot) => {
          updateImageTask(clientId, (item) => ({ ...item, requestSnapshot: snapshot, status: "running" }))
          const submittedImage: SubmittedImageRequest = {
            snapshot,
            providerReferenceUrls: imageReferences.flatMap((item) => item.providerUrl ? [item.providerUrl] : []),
          }
          return generateLocally(generationKind, settings as ProviderSettings, cleanPrompt, submittedImage, clientId)
        }).catch((error) => {
          updateImageTask(clientId, (item) => ({ ...item, status: "failed", errorMessage: error instanceof Error ? error.message : "生成失败" }))
          setStatus(error instanceof Error ? error.message : "生成失败")
        })
        return placeholder.id
      }
      await generateLocally(generationKind, settings as ProviderSettings, cleanPrompt)
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "生成失败")
      if (promptOverride) throw error
    }
    finally { setGenerating(false) }
  }

  async function historyImageFile(id: string) {
    const item = images.items.find((candidate) => candidate.id === id)
    if (!item) throw new Error("历史图片不存在")

    const stored = item.localMediaKey ? await readStoredMedia(item.localMediaKey) : null
    if (stored) {
      const type = stored.type || (item.localMediaKey?.endsWith(".png") ? "image/png" : item.localMediaKey?.endsWith(".webp") ? "image/webp" : "image/jpeg")
      const extension = type === "image/jpeg" ? "jpg" : type === "image/webp" ? "webp" : "png"
      return new File([stored], `history-${item.id}.${extension}`, { type })
    }
    if (!item.remoteUrl) throw new Error("本地原图不存在")

    let response: Response
    if (item.remoteUrl.startsWith("data:")) {
      response = await fetch(item.remoteUrl)
    } else {
      const connection = imageSettings?.connections?.find(
        (candidate) => candidate.id === item.providerConnectionId
      )
      response = await fetch("/api/local/media", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          url: item.remoteUrl,
          ...(connection ? { credentials: { baseUrl: connection.baseUrl, apiKey: connection.apiKey } } : {}),
        }),
      })
    }
    if (!response.ok) throw new Error("历史图片读取失败")
    const blob = await response.blob()
    if (!blob.type.startsWith("image/")) throw new Error("历史记录不是有效图片")
    const extension = blob.type === "image/jpeg" ? "jpg" : blob.type === "image/webp" ? "webp" : "png"
    return new File([blob], `history-${item.id}.${extension}`, { type: blob.type })
  }

  async function saveMediaToLocalDirectory(item: LocalMediaItem) {
    if (item.localFileName) return
    setStatus("正在保存到本机")
    try {
      const projectInfo = { id: project.id, title: resolvedTitle }
      const pendingPersistence = mediaPersistenceTasksRef.current.get(item.id)
      const cachedItem = pendingPersistence ? await pendingPersistence : item
      const original = cachedItem.localMediaKey ? await readStoredMedia(cachedItem.localMediaKey) : null
      let localFileName = original
        ? await writeCachedMedia({ id: item.id, kind: item.kind, project: projectInfo, blob: original })
        : null
      if (!localFileName) {
        if (!cachedItem.remoteUrl) throw new Error("浏览器中没有可下载的原图")
        const settings = item.kind === "image" ? imageSettings : videoSettings
        const connection = settings?.connections?.find((candidate) => candidate.id === item.providerConnectionId)
        localFileName = await writeRemoteMediaFromUrl({
          id: item.id,
          kind: item.kind,
          project: projectInfo,
          url: cachedItem.remoteUrl,
          ...(connection ? { base: connection.baseUrl, key: connection.apiKey } : {}),
        })
      }
      if (!localFileName) throw new Error("请先连接本地媒体目录")
      const saved = { ...cachedItem, localFileName }
      await saveMediaIndex(saved)
      setSelected(saved)
      setStatus(`已保存到 ${localFileName}`)
      await reloadMedia()
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "保存到本机失败")
      throw error
    }
  }

  async function addHistoryImageReference(id: string, target: Kind) {
    try {
      setStatus("正在添加历史图片")
      const file = await historyImageFile(id)
      if (target === "image") imageReferenceControlsRef.current?.addFiles([file])
      else videoReferenceControlsRef.current?.addImageFiles([file])
      setStatus("已添加历史图片")
    } catch (error) {
      setStatus(error instanceof Error ? error.message : "历史图片添加失败")
    }
  }

  const channel = effectiveChannel(kind)
  const activeSettings = kind === "image" ? imageSettings : videoSettings
  const activeConnection = activeSettings?.connections?.find((connection) => connection.id === activeSettings.activeConnectionId)
  const activeBinding = activeConnection?.models.find((binding) => binding.id === activeSettings?.activeModel)
  const activeOption: ModelOption = {
    source: "byok",
    model: activeSettings?.activeModel ?? "",
    connectionId: activeConnection?.id,
    adapter: activeBinding?.adapter,
    capabilityProfile: activeBinding?.capabilityProfile,
    label: activeBinding?.label ?? activeBinding?.id,
  }
  const activeImageResolution = imageModelResolution(activeOption.model) ?? imageResolution
  const imageOptions: ModelOption[] = [
    ...(imageSettings?.connections?.flatMap((connection) => connection.models.filter((binding) =>
      isProviderModelListed("image", binding.id, binding.capabilityProfile)
    ).map((binding) => ({
      source: "byok" as const,
      model: binding.id,
      connectionId: connection.id,
      adapter: binding.adapter,
      capabilityProfile: binding.capabilityProfile,
      label: binding.label ?? binding.id,
      providerLabel: connection.name,
    }))) ?? []),
  ]
  const chatImageToolContext: ChatImageToolContext = {
    current: { modelOption: activeOption, aspectRatio: ratio, resolution: activeImageResolution, quality, background: imageBackground, outputFormat: imageOutputFormat },
    models: imageOptions.flatMap((option) => {
      const capabilities = modelCapabilities(option.capabilityProfile ?? inferModelProfile("image", option.model))
      if (capabilities?.kind !== "image") return []
      const familyResolution = imageModelResolution(option.model)
      return [{
        ...option,
        label: option.label ?? imageModelLabel(option.model),
        aspectRatios: capabilities.aspectRatios,
        resolutions: (familyResolution ? [familyResolution] : capabilities.resolutions) as readonly ("1K" | "2K" | "4K")[],
        qualities: capabilities.qualities,
        backgrounds: capabilities.backgrounds,
        outputFormats: capabilities.outputFormats,
        points: null,
      }]
    }),
  }
  const videoOptions: ModelOption[] = [
    ...(videoSettings?.connections?.flatMap((connection) => connection.models.filter((binding) =>
      isProviderModelListed("video", binding.id, binding.capabilityProfile)
    ).map((binding) => ({
      source: "byok" as const,
      model: binding.id,
      connectionId: connection.id,
      adapter: binding.adapter,
      capabilityProfile: binding.capabilityProfile,
      label: binding.label ?? binding.id,
      providerLabel: connection.name,
    }))) ?? []),
  ]
  const costLabel = channel === "needs-config" ? "需配置 API" : "自有 API"
  const modelLabel = activeOption.label ?? imageModelLabel(activeOption.model)
  const effectiveCapabilities = resolveModelCapabilities({
    kind,
    source: activeOption.source,
    model: activeOption.model,
    capabilityProfile: activeOption.capabilityProfile,
  })
  const videoCapabilities = effectiveCapabilities?.kind === "video"
    ? effectiveCapabilities
    : resolveVideoModelCapabilities({ source: "byok", model: activeOption.model, capabilityProfile: activeOption.capabilityProfile })
  const activeImageTask = activeImageTaskId
    ? imageTasks.find((task) => task.clientId === activeImageTaskId)?.item ?? null
    : null
  const previewItem = kind === "image" ? activeImageTask ?? selected : selected
  const sidebarImages = {
    ...images,
    items: [
      ...imageTasks
        .filter((task) => task.item.status !== "succeeded" && !images.items.some((item) => item.id === task.item.id))
        .map((task) => task.item),
      ...images.items,
    ],
  }
  const previewSettings = previewItem?.kind === "image" ? imageSettings : videoSettings
  const previewConnection = previewItem?.providerConnectionId
    ? previewSettings?.connections?.find((connection) => connection.id === previewItem.providerConnectionId)
    : undefined

  function selectMediaItem(item: LocalMediaItem) {
    const task = imageTasks.find((candidate) => candidate.item.id === item.id)
    setActiveImageTaskId(task?.clientId ?? null)
    setSelected(item)
    if (item.localMediaKey || !item.remoteUrl || item.status === "running" || migratingMediaRef.current.has(item.id)) return
    const settings = item.kind === "image" ? imageSettings : videoSettings
    const connection = settings?.connections?.find((candidate) => candidate.id === item.providerConnectionId)
    migratingMediaRef.current.add(item.id)
    setStatus("正在把历史原图保存到浏览器")
    void persistMediaItem(
      item,
      connection ? { baseUrl: connection.baseUrl, apiKey: connection.apiKey } : undefined
    ).then(async () => {
      setStatus("历史原图已保存到浏览器")
      await reloadMedia()
    }).catch((error) => {
      setStatus(error instanceof Error ? error.message : "历史原图迁移失败")
    }).finally(() => {
      migratingMediaRef.current.delete(item.id)
    })
  }

  if (guest && projectMissing) {
    return (
      <main className={styles.workbench}>
        <div className={styles.missingProject}>
          <h1>项目不存在或已删除</h1>
          <p>纯本地模式的项目只保存在浏览器中，可能已被清理。</p>
          <Link className="button button-primary" href="/projects">返回项目列表</Link>
        </div>
      </main>
    )
  }

  return (
    <main className={styles.workbench}>
      <div className={styles.grid}>
        <MediaSidebar
          projectTitle={resolvedTitle}
          directoryState={directoryState}
          onConnectDirectory={connectDirectory}
          images={sidebarImages}
          videos={videos}
          imagePage={imagePage}
          videoPage={videoPage}
          setImagePage={setImagePage}
          setVideoPage={setVideoPage}
          selected={previewItem}
          onSelect={selectMediaItem}
        />
        <section className={styles.creator}>
          <div className={styles.creatorHeading}>
            <h1>{kind === "image" ? "生成图片" : "生成视频"}</h1>
            <div className={styles.modeTabs} role="tablist" aria-label="创作模式">
              <button role="tab" aria-selected={kind === "image"} className={kind === "image" ? styles.active : ""} onClick={() => changeKind("image")} disabled={generating}><ImageIcon size={14} />图片</button>
              <button role="tab" aria-selected={kind === "video"} className={kind === "video" ? styles.active : ""} onClick={() => changeKind("video")} disabled={generating}><Video size={14} />视频</button>
            </div>
            <div className={styles.headingSide}>
              <button
                className="button icon-button"
                onClick={() => setSettingsDialog(kind)}
                disabled={generating}
                title={`${kind === "image" ? "图片" : "视频"} API 设置`}
                aria-label={`${kind === "image" ? "图片" : "视频"} API 设置`}
              >
                <Settings size={13} />
              </button>
            </div>
          </div>
          <PreviewStage
            item={previewItem}
            kind={kind}
            imageCredentials={previewItem?.kind === "image" && previewConnection ? { baseUrl: previewConnection.baseUrl, apiKey: previewConnection.apiKey } : null}
            videoCredentials={previewItem?.kind === "video" && previewConnection ? { baseUrl: previewConnection.baseUrl, apiKey: previewConnection.apiKey } : null}
            onSaveLocal={saveMediaToLocalDirectory}
            onDetails={(item) => { setSelected(item); setDetailsOpen(true) }}
          />
          {detailsOpen && selected ? <MediaDetails item={selected} onClose={() => setDetailsOpen(false)} onReuse={(item) => { void reuseMedia(item) }} /> : null}
          <Composer
            kind={kind}
            prompt={prompt}
            setPrompt={setPrompt}
            ratio={ratio}
            availableRatios={effectiveCapabilities?.kind === "image" ? effectiveCapabilities.aspectRatios : undefined}
            setRatio={setRatio}
            quality={quality}
            setQuality={setQuality}
            imageResolution={activeImageResolution}
            setImageResolution={setImageResolution}
            modelLabel={modelLabel}
            costLabel={costLabel}
            modelOptions={kind === "image" && imageOptions.length > 1 ? imageOptions : undefined}
            currentModelOption={activeOption}
            onModelChange={(option) => selectModel("image", option)}
            needsConfig={channel === "needs-config"}
            onConfigure={() => setSettingsDialog(kind)}
            generating={generating}
            status={status}
            onGenerate={() => { void generate() }}
            onAddReferenceImages={kind === "image" && effectiveCapabilities?.kind === "image" && effectiveCapabilities.supportsReferenceImages
              ? (files) => imageReferenceControlsRef.current?.addFiles(files)
              : kind === "video" && videoMode !== "text"
                ? (files) => videoReferenceControlsRef.current?.addImageFiles(files)
                : undefined}
            onAddHistoryImage={kind === "image" && effectiveCapabilities?.kind === "image" && effectiveCapabilities.supportsReferenceImages
              ? (id) => void addHistoryImageReference(id, "image")
              : kind === "video" && videoMode !== "text"
                ? (id) => void addHistoryImageReference(id, "video")
                : undefined}
            promptReferences={kind === "video" && videoMode === "media" ? buildPromptReferences(references.filter((item) =>
              item.kind === "image"
                ? videoCapabilities.supportsReferenceImages
                : item.kind === "video"
                  ? videoCapabilities.supportsReferenceVideos
                  : videoCapabilities.supportsReferenceAudios
            )) : undefined}
            referenceControls={kind === "image" && effectiveCapabilities?.kind === "image" && effectiveCapabilities.supportsReferenceImages ? (
              <ImageReferenceControls
                ref={imageReferenceControlsRef}
                items={imageReferences}
                setItems={setImageReferences}
                maxItems={effectiveCapabilities.maxReferenceImages}
                disabled={generating}
              />
            ) : kind === "video" ? (
              <VideoReferenceControls
                ref={videoReferenceControlsRef}
                mode={videoMode}
                firstFrame={firstFrame}
                setFirstFrame={setFirstFrame}
                lastFrame={lastFrame}
                setLastFrame={setLastFrame}
                references={references}
                setReferences={setReferences}
                disabled={generating}
                limits={{
                  maxImages: videoCapabilities.maxReferenceImages,
                  maxVideos: videoCapabilities.maxReferenceVideos,
                  maxAudios: videoCapabilities.maxReferenceAudios,
                  allowVideo: videoCapabilities.supportsReferenceVideos,
                  allowAudio: videoCapabilities.supportsReferenceAudios,
                  videoDuration: videoCapabilities.referenceVideoDuration,
                  audioMaxDuration: videoCapabilities.referenceAudioMaxDuration,
                  videoDimensions: videoCapabilities.referenceVideoDimensions,
                }}
              />
            ) : undefined}
            videoControls={kind === "video" ? (
              <VideoToolbarControls
                model={activeOption.model}
                capabilities={videoCapabilities}
                current={activeOption}
                options={videoOptions}
                onSelect={(option) => selectModel("video", option)}
                mode={videoMode}
                setMode={changeVideoMode}
                duration={duration}
                setDuration={setDuration}
                ratio={videoRatio}
                setRatio={setVideoRatio}
                resolution={resolution}
                setResolution={setResolution}
                generateAudio={generateAudio}
                setGenerateAudio={setGenerateAudio}
                disabled={generating}
              />
            ) : undefined}
          />
          {reuseNotice ? <div className={styles.reuseNotice}>{reuseNotice}<button type="button" onClick={undoReuse}>撤销</button></div> : null}
        </section>
        <ChatPanel
          projectId={project.id}
          guest={guest}
          resolveHistoryImage={historyImageFile}
          imageToolContext={chatImageToolContext}
          onGenerateImageRequest={async (request) => await generate(request.prompt, "image", request)}
        />
      </div>
      {settingsDialog ? (
        <ProviderSettingsDialog
          kind={settingsDialog}
          onSaved={() => {
            setSettingsDialog(null)
            setSettingsVersion((version) => version + 1)
          }}
          onCancel={() => setSettingsDialog(null)}
        />
      ) : null}
    </main>
  )
}
