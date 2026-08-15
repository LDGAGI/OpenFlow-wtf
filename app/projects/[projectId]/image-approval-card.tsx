"use client"

import { Check, ChevronDown, ImageIcon, LoaderCircle, Minus, Plus, RotateCcw } from "lucide-react"

import type { ChatImageToolContext, ImageGenerationApproval } from "@/lib/chat-image-tools"
import { imageModelFamilyKey, imageModelResolution } from "@/lib/image-model-families"

import styles from "./image-approval-card.module.css"

export function ImageApprovalCard({ approval, context, onChange, onSubmit }: {
  approval: ImageGenerationApproval
  context: ChatImageToolContext
  onChange: (approval: ImageGenerationApproval) => void
  onSubmit: () => void
}) {
  const model = context.models.find((item) => item.model === approval.modelOption.model && item.source === approval.modelOption.source) ?? context.models[0]
  if (!model) return null
  const locked = approval.status === "submitting" || approval.status === "submitted"
  const summary = [ `${approval.count} 张`, approval.aspectRatio, approval.resolution, approval.quality, approval.background, approval.outputFormat?.toUpperCase() ].filter(Boolean).join(" · ")
  function update(patch: Partial<ImageGenerationApproval>) {
    onChange({ ...approval, ...patch, status: "draft", error: undefined })
  }
  return (
    <section className={styles.card} data-status={approval.status}>
      <div className={styles.header}>
        <span className={styles.title}><ImageIcon size={14} />生成图片</span>
        <span className={styles.cost}>自有 API</span>
      </div>
      {approval.status === "submitted" ? (
        <div className={styles.submitted}><Check size={14} /><span>{summary}</span></div>
      ) : (
        <>
          <label className={styles.modelField}>
            <span className={styles.srOnly}>图片模型</span>
            <select
              value={`${approval.modelOption.source}:${approval.modelOption.model}`}
              disabled={locked}
              onChange={(event) => {
                const next = context.models.find((item) => `${item.source}:${item.model}` === event.target.value)
                if (!next) return
                update({
                  modelOption: next,
                  model: next.model,
                  aspectRatio: next.aspectRatios.includes(approval.aspectRatio ?? "") ? approval.aspectRatio : next.aspectRatios[0],
                  resolution: next.resolutions.includes(approval.resolution!) ? approval.resolution : next.resolutions[0],
                  quality: next.qualities.includes(approval.quality!) ? approval.quality : next.qualities[0],
                  background: next.backgrounds.includes(approval.background!) ? approval.background : next.backgrounds[0],
                  outputFormat: next.outputFormats.includes(approval.outputFormat!) ? approval.outputFormat : next.outputFormats[0],
                })
              }}
            >
              {context.models.map((item) => <option key={`${item.source}:${item.model}`} value={`${item.source}:${item.model}`}>{item.label}</option>)}
            </select>
            <ChevronDown size={13} />
          </label>
          <div className={styles.controls}>
            <div className={styles.ratios} aria-label="图片比例">
              {model.aspectRatios.map((ratio) => (
                <button type="button" key={ratio} disabled={locked} data-active={approval.aspectRatio === ratio} onClick={() => update({ aspectRatio: ratio })} title={ratio} aria-label={`比例 ${ratio}`}>
                  <span className={styles.ratioGlyph} style={{ aspectRatio: ratio.replace(":", " / ") }} />
                  <span>{ratio}</span>
                </button>
              ))}
            </div>
            {model.resolutions.length ? <div className={styles.resolutions} role="group" aria-label="分辨率">
              {[...new Set(context.models.filter((item) => item.source === model.source && imageModelFamilyKey(item.model) === imageModelFamilyKey(model.model)).flatMap((item) => item.resolutions))].map((resolution) => <button type="button" key={resolution} disabled={locked} data-active={approval.resolution === resolution} onClick={() => {
                const family = imageModelFamilyKey(model.model)
                const next = family ? context.models.find((item) => item.source === model.source && imageModelFamilyKey(item.model) === family && imageModelResolution(item.model) === resolution) : model
                update({ resolution, ...(next ? { model: next.model, modelOption: next } : {}) })
              }}>{resolution}</button>)}
            </div> : null}
            {model.qualities.length ? <div className={styles.resolutions} role="group" aria-label="质量">
              {model.qualities.map((value) => <button type="button" key={value} disabled={locked} data-active={approval.quality === value} onClick={() => update({ quality: value })} title={`质量 ${value}`}>{value[0].toUpperCase()}</button>)}
            </div> : null}
            {model.backgrounds.length ? <label className={styles.compactField}><span>背景</span><select disabled={locked} value={approval.background} onChange={(event) => update({ background: event.target.value as ImageGenerationApproval["background"] })}>{model.backgrounds.map((value) => <option key={value} value={value}>{value}</option>)}</select></label> : null}
            {model.outputFormats.length > 1 ? <div className={styles.resolutions} role="group" aria-label="输出格式">
              {model.outputFormats.map((value) => <button type="button" key={value} disabled={locked} data-active={approval.outputFormat === value} onClick={() => update({ outputFormat: value })}>{value.toUpperCase()}</button>)}
            </div> : null}
            <div className={styles.stepper} aria-label="图片数量">
              <button type="button" disabled={locked || approval.count <= 1} onClick={() => update({ count: approval.count - 1 })} title="减少数量" aria-label="减少数量"><Minus size={12} /></button>
              <span>{approval.count}</span>
              <button type="button" disabled={locked || approval.count >= 9} onClick={() => update({ count: approval.count + 1 })} title="增加数量" aria-label="增加数量"><Plus size={12} /></button>
            </div>
          </div>
          {approval.error ? <p className={styles.error}>{approval.error}</p> : null}
          <div className={styles.actions}>
            <button type="button" className={styles.submit} disabled={locked} onClick={onSubmit}>
              {approval.status === "submitting" ? <LoaderCircle size={14} className={styles.spin} /> : approval.status === "failed" ? <RotateCcw size={14} /> : <ImageIcon size={14} />}
              {approval.status === "failed" ? "重试" : "生成"}
            </button>
          </div>
        </>
      )}
    </section>
  )
}
