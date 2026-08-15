"use client"

/* eslint-disable @next/next/no-img-element -- Provider media is intentionally rendered from direct URLs. */

import { useEffect, useRef, useState } from "react"
import { AlertCircle, Check, Download, ImageIcon, Info, LoaderCircle, Maximize2, Video, X } from "lucide-react"

import type { LocalMediaItem } from "@/lib/local-files/media-index"
import { readStoredMedia } from "@/lib/local-files/opfs-media"

import styles from "./preview-stage.module.css"
import type { Kind } from "./workbench-types"

type MediaCredentials = { baseUrl: string; apiKey: string }

export function PreviewStage({
  item,
  kind,
  imageCredentials = null,
  videoCredentials = null,
  onSaveLocal,
  onDetails,
}: {
  item: LocalMediaItem | null
  kind: Kind
  /** 访客媒体下载地址需要鉴权时使用的自带凭证 */
  imageCredentials?: MediaCredentials | null
  videoCredentials?: MediaCredentials | null
  onSaveLocal?: (item: LocalMediaItem) => Promise<void>
  onDetails?: (item: LocalMediaItem) => void
}) {
  const viewportRef = useRef<HTMLDivElement>(null)
  const [box, setBox] = useState({ width: 0, height: 0 })

  useEffect(() => {
    const el = viewportRef.current
    if (!el) return
    const observer = new ResizeObserver(([entry]) => {
      if (!entry) return
      setBox({ width: entry.contentRect.width, height: entry.contentRect.height })
    })
    observer.observe(el)
    return () => observer.disconnect()
  }, [])

  return (
    <div
      className={styles.stage}
    >
      <div
        ref={viewportRef}
        className={styles.mediaViewport}
      >
        {item ? (
          <MediaFrame
            key={item.id}
            item={item}
            boxWidth={box.width}
            boxHeight={box.height}
            credentials={item.kind === "image" ? imageCredentials : videoCredentials}
            onSaveLocal={onSaveLocal}
            onDetails={onDetails}
          />
        ) : (
          <div className={styles.empty}>
            {kind === "image" ? <ImageIcon size={24} /> : <Video size={24} />}
            <span>{kind === "image" ? "开始生成图片" : "开始生成视频"}</span>
          </div>
        )}
      </div>
    </div>
  )
}

function MediaFrame({
  item,
  boxWidth,
  boxHeight,
  credentials,
  onSaveLocal,
  onDetails,
}: {
  item: LocalMediaItem
  boxWidth: number
  boxHeight: number
  credentials: MediaCredentials | null
  onSaveLocal?: (item: LocalMediaItem) => Promise<void>
  onDetails?: (item: LocalMediaItem) => void
}) {
  const [ratio, setRatio] = useState<number | null>(null)
  const [localUrl, setLocalUrl] = useState<string | null>(null)
  const [maximized, setMaximized] = useState(false)
  const [saving, setSaving] = useState(false)
  const shouldProxy = Boolean(credentials) && !item.remoteUrl.startsWith("data:")
  const hasPreviewSource = Boolean(item.localMediaKey || item.remoteUrl)
  const pending = item.status === "queued" || item.status === "submitting" || item.status === "running" || (item.status === "saving" && !hasPreviewSource)

  useEffect(() => {
    let objectUrl: string | null = null
    async function load() {
      if (!item.localMediaKey) return
      const file = await readStoredMedia(item.localMediaKey)
      if (!file) return
      objectUrl = URL.createObjectURL(file)
      setLocalUrl(objectUrl)
    }
    void load().catch(() => undefined)
    return () => {
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [item.localMediaKey])

  const fallbackUrl = item.remoteUrl

  if (pending) {
    const ratio = ratioNumber(item.requestSnapshot?.ratio)
    const width = boxWidth > 0 && boxHeight > 0 ? Math.min(boxWidth, boxHeight * ratio) : undefined
    return (
      <div className={styles.pendingFrame} style={width ? { width, height: width / ratio } : { aspectRatio: String(ratio) }}>
        <div className={styles.pendingTrack}><span /></div>
        <div className={styles.pendingCenter}>
          <LoaderCircle size={22} className={styles.spin} />
        </div>
        {onDetails ? <button className={styles.pendingDetails} type="button" onClick={() => onDetails(item)} title="查看详情" aria-label="查看详情"><Info size={14} /></button> : null}
      </div>
    )
  }
  if (item.status === "failed") {
    return (
      <div className={styles.failedFrame} title={item.errorMessage ?? "生成失败"}>
        <AlertCircle size={24} />
        {onDetails ? <button className={styles.failedDetails} type="button" onClick={() => onDetails(item)} title="查看详情" aria-label="查看详情"><Info size={14} /></button> : null}
      </div>
    )
  }

  const mediaUrl = localUrl ?? (shouldProxy || !item.remoteUrl ? null : fallbackUrl)

  if (!mediaUrl) {
    return (
      <div className={styles.empty}>
        <LoaderCircle size={24} className={styles.spin} />
        <span>正在加载媒体…</span>
      </div>
    )
  }

  let frameStyle: React.CSSProperties | undefined
  if (ratio && boxWidth > 0 && boxHeight > 0) {
    const width = Math.min(boxWidth, boxHeight * ratio)
    frameStyle = { width: `${Math.round(width)}px`, height: `${Math.round(width / ratio)}px` }
  }

  return (
    <div className={`${styles.frame} ${ratio ? styles.frameLoaded : ""}`} style={frameStyle}>
      {item.kind === "image" ? (
        <img
          src={mediaUrl}
          alt={item.prompt}
          onLoad={(event) => setRatio(event.currentTarget.naturalWidth / event.currentTarget.naturalHeight)}
        />
      ) : (
        <video
          key={mediaUrl}
          src={mediaUrl}
          controls
          playsInline
          onLoadedMetadata={(event) => setRatio(event.currentTarget.videoWidth / event.currentTarget.videoHeight)}
        />
      )}
      {ratio ? (
        <div className={styles.frameActions}>
          {onDetails ? <button className={styles.frameAction} type="button" onClick={() => onDetails(item)} title="查看详情" aria-label="查看详情"><Info size={14} /></button> : null}
          {onSaveLocal ? <button
            className={styles.frameAction}
            type="button"
            disabled={saving || Boolean(item.localFileName)}
            onClick={() => {
              setSaving(true)
              void onSaveLocal(item).catch(() => undefined).finally(() => setSaving(false))
            }}
            title={item.localFileName ? "已保存到本机" : "保存到本机"}
            aria-label={item.localFileName ? "已保存到本机" : "保存到本机"}
          >
            {item.localFileName ? <Check size={14} /> : saving ? <LoaderCircle size={14} className={styles.spin} /> : <Download size={14} />}
          </button> : null}
          <button className={styles.frameAction} type="button" onClick={() => setMaximized(true)} title="最大化预览" aria-label="最大化预览">
            <Maximize2 size={14} />
          </button>
        </div>
      ) : null}
      {maximized ? <MediaLightbox item={item} mediaUrl={mediaUrl} onClose={() => setMaximized(false)} /> : null}
    </div>
  )
}

function ratioNumber(value?: string) {
  const [width, height] = value?.split(":").map(Number) ?? []
  return width && height ? width / height : 4 / 3
}

function MediaLightbox({ item, mediaUrl, onClose }: { item: LocalMediaItem; mediaUrl: string; onClose: () => void }) {
  const dialogRef = useRef<HTMLDialogElement>(null)

  useEffect(() => {
    const dialog = dialogRef.current
    if (!dialog) return
    dialog.showModal()
    return () => dialog.close()
  }, [])

  return (
    <dialog ref={dialogRef} className={styles.lightbox} onCancel={onClose} onClick={(event) => { if (event.target === event.currentTarget) onClose() }}>
      <button type="button" className={styles.lightboxClose} onClick={onClose} title="关闭预览" aria-label="关闭预览">
        <X size={18} />
      </button>
      <div className={styles.lightboxMedia}>
        {item.kind === "image" ? <img src={mediaUrl} alt={item.prompt} /> : <video src={mediaUrl} controls autoPlay playsInline />}
      </div>
    </dialog>
  )
}
