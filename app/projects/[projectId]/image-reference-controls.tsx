"use client"

import { forwardRef, useEffect, useImperativeHandle, useRef, useState } from "react"
import { ImageIcon } from "lucide-react"

import { createClientId } from "@/lib/client-id"
import { inspectReferenceMedia, REFERENCE_ACCEPT, referenceFileError, type ReferenceUploadItem } from "./reference-upload-types"
import { ReferenceThumbnail } from "./reference-thumbnail"
import styles from "./image-reference-controls.module.css"
import referenceStyles from "./video-reference-controls.module.css"

export type ImageReferenceControlsHandle = {
  addFiles: (files: FileList | File[]) => void
  replaceFiles: (files: FileList | File[]) => void
}

export const ImageReferenceControls = forwardRef<ImageReferenceControlsHandle, {
  items: ReferenceUploadItem[]
  setItems: React.Dispatch<React.SetStateAction<ReferenceUploadItem[]>>
  maxItems: number
  disabled: boolean
}>(function ImageReferenceControls({
  items,
  setItems,
  maxItems,
  disabled,
}, ref) {
  const inputRef = useRef<HTMLInputElement>(null)
  const objectUrlsRef = useRef(new Set<string>())
  const controllersRef = useRef(new Set<AbortController>())
  const [uploadError, setUploadError] = useState("")

  useEffect(() => {
    const urls = objectUrlsRef.current
    const controllers = controllersRef.current
    return () => {
      controllers.forEach((controller) => controller.abort())
      urls.forEach((url) => URL.revokeObjectURL(url))
    }
  }, [])

  function update(id: string, patch: Partial<ReferenceUploadItem>) {
    setItems((current) => current.map((item) => item.id === id ? { ...item, ...patch } : item))
  }

  async function upload(item: ReferenceUploadItem) {
    update(item.id, { state: "uploading", error: undefined })
    const controller = new AbortController()
    controllersRef.current.add(controller)
    try {
      const metadata = await inspectReferenceMedia(item.file, "image")
      update(item.id, { metadata })
      const response = await fetch("/api/local/reference-uploads?kind=image", {
        method: "POST",
        headers: { "Content-Type": item.file.type },
        body: item.file,
        signal: controller.signal,
      })
      const data = await response.json() as { upload?: { url: string }; error?: string }
      if (!response.ok || !data.upload?.url) throw new Error(data.error ?? "参考图上传失败")
      update(item.id, { state: "ready", providerUrl: data.upload.url, error: undefined })
    } catch (cause) {
      if ((cause as DOMException).name !== "AbortError") {
        update(item.id, { state: "failed", error: cause instanceof Error ? cause.message : "参考图上传失败" })
      }
    } finally {
      controllersRef.current.delete(controller)
    }
  }

  function add(files: FileList | File[] | null) {
    if (!files || disabled) return
    const allFiles = Array.from(files)
    const invalid = allFiles.find((file) => referenceFileError(file, "image"))
    if (invalid) {
      setUploadError(referenceFileError(invalid, "image") ?? "参考图不符合要求")
      window.setTimeout(() => setUploadError(""), 3200)
      return
    }
    setUploadError("")
    const selected = allFiles.slice(0, Math.max(0, maxItems - items.length))
    const next = selected.map((file): ReferenceUploadItem => {
      const previewUrl = URL.createObjectURL(file)
      objectUrlsRef.current.add(previewUrl)
      return { id: createClientId(), kind: "image", name: file.name, file, previewUrl, state: "uploading" }
    })
    setItems((current) => [...current, ...next])
    queueMicrotask(() => next.forEach((item) => void upload(item)))
  }

  function replace(files: FileList | File[]) {
    items.forEach((item) => {
      URL.revokeObjectURL(item.previewUrl)
      objectUrlsRef.current.delete(item.previewUrl)
    })
    setItems([])
    queueMicrotask(() => add(files))
  }

  useImperativeHandle(ref, () => ({ addFiles: add, replaceFiles: replace }))

  function remove(item: ReferenceUploadItem) {
    URL.revokeObjectURL(item.previewUrl)
    objectUrlsRef.current.delete(item.previewUrl)
    setItems((current) => current.filter((entry) => entry.id !== item.id))
  }

  return (
    <section className={referenceStyles.referenceBar} aria-label="图片参考图">
      <input ref={inputRef} type="file" accept={REFERENCE_ACCEPT.image} multiple hidden onChange={(event) => { add(event.target.files); event.target.value = "" }} />
      {uploadError ? <p className={referenceStyles.referenceError} role="alert">{uploadError}</p> : null}
      <div className={`${referenceStyles.referenceShelf} ${items.length ? styles.shelfWithItems : ""}`}>
        {items.map((item, index) => (
          <ReferenceThumbnail
            key={item.id}
            item={item}
            label="参考图"
            index={index + 1}
            onRemove={() => remove(item)}
            onRetry={() => void upload(item)}
          />
        ))}
        {items.length < maxItems ? (
          <button
            className={`${referenceStyles.referenceTile} ${referenceStyles.referenceAdd}`}
            type="button"
            disabled={disabled}
            onClick={() => inputRef.current?.click()}
            title={`添加图片参考，已添加 ${items.length}/${maxItems}`}
            aria-label={`添加图片参考，已添加 ${items.length}/${maxItems}`}
          >
            <ImageIcon size={18} />
            <small>{items.length}/{maxItems}</small>
          </button>
        ) : null}
      </div>
    </section>
  )
})
