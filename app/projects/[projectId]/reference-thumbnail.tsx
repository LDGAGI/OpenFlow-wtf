/* eslint-disable @next/next/no-img-element -- Local object URLs provide immediate upload previews. */

import { CircleAlert, ImageIcon, LoaderCircle, Music2, RotateCw, X } from "lucide-react"

import type { ReferenceUploadItem } from "./reference-upload-types"
import styles from "./reference-thumbnail.module.css"

export function ReferenceThumbnail({
  item,
  label,
  index,
  onActivate,
  onMention,
  onRemove,
  onRetry,
}: {
  item: ReferenceUploadItem | null
  label: string
  index?: number
  onActivate?: () => void
  onMention?: () => void
  onRemove?: () => void
  onRetry?: () => void
}) {
  return (
    <div className={styles.tile} data-state={item?.state ?? "empty"} title={item?.error ?? item?.name ?? label}>
      <button
        type="button"
        className={styles.preview}
        disabled={!onActivate && !onMention}
        onClick={onMention ?? onActivate}
        aria-label={item && onMention ? `在提示词中引用${label}` : item ? `替换${label}` : `添加${label}`}
      >
        {item?.kind === "image" ? <img src={item.previewUrl} alt={item.name} /> : null}
        {item?.kind === "video" ? <video src={item.previewUrl} muted playsInline /> : null}
        {item?.kind === "audio" ? <Music2 size={20} /> : null}
        {!item ? <ImageIcon size={20} /> : null}
        {item?.state === "uploading" ? <span className={styles.overlay}><LoaderCircle size={17} /></span> : null}
        {item?.state === "failed" ? <span className={styles.overlay}><CircleAlert size={17} /></span> : null}
      </button>
      {item && index !== undefined ? <span className={styles.indexBadge}>{index}</span> : null}
      <span className={styles.label}>{label}</span>
      {item && onRemove ? (
        <button type="button" className={styles.remove} onClick={onRemove} title={`移除${label}`} aria-label={`移除${label} ${item.name}`}>
          <X size={14} />
        </button>
      ) : null}
      {item?.state === "failed" && onRetry ? (
        <button type="button" className={styles.retry} onClick={onRetry} title="重试上传" aria-label={`重试上传 ${item.name}`}>
          <RotateCw size={12} />
        </button>
      ) : null}
    </div>
  )
}
