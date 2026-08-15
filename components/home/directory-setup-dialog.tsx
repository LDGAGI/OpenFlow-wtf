"use client"

import { useState } from "react"
import { FolderOpen } from "lucide-react"

import { chooseMediaDirectory } from "@/lib/local-files/directory"

import styles from "./directory-setup-dialog.module.css"

export function DirectorySetupDialog({
  onDone,
  onCancel,
}: {
  /** 授权成功或选择"暂不选择"时触发 */
  onDone: () => void
  onCancel: () => void
}) {
  const [choosing, setChoosing] = useState(false)
  const [error, setError] = useState("")

  async function choose() {
    if (choosing) return
    setChoosing(true)
    setError("")
    try {
      // 必须在点击手势内直接发起目录选择
      await chooseMediaDirectory()
      onDone()
    } catch (err) {
      if ((err as DOMException).name !== "AbortError") {
        setError("目录授权失败，请重试")
      }
    } finally {
      setChoosing(false)
    }
  }

  return (
    <div
      className={styles.dialogBackdrop}
      role="presentation"
      onMouseDown={(event) => {
        if (event.currentTarget === event.target && !choosing) onCancel()
      }}
    >
      <section
        className={styles.directoryDialog}
        role="dialog"
        aria-modal="true"
        aria-labelledby="directory-dialog-title"
      >
        <div className={styles.iconWrap}>
          <FolderOpen size={22} />
        </div>
        <div>
          <h2 id="directory-dialog-title">选择本地媒体目录</h2>
          <p>
            每个项目会在所选目录下创建独立的文件夹（内含 images/ 与
            videos/）；文件只保存在你的本机，不上传服务器。
          </p>
        </div>
        {error ? <p className="error">{error}</p> : null}
        <div className={styles.dialogActions}>
          <button className="button" type="button" disabled={choosing} onClick={onCancel}>
            取消
          </button>
          <button className="button" type="button" disabled={choosing} onClick={onDone}>
            暂不选择
          </button>
          <button
            className="button button-primary"
            type="button"
            disabled={choosing}
            onClick={() => void choose()}
          >
            {choosing ? "等待授权…" : "选择目录"}
          </button>
        </div>
      </section>
    </div>
  )
}
