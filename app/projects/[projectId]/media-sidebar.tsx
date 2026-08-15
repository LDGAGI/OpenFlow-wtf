"use client"

/* eslint-disable @next/next/no-img-element -- Provider media is intentionally rendered from direct URLs. */

import Link from "next/link"
import { useEffect, useRef, useState } from "react"
import { AlertCircle, ArrowLeft, ChevronLeft, ChevronRight, Clock3, FolderOpen, ImageIcon, LayoutGrid, List, LoaderCircle, PanelLeftClose, PanelLeftOpen, Video } from "lucide-react"

import { ResizeHandle } from "@/components/ui/resize-handle"
import type { LocalMediaItem } from "@/lib/local-files/media-index"
import { readStoredMedia } from "@/lib/local-files/opfs-media"

import styles from "./media-sidebar.module.css"
import { HISTORY_IMAGE_DRAG_TYPE, type Kind, type MediaPage } from "./workbench-types"

type DirectoryState = "unsupported" | "disconnected" | "connected"

const WIDTH_KEY = "openflow.sidebar.width"
const COLLAPSED_KEY = "openflow.sidebar.collapsed"
const MIN_WIDTH = 200
const MAX_WIDTH = 480
const DEFAULT_WIDTH = 272
const SPLIT_KEY = "openflow.media-sidebar.image-ratio"
const MIN_SECTION_HEIGHT = 150

function startImageDrag(event: React.DragEvent, item: LocalMediaItem) {
  event.dataTransfer.effectAllowed = "copy"
  event.dataTransfer.setData(HISTORY_IMAGE_DRAG_TYPE, item.id)
}

function HistoryImage({ item, alt }: { item: LocalMediaItem; alt: string }) {
  const [localUrl, setLocalUrl] = useState<string | null>(null)
  useEffect(() => {
    const key = item.thumbnailKey ?? item.localMediaKey
    if (!key) return
    let cancelled = false
    let objectUrl: string | null = null
    void readStoredMedia(key).then((file) => {
      if (!file) return
      objectUrl = URL.createObjectURL(file)
      if (cancelled) {
        URL.revokeObjectURL(objectUrl)
        return
      }
      setLocalUrl(objectUrl)
    })
    return () => {
      cancelled = true
      if (objectUrl) URL.revokeObjectURL(objectUrl)
    }
  }, [item.localMediaKey, item.thumbnailKey])

  const source = localUrl || item.remoteUrl
  if (!source) {
    const pending = item.status === "submitting" || item.status === "queued" || item.status === "running" || item.status === "saving"
    return (
      <span className={styles.imagePlaceholder} data-state={item.status ?? "empty"} aria-label={item.status === "failed" ? "生成失败" : pending ? "图片生成中" : alt || "图片加载中"}>
        {item.status === "failed" ? <AlertCircle size={16} aria-hidden="true" /> : item.status === "queued" ? <Clock3 size={16} aria-hidden="true" /> : pending ? <LoaderCircle className={styles.placeholderSpin} size={16} aria-hidden="true" /> : <ImageIcon size={16} aria-hidden="true" />}
      </span>
    )
  }

  return <img src={source} alt={alt} />
}

type Props = {
  projectTitle: string
  directoryState: DirectoryState
  onConnectDirectory: () => void
  images: MediaPage
  videos: MediaPage
  imagePage: number
  videoPage: number
  setImagePage: (page: number) => void
  setVideoPage: (page: number) => void
  selected: LocalMediaItem | null
  onSelect: (item: LocalMediaItem) => void
}

export function MediaSidebar({
  projectTitle,
  directoryState,
  onConnectDirectory,
  images,
  videos,
  imagePage,
  videoPage,
  setImagePage,
  setVideoPage,
  selected,
  onSelect,
}: Props) {
  const [collapsed, setCollapsed] = useState(false)
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const [splitRatio, setSplitRatio] = useState(0.5)
  const dragBase = useRef(DEFAULT_WIDTH)
  const splitDragBase = useRef({ height: 0, imageHeight: 0 })
  const mediaBodyRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    const timer = window.setTimeout(() => {
      setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === "1")
      const saved = Number(window.localStorage.getItem(WIDTH_KEY))
      if (saved >= MIN_WIDTH && saved <= MAX_WIDTH) setWidth(saved)
      const savedRatio = Number(window.localStorage.getItem(SPLIT_KEY))
      if (savedRatio >= 0.2 && savedRatio <= 0.8) setSplitRatio(savedRatio)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [])

  function toggleCollapsed() {
    setCollapsed((current) => {
      window.localStorage.setItem(COLLAPSED_KEY, current ? "0" : "1")
      return !current
    })
  }

  function resize(deltaX: number) {
    const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragBase.current + deltaX))
    setWidth(next)
    window.localStorage.setItem(WIDTH_KEY, String(next))
  }

  function startSectionResize() {
    const height = Math.max(0, (mediaBodyRef.current?.clientHeight ?? 0) - 9)
    splitDragBase.current = { height, imageHeight: height * splitRatio }
  }

  function resizeSections(deltaY: number) {
    const { height, imageHeight } = splitDragBase.current
    if (height <= MIN_SECTION_HEIGHT * 2) return
    const nextHeight = Math.min(height - MIN_SECTION_HEIGHT, Math.max(MIN_SECTION_HEIGHT, imageHeight + deltaY))
    const nextRatio = nextHeight / height
    setSplitRatio(nextRatio)
    window.localStorage.setItem(SPLIT_KEY, String(nextRatio))
  }

  const directoryTitle =
    directoryState === "connected"
      ? "本地媒体已连接，点击重新授权"
      : directoryState === "unsupported"
        ? "浏览器不支持本地目录"
        : "连接本地媒体目录"

  if (collapsed) {
    return (
      <aside className={`${styles.sidebar} ${styles.rail}`}>
        <button type="button" className={styles.railButton} onClick={toggleCollapsed} title="展开侧栏" aria-label="展开侧栏">
          <PanelLeftOpen size={15} />
        </button>
        <div className={styles.railList}>
          {images.items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`${styles.railTile} ${selected?.id === item.id ? styles.railTileActive : ""}`}
              onClick={() => onSelect(item)}
              draggable={Boolean(item.localMediaKey || item.remoteUrl)}
              onDragStart={(event) => startImageDrag(event, item)}
              title={item.prompt}
            >
              <HistoryImage item={item} alt={item.prompt} />
            </button>
          ))}
          {images.items.length && videos.items.length ? <span className={styles.railDivider} /> : null}
          {videos.items.map((item) => (
            <button
              key={item.id}
              type="button"
              className={`${styles.railTile} ${selected?.id === item.id ? styles.railTileActive : ""}`}
              onClick={() => onSelect(item)}
              title={item.prompt}
            >
              <Video size={14} />
            </button>
          ))}
        </div>
      </aside>
    )
  }

  return (
    <aside className={styles.sidebar} style={{ width }}>
      <div className={styles.panelHeader}>
        <Link className={styles.backButton} href="/projects" title="返回项目列表" aria-label="返回项目列表">
          <ArrowLeft size={15} />
        </Link>
        <strong className={styles.projectTitle} title={projectTitle}>{projectTitle}</strong>
        <button
          type="button"
          className={styles.directoryButton}
          onClick={onConnectDirectory}
          disabled={directoryState === "unsupported"}
          title={directoryTitle}
          aria-label={directoryTitle}
        >
          <FolderOpen size={15} />
          <span className={`${styles.directoryDot} ${styles[directoryState]}`} />
        </button>
        <button type="button" className={styles.collapseButton} onClick={toggleCollapsed} title="收起侧栏" aria-label="收起侧栏">
          <PanelLeftClose size={15} />
        </button>
      </div>
      <div
        ref={mediaBodyRef}
        className={styles.mediaBody}
        style={{ gridTemplateRows: `minmax(${MIN_SECTION_HEIGHT}px, ${splitRatio}fr) 9px minmax(${MIN_SECTION_HEIGHT}px, ${1 - splitRatio}fr)` }}
      >
        <MediaSection title="图片历史" kind="image" page={imagePage} setPage={setImagePage} data={images} selected={selected} onSelect={onSelect} />
        <ResizeHandle className={styles.sectionHandle} axis="y" inFlow onStart={startSectionResize} onDrag={resizeSections} />
        <MediaSection title="视频历史" kind="video" page={videoPage} setPage={setVideoPage} data={videos} selected={selected} onSelect={onSelect} />
      </div>
      <ResizeHandle className={styles.handleRight} onStart={() => { dragBase.current = width }} onDrag={resize} />
    </aside>
  )
}

function MediaSection({
  title,
  kind,
  page,
  setPage,
  data,
  selected,
  onSelect,
}: {
  title: string
  kind: Kind
  page: number
  setPage: (page: number) => void
  data: MediaPage
  selected: LocalMediaItem | null
  onSelect: (item: LocalMediaItem) => void
}) {
  const [layout, setLayout] = useState<"list" | "grid">("grid")

  useEffect(() => {
    const timer = window.setTimeout(() => {
      const saved = window.localStorage.getItem(`openflow.media-sidebar.${kind}-layout`)
      if (saved === "list" || saved === "grid") setLayout(saved)
    }, 0)
    return () => window.clearTimeout(timer)
  }, [kind])

  function changeLayout(next: "list" | "grid") {
    setLayout(next)
    window.localStorage.setItem(`openflow.media-sidebar.${kind}-layout`, next)
  }

  return (
    <section className={styles.section}>
      <div className={styles.sectionHeader}>
        <h2>{title}</h2>
        <span className={styles.count}>{data.total}</span>
        <div className={styles.layoutToggle} role="group" aria-label="切换布局">
          <button
            type="button"
            className={layout === "list" ? styles.layoutActive : ""}
            onClick={() => changeLayout("list")}
            title="列表布局"
            aria-label="列表布局"
            aria-pressed={layout === "list"}
          >
            <List size={13} />
          </button>
          <button
            type="button"
            className={layout === "grid" ? styles.layoutActive : ""}
            onClick={() => changeLayout("grid")}
            title="宫格布局"
            aria-label="宫格布局"
            aria-pressed={layout === "grid"}
          >
            <LayoutGrid size={13} />
          </button>
        </div>
      </div>

      {data.items.length ? (
        <div className={layout === "grid" ? styles.mediaGrid : styles.mediaList}>
          {data.items.map((item) =>
            layout === "grid" ? (
              <button
                key={item.id}
                type="button"
                className={`${styles.tile} ${selected?.id === item.id ? styles.tileActive : ""}`}
                onClick={() => onSelect(item)}
                draggable={kind === "image" && Boolean(item.localMediaKey || item.remoteUrl)}
                onDragStart={kind === "image" ? (event) => startImageDrag(event, item) : undefined}
                title={item.prompt}
              >
                {kind === "image" ? <HistoryImage item={item} alt={item.prompt} /> : item.remoteUrl ? (
                  <>
                    <video src={item.remoteUrl} muted playsInline preload="metadata" />
                    <span className={styles.videoBadge}><Video size={12} /></span>
                  </>
                ) : <Video size={18} />}
              </button>
            ) : (
              <button
                key={item.id}
                type="button"
                className={`${styles.mediaRow} ${selected?.id === item.id ? styles.mediaRowActive : ""}`}
                onClick={() => onSelect(item)}
                draggable={kind === "image" && Boolean(item.localMediaKey || item.remoteUrl)}
                onDragStart={kind === "image" ? (event) => startImageDrag(event, item) : undefined}
              >
                <div className={styles.mediaThumb}>
                  {kind === "image" ? <HistoryImage item={item} alt="" /> : item.remoteUrl ? <video src={item.remoteUrl} muted playsInline preload="metadata" /> : <Video size={15} />}
                </div>
                <span className={styles.mediaMeta}>
                  <strong>{item.prompt}</strong>
                  <small>{formatTime(item.createdAt)}</small>
                </span>
              </button>
            )
          )}
        </div>
      ) : (
        <div className={styles.mediaList}>
          <div className="empty">暂无{kind === "image" ? "图片" : "视频"}</div>
        </div>
      )}

      <div className={styles.miniPager}>
        <button className="button icon-button" aria-label="上一页" title="上一页" disabled={page <= 1} onClick={() => setPage(page - 1)}>
          <ChevronLeft size={13} />
        </button>
        <span>{page} / {data.totalPages}</span>
        <button className="button icon-button" aria-label="下一页" title="下一页" disabled={page >= data.totalPages} onClick={() => setPage(page + 1)}>
          <ChevronRight size={13} />
        </button>
      </div>
    </section>
  )
}

function formatTime(value: number) {
  return new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(value))
}
