"use client"

import { useState } from "react"
import { Coins, Cpu, ImageIcon, LoaderCircle, Monitor, Settings, Sparkles, Video } from "lucide-react"

import { AutoTextarea } from "@/components/ui/auto-textarea"
import { Menu, MenuOption, MenuOptionHint } from "@/components/ui/menu"
import {
  IMAGE_FAMILY_RESOLUTIONS,
  IMAGE_MODEL_FAMILIES,
  familySku,
  imageModelFamilyKey,
  imageModelResolution,
  type ImageModelFamilyKey,
} from "@/lib/image-model-families"
import type { ModelOption } from "@/lib/provider-settings"
import { resolveModelCapabilities } from "@/lib/provider-models"
import { PromptEditor, type PromptReference } from "./prompt-editor"

import styles from "./composer.module.css"
import { HISTORY_IMAGE_DRAG_TYPE, IMAGE_RATIOS, type ImageQuality, type ImageRatio, type Kind } from "./workbench-types"

const QUALITIES: Array<{ value: ImageQuality; label: string }> = [
  { value: "low", label: "低" },
  { value: "medium", label: "标准" },
  { value: "high", label: "高" },
]

function ratioValue(ratio: string) {
  const [width, height] = ratio.split(":").map(Number)
  return width / height
}

function sortRatios(ratios: readonly string[]) {
  // 平铺网格按画幅从最宽到最高连续排列，阅读方向即画幅变化方向
  return [...ratios].sort((a, b) => ratioValue(b) - ratioValue(a))
}

function RatioPicker({
  ratios,
  value,
  onChange,
  close,
}: {
  ratios: readonly string[]
  value: string
  onChange: (ratio: string) => void
  close: () => void
}) {
  return (
    <div className={styles.ratioPicker}>
      <span className={styles.ratioTitle}>比例</span>
      <div className={styles.ratioGrid}>
        {sortRatios(ratios).map((item) => (
          <button
            type="button"
            role="menuitemradio"
            aria-checked={item === value}
            className={`${styles.ratioOption} ${item === value ? styles.ratioOptionActive : ""}`}
            key={item}
            onClick={() => { onChange(item); close() }}
          >
            <span className={styles.ratioPreview} aria-hidden="true">
              <span className={styles.ratioGlyph} data-ratio={item} />
            </span>
            <span className={styles.ratioText}>{item}</span>
          </button>
        ))}
      </div>
    </div>
  )
}

/** 模型下拉展示项：独立模型或聚合后的家族（同 source 的 1K/2K/4K SKU 折叠为一项） */
type ModelDisplayItem =
  | { type: "single"; option: ModelOption }
  | { type: "family"; familyKey: ImageModelFamilyKey; label: string; options: ModelOption[] }

function groupModelOptions(options: ModelOption[]): ModelDisplayItem[] {
  const items: ModelDisplayItem[] = []
  const familyIndex = new Map<string, number>()
  for (const option of options) {
    const familyKey = imageModelFamilyKey(option.model)
    if (!familyKey) {
      items.push({ type: "single", option })
      continue
    }
    const groupKey = `${option.source}:${option.connectionId ?? "local"}:${familyKey}`
    const existing = familyIndex.get(groupKey)
    if (existing !== undefined) {
      const group = items[existing]
      if (group.type === "family") group.options.push(option)
      continue
    }
    familyIndex.set(groupKey, items.length)
    items.push({
      type: "family",
      familyKey,
      label: IMAGE_MODEL_FAMILIES.find((family) => family.key === familyKey)?.label ?? familyKey,
      options: [option],
    })
  }
  return items
}

type Props = {
  kind: Kind
  prompt: string
  setPrompt: (prompt: string) => void
  ratio: ImageRatio
  availableRatios?: readonly string[]
  setRatio: (ratio: ImageRatio) => void
  quality: ImageQuality
  setQuality: (quality: ImageQuality) => void
  imageResolution: "1K" | "2K" | "4K"
  setImageResolution: (resolution: "1K" | "2K" | "4K") => void
  modelLabel: string
  /** 当前连接状态提示。 */
  costLabel: string
  /** 可选模型（来源 + 模型）；提供时模型芯片变为可切换下拉 */
  modelOptions?: ModelOption[]
  /** 当前选中项，用于下拉高亮 */
  currentModelOption?: ModelOption
  onModelChange?: (option: ModelOption) => void
  /** 未配置 API：禁用全部输入，仅保留配置引导 */
  needsConfig?: boolean
  onConfigure?: () => void
  generating: boolean
  status: string
  onGenerate: () => void
  videoControls?: React.ReactNode
  referenceControls?: React.ReactNode
  onAddReferenceImages?: (files: FileList | File[]) => void
  onAddHistoryImage?: (id: string) => void
  promptReferences?: PromptReference[]
}

export function Composer({
  kind,
  prompt,
  setPrompt,
  ratio,
  availableRatios,
  setRatio,
  quality,
  setQuality,
  imageResolution,
  setImageResolution,
  modelLabel,
  costLabel,
  modelOptions,
  currentModelOption,
  onModelChange,
  needsConfig = false,
  onConfigure,
  generating,
  status,
  onGenerate,
  videoControls,
  referenceControls,
  onAddReferenceImages,
  onAddHistoryImage,
  promptReferences,
}: Props) {
  const [draggingImages, setDraggingImages] = useState(false)
  const qualityLabel = QUALITIES.find((item) => item.value === quality)?.label ?? "标准"

  // Banana 家族：同 source 的 1K/2K/4K SKU 在模型下拉里聚合为一项，分辨率单独切换（实际切换 SKU）
  const modelDisplayItems = modelOptions ? groupModelOptions(modelOptions) : []
  const currentFamily = currentModelOption ? imageModelFamilyKey(currentModelOption.model) : null
  const currentResolution = currentModelOption ? imageModelResolution(currentModelOption.model) : null
  const currentFamilyGroup = currentFamily
    ? modelDisplayItems.find(
        (item): item is Extract<ModelDisplayItem, { type: "family" }> =>
          item.type === "family" &&
          item.familyKey === currentFamily &&
          item.options[0]?.source === currentModelOption?.source &&
          item.options[0]?.connectionId === currentModelOption?.connectionId
      )
    : undefined
  const familyResolutions = currentFamilyGroup
    ? IMAGE_FAMILY_RESOLUTIONS.filter((resolution) =>
        currentFamilyGroup.options.some(
          (option) => option.model === familySku(currentFamilyGroup.familyKey, resolution)
        )
      )
    : []
  const activeCapabilities = currentModelOption
    ? resolveModelCapabilities({
        kind,
        source: currentModelOption.source,
        model: currentModelOption.model,
        capabilityProfile: currentModelOption.capabilityProfile,
      })
    : null
  const byokResolutions = currentResolution
    ? [currentResolution]
    : activeCapabilities?.kind === "image" ? activeCapabilities.resolutions : []
  const supportsQuality = !activeCapabilities || (activeCapabilities.kind === "image" && activeCapabilities.qualities.length > 0)

  return (
    <div
      className={styles.composer}
      onDragOver={(event) => {
        const hasFiles = event.dataTransfer.types.includes("Files")
        const hasHistoryImage = event.dataTransfer.types.includes(HISTORY_IMAGE_DRAG_TYPE)
        if ((!onAddReferenceImages || !hasFiles) && (!onAddHistoryImage || !hasHistoryImage)) return
        event.preventDefault()
        event.dataTransfer.dropEffect = "copy"
        setDraggingImages(true)
      }}
      onDragLeave={(event) => {
        if (event.currentTarget.contains(event.relatedTarget as Node)) return
        setDraggingImages(false)
      }}
      onDrop={(event) => {
        const historyImageId = event.dataTransfer.getData(HISTORY_IMAGE_DRAG_TYPE)
        if (!historyImageId && !onAddReferenceImages) return
        event.preventDefault()
        setDraggingImages(false)
        if (historyImageId && onAddHistoryImage) {
          onAddHistoryImage(historyImageId)
          return
        }
        onAddReferenceImages?.(event.dataTransfer.files)
      }}
    >
      {referenceControls}
      <div
        className={`${styles.surface} ${draggingImages ? styles.surfaceDragging : ""}`}
      >
        {kind === "video" && promptReferences ? (
          <PromptEditor
            value={prompt}
            onChange={setPrompt}
            references={promptReferences}
            placeholder={needsConfig ? "配置 API 后输入提示词…" : "描述镜头、动作和运镜…"}
            disabled={needsConfig}
            maxLength={5000}
          />
        ) : <AutoTextarea
          className={styles.promptInput}
          value={prompt}
          onChange={(event) => setPrompt(event.target.value)}
          onPaste={(event) => {
            if (!onAddReferenceImages) return
            const images = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"))
            if (!images.length) return
            if (!event.clipboardData.getData("text")) event.preventDefault()
            onAddReferenceImages(images)
          }}
          placeholder={needsConfig ? "配置 API 后输入提示词…" : kind === "image" ? "描述你想生成的画面…" : "描述镜头、动作和运镜…"}
          maxLength={kind === "image" ? 4000 : 5000}
          maxHeight={220}
          disabled={needsConfig}
        />}
        <div className={styles.parameterBar}>
          <div className={styles.parameterControls}>
            {needsConfig ? (
              <button type="button" className={styles.configPrompt} onClick={onConfigure}>
                <Settings size={13} />
                未配置{kind === "image" ? "图片" : "视频"} API，点击配置后使用
              </button>
            ) : kind === "image" ? (
              <>
                {modelOptions?.length ? (
                  <Menu icon={<Cpu size={13} />} label={modelLabel} title="图片模型" menuLabel="图片模型" chevron disabled={generating}>
                    {(close) =>
                      modelDisplayItems.map((item) => {
                        if (item.type === "single") {
                          return (
                            <MenuOption
                              key={`${item.option.source}:${item.option.connectionId ?? "local"}:${item.option.model}`}
                              active={item.option.source === currentModelOption?.source && item.option.connectionId === currentModelOption?.connectionId && item.option.model === currentModelOption?.model}
                              onClick={() => { onModelChange?.(item.option); close() }}
                            >
                              {item.option.label ?? item.option.model}
                              <MenuOptionHint>{item.option.providerLabel ?? "自有"}</MenuOptionHint>
                            </MenuOption>
                          )
                        }
                        // 家族项：首次选择默认 1K；已在家族模型中时保留当前档位。
                        const active = item.options.some(
                          (option) =>
                            option.source === currentModelOption?.source &&
                            option.connectionId === currentModelOption?.connectionId &&
                            option.model === currentModelOption?.model
                        )
                        const target =
                          (currentResolution &&
                            item.options.find(
                              (option) => option.model === familySku(item.familyKey, currentResolution)
                            )) ??
                          item.options.find((option) => option.model === familySku(item.familyKey, "1K")) ??
                          item.options[0]
                        return (
                          <MenuOption
                            key={`${item.options[0]?.source ?? "byok"}:${item.options[0]?.connectionId ?? "local"}:${item.familyKey}`}
                            active={active}
                            onClick={() => { if (target) onModelChange?.(target); close() }}
                          >
                            {item.label}
                            <MenuOptionHint>{item.options[0]?.providerLabel ?? "自有"}</MenuOptionHint>
                          </MenuOption>
                        )
                      })
                    }
                  </Menu>
                ) : (
                  <div className={styles.modelChip} title="图片模型">
                    <Cpu size={13} />
                    {modelLabel}
                  </div>
                )}
                {currentFamily && currentResolution && currentFamilyGroup ? (
                  <Menu icon={<Monitor size={13} />} label={currentResolution} title="清晰度" menuLabel="清晰度" chevron disabled={generating}>
                    {(close) =>
                      familyResolutions.map((resolution) => (
                        <MenuOption
                          key={resolution}
                          active={resolution === currentResolution}
                          onClick={() => {
                            const target = currentFamilyGroup.options.find(
                              (option) => option.model === familySku(currentFamilyGroup.familyKey, resolution)
                            )
                            if (target) onModelChange?.(target)
                            close()
                          }}
                        >
                          {resolution}
                        </MenuOption>
                      ))
                    }
                  </Menu>
                ) : null}
                {currentModelOption?.source === "byok" && byokResolutions.length ? (
                  <Menu icon={<Monitor size={13} />} label={imageResolution} title="清晰度" menuLabel="清晰度" chevron disabled={generating}>
                    {(close) => byokResolutions.map((resolution) => (
                      <MenuOption
                        key={resolution}
                        active={resolution === imageResolution}
                        onClick={() => { setImageResolution(resolution as "1K" | "2K" | "4K"); close() }}
                      >
                        {resolution}
                      </MenuOption>
                    ))}
                  </Menu>
                ) : null}
                <Menu icon={<span className={styles.ratioGlyph} data-ratio={ratio} />} label={ratio} title="画幅" menuLabel="画幅" chevron disabled={generating} menuClassName={styles.ratioMenu}>
                  {(close) => (
                    <RatioPicker
                      ratios={availableRatios ?? IMAGE_RATIOS}
                      value={ratio}
                      onChange={(item) => setRatio(item as ImageRatio)}
                      close={close}
                    />
                  )}
                </Menu>
                {currentFamily || !supportsQuality ? null : (
                  <Menu icon={<Sparkles size={13} />} label={qualityLabel} title="质量" menuLabel="质量" chevron disabled={generating}>
                    {(close) =>
                      QUALITIES.map((item) => (
                        <MenuOption
                          key={item.value}
                          active={item.value === quality}
                          onClick={() => { setQuality(item.value); close() }}
                        >
                          {item.label}
                        </MenuOption>
                      ))
                    }
                  </Menu>
                )}
              </>
            ) : (
              videoControls
            )}
          </div>
          <div className={styles.costChip} title="API 连接状态">
            <Coins size={12} />
            {costLabel}
          </div>
          <button className="button button-primary" onClick={onGenerate} disabled={needsConfig || generating || !prompt.trim()}>
            {generating ? <LoaderCircle className={styles.spin} size={15} /> : kind === "image" ? <ImageIcon size={15} /> : <Video size={15} />}
            {generating ? "生成中" : kind === "image" ? "生成图片" : "生成视频"}
          </button>
        </div>
      </div>
      {status !== "准备就绪" ? (
        <div className={styles.statusBar}>
          <span className={generating ? styles.pulse : ""} />
          {status}
        </div>
      ) : null}
    </div>
  )
}
