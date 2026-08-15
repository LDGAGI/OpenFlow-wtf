"use client"

/* eslint-disable @next/next/no-img-element -- OPFS object URLs are local previews. */

import { useEffect, useState } from "react"
import { Check, Copy, RotateCcw, X } from "lucide-react"

import type { ImageGenerationSnapshot, LocalMediaItem } from "@/lib/local-files/media-index"
import { readStoredMedia } from "@/lib/local-files/opfs-media"

import styles from "./media-details.module.css"

export function MediaDetails({
  item,
  onClose,
  onReuse,
}: {
  item: LocalMediaItem
  onClose: () => void
  onReuse: (item: LocalMediaItem) => void
}) {
  const snapshot = item.requestSnapshot
  const [copied, setCopied] = useState(false)
  const prompt = snapshot?.prompt ?? item.prompt

  async function copyPrompt() {
    await navigator.clipboard.writeText(prompt)
    setCopied(true)
    window.setTimeout(() => setCopied(false), 1400)
  }

  return (
    <aside className={styles.panel} aria-label="图片详情">
      <header className={styles.header}>
        <strong>图片详情</strong>
        <button className={styles.iconButton} onClick={onClose} title="关闭详情" aria-label="关闭详情"><X size={16} /></button>
      </header>
      <div className={styles.body}>
        <section className={styles.group}>
          <div className={styles.groupTitle}>提示词 <button className={styles.copyButton} onClick={() => void copyPrompt()} title="复制提示词" aria-label="复制提示词">{copied ? <Check size={13} /> : <Copy size={13} />}</button></div>
          <p className={styles.prompt}>{prompt}</p>
        </section>
        {snapshot?.references.length ? <ReferenceGroup references={snapshot.references} /> : null}
        <section className={styles.group}>
          <div className={styles.groupTitle}>生成参数</div>
          <dl className={styles.specs}>
            <dt>模型</dt><dd>{snapshot?.model.label ?? snapshot?.model.model ?? item.modelKey}</dd>
            <dt>来源</dt><dd>自有 API</dd>
            <dt>画幅</dt><dd>{snapshot?.ratio ?? "未记录"}</dd>
            <dt>清晰度</dt><dd>{snapshot?.resolution ?? "未记录"}</dd>
            <dt>质量</dt><dd>{snapshot?.quality ?? "未记录"}</dd>
            <dt>背景</dt><dd>{snapshot?.background ?? "未记录"}</dd>
            <dt>格式</dt><dd>{snapshot?.outputFormat?.toUpperCase() ?? "未记录"}</dd>
          </dl>
        </section>
        <section className={styles.group}>
          <div className={styles.groupTitle}>生成信息</div>
          <dl className={styles.specs}>
            <dt>状态</dt><dd>{item.status === "failed" ? "失败" : item.status === "saving" ? "保存中" : "已完成"}</dd>
            <dt>时间</dt><dd>{new Intl.DateTimeFormat("zh-CN", { month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit" }).format(new Date(snapshot?.createdAt ?? item.createdAt))}</dd>
            <dt>本地原图</dt><dd>{item.localMediaKey ? "已保存" : "未保存"}</dd>
          </dl>
        </section>
      </div>
      <footer className={styles.footer}>
        <button className="button button-primary" onClick={() => onReuse(item)}><RotateCcw size={14} />复用到输入区</button>
      </footer>
    </aside>
  )
}

function ReferenceGroup({ references }: { references: ImageGenerationSnapshot["references"] }) {
  const [items, setItems] = useState<{ name: string; url: string }[]>([])
  useEffect(() => {
    let cancelled = false
    const urls: string[] = []
    void Promise.all(references.map(async (reference) => {
      const file = await readStoredMedia(reference.thumbnailKey ?? reference.localMediaKey)
      if (!file) return null
      const url = URL.createObjectURL(file)
      urls.push(url)
      return { name: reference.name, url }
    })).then((next) => { if (!cancelled) setItems(next.flatMap((item) => item ? [item] : [])) })
    return () => { cancelled = true; urls.forEach((url) => URL.revokeObjectURL(url)) }
  }, [references])
  return (
    <section className={styles.group}>
      <div className={styles.groupTitle}>参考图片 <span className={styles.muted}>{items.length}/{references.length}</span></div>
      <div className={styles.references}>{items.map((item) => <img key={item.url} src={item.url} alt={item.name} title={item.name} />)}</div>
    </section>
  )
}
