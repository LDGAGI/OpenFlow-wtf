"use client"

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"
import {
  AudioLines,
  Film,
  ImageIcon,
} from "lucide-react"

import { createClientId } from "@/lib/client-id"
import { inspectReferenceMedia, REFERENCE_ACCEPT, referenceFileError, referenceMetadataError, type ReferenceKind, type ReferenceUploadItem } from "./reference-upload-types"
import { ReferenceThumbnail } from "./reference-thumbnail"
import styles from "./video-reference-controls.module.css"

export type VideoMode = "text" | "frame" | "media"

type PickerRequest = {
  kind: ReferenceKind
  target?: "first" | "last"
  replaceId?: string
}

type Props = {
  mode: VideoMode
  firstFrame: ReferenceUploadItem | null
  setFirstFrame: React.Dispatch<React.SetStateAction<ReferenceUploadItem | null>>
  lastFrame: ReferenceUploadItem | null
  setLastFrame: React.Dispatch<React.SetStateAction<ReferenceUploadItem | null>>
  references: ReferenceUploadItem[]
  setReferences: React.Dispatch<React.SetStateAction<ReferenceUploadItem[]>>
  disabled: boolean
  /** 按模型的素材限制；缺省保持 seedance 行为 */
  limits?: {
    maxImages?: number
    maxVideos?: number
    maxAudios?: number
    allowVideo?: boolean
    allowAudio?: boolean
    videoDuration?: { min: number; max: number }
    audioMaxDuration?: number
    videoDimensions?: { min: number; max: number }
  }
}

export type VideoReferenceControlsHandle = {
  addImageFiles: (files: FileList | File[]) => void
}

export const VideoReferenceControls = forwardRef<VideoReferenceControlsHandle, Props>(function VideoReferenceControls({
  mode,
  firstFrame,
  setFirstFrame,
  lastFrame,
  setLastFrame,
  references,
  setReferences,
  disabled,
  limits,
}, ref) {
  const maxImages = limits?.maxImages ?? 9
  const maxVideos = limits?.maxVideos ?? 3
  const maxAudios = limits?.maxAudios ?? 3
  const allowVideo = limits?.allowVideo ?? true
  const allowAudio = limits?.allowAudio ?? true
  const inputRef = useRef<HTMLInputElement>(null)
  const pickerRequestRef = useRef<PickerRequest | null>(null)
  const objectUrlsRef = useRef(new Set<string>())
  const controllersRef = useRef(new Set<AbortController>())
  const [uploadError, setUploadError] = useState("")

  useEffect(() => {
    const objectUrls = objectUrlsRef.current
    const controllers = controllersRef.current
    return () => {
      controllers.forEach((controller) => controller.abort())
      objectUrls.forEach((url) => URL.revokeObjectURL(url))
      controllers.clear()
      objectUrls.clear()
    }
  }, [])

  useEffect(() => {
    controllersRef.current.forEach((controller) => controller.abort())
    objectUrlsRef.current.forEach((url) => URL.revokeObjectURL(url))
    controllersRef.current.clear()
    objectUrlsRef.current.clear()
  }, [mode])

  function release(item: ReferenceUploadItem | null) {
    if (!item) return
    URL.revokeObjectURL(item.previewUrl)
    objectUrlsRef.current.delete(item.previewUrl)
  }

  function openPicker(
    kind: ReferenceKind,
    target?: "first" | "last",
    replaceId?: string
  ) {
    if (disabled || !inputRef.current) return
    pickerRequestRef.current = { kind, target, replaceId }
    inputRef.current.accept = REFERENCE_ACCEPT[kind]
    inputRef.current.multiple = !target && !replaceId
    inputRef.current.value = ""
    inputRef.current.click()
  }

  function updateItem(id: string, update: Partial<ReferenceUploadItem>) {
    setFirstFrame((current) =>
      current?.id === id ? { ...current, ...update } : current
    )
    setLastFrame((current) =>
      current?.id === id ? { ...current, ...update } : current
    )
    setReferences((current) =>
      current.map((item) => (item.id === id ? { ...item, ...update } : item))
    )
  }

  async function upload(item: ReferenceUploadItem) {
    updateItem(item.id, { state: "uploading", error: undefined })
    const controller = new AbortController()
    controllersRef.current.add(controller)
    try {
      const metadata = await inspectReferenceMedia(item.file, item.kind)
      const metadataError = referenceMetadataError(item.kind, metadata, {
        videoDuration: limits?.videoDuration,
        audioMaxDuration: limits?.audioMaxDuration,
        videoDimensions: limits?.videoDimensions,
      })
      if (metadataError) throw new Error(metadataError)
      updateItem(item.id, { metadata })
      const response = await fetch(
        `/api/local/reference-uploads?kind=${item.kind}`,
        {
          method: "POST",
          headers: { "Content-Type": item.file.type },
          body: item.file,
          signal: controller.signal,
        }
      )
      const data = (await response.json()) as {
        upload?: { url: string }
        error?: string
      }
      if (!response.ok || !data.upload?.url) {
        throw new Error(data.error ?? "参考素材上传失败")
      }
      updateItem(item.id, {
        state: "ready",
        providerUrl: data.upload.url,
        error: undefined,
      })
    } catch (error) {
      if ((error as DOMException).name === "AbortError") return
      updateItem(item.id, {
        state: "failed",
        error: error instanceof Error ? error.message : "参考素材上传失败",
      })
    } finally {
      controllersRef.current.delete(controller)
    }
  }

  function makeItem(file: File, kind: ReferenceKind): ReferenceUploadItem {
    const previewUrl = URL.createObjectURL(file)
    objectUrlsRef.current.add(previewUrl)
    return {
      id: createClientId(),
      kind,
      name: file.name,
      file,
      previewUrl,
      state: "uploading",
    }
  }

  function validFiles(files: File[], kind: ReferenceKind) {
    const invalid = files.find((file) => referenceFileError(file, kind))
    if (invalid) {
      setUploadError(referenceFileError(invalid, kind) ?? "参考素材不符合要求")
      window.setTimeout(() => setUploadError(""), 3200)
      return []
    }
    setUploadError("")
    return files
  }

  function addImageFiles(files: FileList | File[]) {
    if (disabled) return
    const selected = validFiles(Array.from(files), "image")
    if (!selected.length) return

    if (mode === "frame") {
      const targets = [!firstFrame ? "first" : null, !lastFrame ? "last" : null].filter(
        (target): target is "first" | "last" => Boolean(target)
      )
      const items = selected.slice(0, targets.length).map((file) => makeItem(file, "image"))
      items.forEach((item, index) => {
        if (targets[index] === "first") setFirstFrame(item)
        else setLastFrame(item)
      })
      queueMicrotask(() => items.forEach((item) => void upload(item)))
      return
    }

    if (mode !== "media") return
    const imageCount = references.filter((item) => item.kind === "image").length
    const remaining = Math.min(maxImages - imageCount, 12 - references.length)
    const items = selected.slice(0, Math.max(0, remaining)).map((file) => makeItem(file, "image"))
    if (!items.length) return
    setReferences((current) => [...current, ...items])
    queueMicrotask(() => items.forEach((item) => void upload(item)))
  }

  useImperativeHandle(ref, () => ({ addImageFiles }))

  function handleFiles(files: FileList | null) {
    const request = pickerRequestRef.current
    pickerRequestRef.current = null
    if (!request || !files?.length) return

    if (request.target) {
      const item = makeItem(files[0]!, "image")
      if (request.target === "first") {
        release(firstFrame)
        setFirstFrame(item)
      } else {
        release(lastFrame)
        setLastFrame(item)
      }
      queueMicrotask(() => void upload(item))
      return
    }

    if (request.replaceId) {
      const previous = references.find((item) => item.id === request.replaceId)
      if (!previous) return
      const item = makeItem(files[0]!, request.kind)
      release(previous)
      setReferences((current) =>
        current.map((entry) => (entry.id === request.replaceId ? item : entry))
      )
      queueMicrotask(() => void upload(item))
      return
    }

    const imageCount = references.filter((item) => item.kind === "image").length
    const videoCount = references.filter((item) => item.kind === "video").length
    const audioCount = references.filter((item) => item.kind === "audio").length
    const remaining = request.kind === "image"
      ? maxImages - imageCount
      : request.kind === "video" ? maxVideos - videoCount : maxAudios - audioCount
    const selected = validFiles(Array.from(files).slice(0, Math.max(0, remaining)), request.kind)
    const items = selected.map((file) => makeItem(file, request.kind))
    if (!items.length) return
    setReferences((current) => [...current, ...items])
    queueMicrotask(() => items.forEach((item) => void upload(item)))
  }

  function remove(item: ReferenceUploadItem) {
    release(item)
    setReferences((current) => current.filter((entry) => entry.id !== item.id))
  }

  const imageCount = references.filter((item) => item.kind === "image").length
  const videoCount = references.filter((item) => item.kind === "video").length
  const audioCount = references.filter((item) => item.kind === "audio").length

  if (mode === "text") return null

  return (
    <section className={styles.referenceBar} aria-label={mode === "frame" ? "首尾帧参考素材" : "全能参考素材"}>
      <input
        ref={inputRef}
        className={styles.hiddenFileInput}
        type="file"
        onChange={(event) => handleFiles(event.target.files)}
        tabIndex={-1}
      />
      {uploadError ? <p className={styles.referenceError} role="alert">{uploadError}</p> : null}

      {mode === "frame" ? (
        <div className={styles.referenceShelf}>
            <ReferenceThumbnail
              label="首帧"
              item={firstFrame}
              onActivate={() => openPicker("image", "first")}
              onRemove={() => {
                release(firstFrame)
                setFirstFrame(null)
              }}
              onRetry={() => firstFrame && void upload(firstFrame)}
            />
            <ReferenceThumbnail
              label="尾帧"
              item={lastFrame}
              onActivate={() => openPicker("image", "last")}
              onRemove={() => {
                release(lastFrame)
                setLastFrame(null)
              }}
              onRetry={() => lastFrame && void upload(lastFrame)}
            />
        </div>
      ) : null}

      {mode === "media" ? (
        <div className={`${styles.referenceShelf} ${references.length ? styles.shelfWithItems : ""}`}>
            {references.map((item, index) => {
              const kindIndex = references.slice(0, index + 1).filter((entry) => entry.kind === item.kind).length
              return (
              <ReferenceThumbnail
                key={item.id}
                label={item.kind === "image" ? "参考图" : item.kind === "video" ? "参考视频" : "参考音频"}
                item={item}
                index={kindIndex}
                onActivate={() => openPicker(item.kind, undefined, item.id)}
                onRemove={() => remove(item)}
                onRetry={() => void upload(item)}
              />
              )
            })}
            <AddTile
              label="图片"
              count={imageCount}
              limit={maxImages}
              icon="image"
              disabled={disabled || imageCount >= maxImages || references.length >= 12}
              onClick={() => openPicker("image")}
            />
            {allowVideo ? (
              <AddTile
                label="视频"
                count={videoCount}
                limit={maxVideos}
                icon="video"
                disabled={disabled || videoCount >= maxVideos || references.length >= 12}
                onClick={() => openPicker("video")}
              />
            ) : null}
            {allowAudio ? (
              <AddTile
                label="音频"
                count={audioCount}
                limit={maxAudios}
                icon="audio"
                disabled={disabled || audioCount >= maxAudios || references.length >= 12}
                onClick={() => openPicker("audio")}
              />
            ) : null}
        </div>
      ) : null}
    </section>
  )
})

function AddTile({
  label,
  count,
  limit,
  icon,
  disabled,
  onClick,
}: {
  label: string
  count: number
  limit: number
  icon: ReferenceKind
  disabled: boolean
  onClick: () => void
}) {
  const Icon = icon === "image" ? ImageIcon : icon === "video" ? Film : AudioLines
  return (
    <button
      type="button"
      className={`${styles.referenceTile} ${styles.referenceAdd}`}
      disabled={disabled}
      onClick={onClick}
      title={`添加${label}参考，已添加 ${count}/${limit}`}
      aria-label={`添加${label}参考，已添加 ${count}/${limit}`}
    >
      <Icon size={18} />
      <small>{count}/{limit}</small>
    </button>
  )
}
