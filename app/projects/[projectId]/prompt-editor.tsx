"use client"

/* eslint-disable @next/next/no-img-element -- Reference previews use local object URLs. */

import { useEffect, useRef, useState } from "react"

import type { ReferenceKind, ReferenceUploadItem } from "./reference-upload-types"
import styles from "./prompt-editor.module.css"

export type PromptReference = ReferenceUploadItem & { label: string }

type Props = {
  value: string
  onChange: (value: string) => void
  references: PromptReference[]
  placeholder: string
  disabled?: boolean
  maxLength?: number
}

function serialize(root: HTMLElement) {
  const parts: string[] = []
  const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT)
  let current: Node | null = walker.nextNode()
  while (current) {
    if (current instanceof HTMLElement && current.dataset.mention) {
      parts.push(current.dataset.mention)
      current = walker.nextNode()
      while (current && current.parentElement?.closest("[data-mention]")) current = walker.nextNode()
      continue
    }
    if (current.nodeType === Node.TEXT_NODE) parts.push(current.textContent ?? "")
    current = walker.nextNode()
  }
  return parts.join("").replace(/\u00a0/g, " ")
}

function referenceLabel(kind: ReferenceKind, index: number) {
  return `${kind === "image" ? "图片" : kind === "video" ? "视频" : "音频"}${index}`
}

export function PromptEditor({ value, onChange, references, placeholder, disabled = false, maxLength = 5000 }: Props) {
  const editorRef = useRef<HTMLDivElement>(null)
  const pendingRangeRef = useRef<Range | null>(null)
  const lastValueRef = useRef(value)
  const [menuOpen, setMenuOpen] = useState(false)

  function addToken(root: HTMLElement, reference: PromptReference, range: Range, notify = true) {
    range.deleteContents()
    const token = document.createElement("span")
    token.className = styles.token
    token.contentEditable = "false"
    token.dataset.mention = `@${reference.label}`
    token.setAttribute("aria-label", `引用${reference.label}`)
    if (reference.kind === "image") {
      const image = document.createElement("img")
      image.src = reference.previewUrl
      image.alt = ""
      token.append(image)
    } else if (reference.kind === "video") {
      const video = document.createElement("video")
      video.src = reference.previewUrl
      video.muted = true
      video.playsInline = true
      token.append(video)
    } else {
      const icon = document.createElement("span")
      icon.className = styles.tokenIcon
      icon.textContent = "♫"
      token.append(icon)
    }
    const text = document.createElement("span")
    text.textContent = reference.label
    token.append(text)
    range.insertNode(token)
    const spacer = document.createTextNode(" ")
    token.after(spacer)
    const selection = window.getSelection()
    const nextRange = document.createRange()
    nextRange.setStart(spacer, spacer.length)
    nextRange.collapse(true)
    selection?.removeAllRanges()
    selection?.addRange(nextRange)
    lastValueRef.current = serialize(root)
    if (notify) onChange(lastValueRef.current)
  }

  function syncValue(nextValue: string) {
    const root = editorRef.current
    if (!root) return
    root.replaceChildren()
    const pattern = /@(图片|视频|音频)(\d+)/g
    let cursor = 0
    let match: RegExpExecArray | null
    while ((match = pattern.exec(nextValue))) {
      const currentMatch = match
      root.append(document.createTextNode(nextValue.slice(cursor, currentMatch.index)))
      const kind = currentMatch[1] === "图片" ? "image" : currentMatch[1] === "视频" ? "video" : "audio"
      const reference = references.find((item) => item.kind === kind && item.label === `${currentMatch[1]}${currentMatch[2]}`)
      if (reference) {
        const range = document.createRange()
        range.selectNodeContents(root)
        range.collapse(false)
        addToken(root, reference, range, false)
      } else root.append(document.createTextNode(currentMatch[0]))
      cursor = currentMatch.index + currentMatch[0].length
    }
    root.append(document.createTextNode(nextValue.slice(cursor)))
  }

  useEffect(() => {
    if (value === lastValueRef.current) return
    lastValueRef.current = value
    syncValue(value)
  // References are needed to resolve tokens after an upload finishes.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [value, references])

  useEffect(() => {
    if (editorRef.current && !editorRef.current.childNodes.length && value) syncValue(value)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  function handleKeyDown(event: React.KeyboardEvent<HTMLDivElement>) {
    if (disabled || event.key !== "@") return
    event.preventDefault()
    const selection = window.getSelection()
    pendingRangeRef.current = selection?.rangeCount ? selection.getRangeAt(0).cloneRange() : null
    setMenuOpen(true)
  }

  function choose(reference: PromptReference) {
    const root = editorRef.current
    const range = pendingRangeRef.current
    if (!root || !range) return
    addToken(root, reference, range)
    pendingRangeRef.current = null
    setMenuOpen(false)
    root.focus()
  }

  return (
    <div className={styles.wrapper}>
      <div
        ref={editorRef}
        className={styles.editor}
        contentEditable={!disabled}
        data-placeholder={placeholder}
        data-prompt-input
        role="textbox"
        aria-multiline="true"
        aria-label="提示词"
        suppressContentEditableWarning
        onKeyDown={handleKeyDown}
        onInput={(event) => {
          const next = serialize(event.currentTarget)
          if (next.length > maxLength) return
          lastValueRef.current = next
          onChange(next)
        }}
        onFocus={() => setMenuOpen(false)}
      />
      {menuOpen ? (
        <div className={styles.menu} role="listbox" aria-label="引用素材">
          {references.map((reference) => (
            <button key={reference.id} type="button" className={styles.option} onMouseDown={(event) => event.preventDefault()} onClick={() => choose(reference)} disabled={reference.state !== "ready"}>
              {reference.kind === "image" ? <img src={reference.previewUrl} alt="" /> : reference.kind === "video" ? <video src={reference.previewUrl} muted playsInline /> : <span className={styles.optionIcon}>♫</span>}
              <span>{reference.label}</span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  )
}

export function buildPromptReferences(items: ReferenceUploadItem[]) {
  const counts = { image: 0, video: 0, audio: 0 }
  return items.map((item) => {
    counts[item.kind] += 1
    return { ...item, label: referenceLabel(item.kind, counts[item.kind]) }
  })
}
