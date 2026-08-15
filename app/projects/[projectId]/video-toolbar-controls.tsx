"use client"

import {
  Clapperboard,
  Clock3,
  Monitor,
  Music2,
  RectangleHorizontal,
  SlidersHorizontal,
} from "lucide-react"

import { Menu, MenuOption, MenuOptionHint } from "@/components/ui/menu"
import type { ModelOption } from "@/lib/provider-settings"
import type { VideoModelCapabilities } from "@/lib/provider-models"

import type { VideoMode } from "./video-reference-controls"
import styles from "./video-toolbar-controls.module.css"

export type VideoRatio = "21:9" | "16:9" | "4:3" | "1:1" | "3:4" | "9:16"

const MODES: Array<{ value: VideoMode; label: string }> = [
  { value: "text", label: "文生视频" },
  { value: "frame", label: "首尾帧" },
  { value: "media", label: "全能参考" },
]
const RATIOS: VideoRatio[] = ["21:9", "16:9", "4:3", "1:1", "3:4", "9:16"]
const RESOLUTIONS = ["480p", "720p"] as const

type Props = {
  /** 当前模型名（仅作展示标签） */
  model: string
  /** 当前模型的能力约束（时长范围、固定输出规格等） */
  capabilities: VideoModelCapabilities
  /** 当前选中项（来源 + 模型），用于高亮 */
  current: ModelOption
  /** 用户自己配置的可选模型。 */
  options: ModelOption[]
  onSelect: (option: ModelOption) => void
  mode: VideoMode
  setMode: (mode: VideoMode) => void
  duration: string
  setDuration: (duration: string) => void
  ratio: VideoRatio
  setRatio: (ratio: VideoRatio) => void
  resolution: (typeof RESOLUTIONS)[number]
  setResolution: (resolution: (typeof RESOLUTIONS)[number]) => void
  generateAudio: boolean
  setGenerateAudio: (enabled: boolean) => void
  disabled: boolean
}

export function VideoToolbarControls({
  model,
  capabilities,
  current,
  options,
  onSelect,
  mode,
  setMode,
  duration,
  setDuration,
  ratio,
  setRatio,
  resolution,
  setResolution,
  generateAudio,
  setGenerateAudio,
  disabled,
}: Props) {
  const availableModes = capabilities.supportsFirstLastFrame ? MODES : MODES.filter((item) => item.value !== "frame")
  const modeLabel = availableModes.find((item) => item.value === mode)?.label ?? "文生视频"
  const resolutionLabel = capabilities.fixedResolution ?? resolution
  const settingsSummary = `${ratio} · ${duration}s · ${resolutionLabel} · ${modeLabel}`

  return (
    <div className={styles.group}>
      <Menu icon={<Clapperboard size={13} />} label={model} title="视频模型" menuLabel="视频模型" chevron disabled={disabled}>
        {(close) =>
          options.map((item) => (
            <MenuOption
              key={`${item.source}:${item.connectionId ?? "local"}:${item.model}`}
              active={item.source === current.source && item.model === current.model}
              onClick={() => { onSelect(item); close() }}
            >
              {item.label ?? item.model}
              <MenuOptionHint>{item.providerLabel ?? "自有"}</MenuOptionHint>
            </MenuOption>
          ))
        }
      </Menu>

      <Menu
        icon={<SlidersHorizontal size={13} />}
        label={settingsSummary}
        title="视频生成设置"
        menuLabel="视频生成设置"
        chevron
        disabled={disabled}
        menuClassName={styles.settingsMenu}
      >
        {() => (
          <>
            <SettingsSection icon={<SlidersHorizontal size={14} />} label="生成模式">
              <div className={styles.segmentedOptions}>
                {availableModes.map((item) => (
                  <button
                    key={item.value}
                    type="button"
                    aria-pressed={mode === item.value}
                    className={mode === item.value ? styles.optionActive : ""}
                    onClick={() => setMode(item.value)}
                  >
                    {item.label}
                  </button>
                ))}
              </div>
            </SettingsSection>

            <SettingsSection icon={<RectangleHorizontal size={14} />} label="画面比例">
              <div className={styles.ratioOptions}>
                {RATIOS.map((item) => (
                  <button
                    key={item}
                    type="button"
                    aria-pressed={ratio === item}
                    className={ratio === item ? styles.optionActive : ""}
                    onClick={() => setRatio(item)}
                  >
                    <span className={styles.ratioShape} data-ratio={item} />
                    {item}
                  </button>
                ))}
              </div>
            </SettingsSection>

            <SettingsSection icon={<Monitor size={14} />} label="清晰度">
              <div className={styles.settingsOptions}>
                {capabilities.fixedResolution ? (
                  <button type="button" className={styles.optionActive} disabled>
                    {capabilities.fixedResolution}（固定）
                  </button>
                ) : (
                  RESOLUTIONS.map((item) => (
                    <button
                      key={item}
                      type="button"
                      aria-pressed={resolution === item}
                      className={resolution === item ? styles.optionActive : ""}
                      onClick={() => setResolution(item)}
                    >
                      {item}
                    </button>
                  ))
                )}
              </div>
            </SettingsSection>

            <SettingsSection icon={<Clock3 size={14} />} label="视频时长">
              <div className={styles.durationOptions}>
                {capabilities.durations.map((item) => (
                  <button
                    key={item}
                    type="button"
                    aria-pressed={duration === String(item)}
                    className={duration === String(item) ? styles.optionActive : ""}
                    onClick={() => setDuration(String(item))}
                  >
                    {item}s
                  </button>
                ))}
              </div>
            </SettingsSection>

            {mode !== "frame" && capabilities.supportsAudio ? (
              <label className={styles.audioSetting}>
                <span><Music2 size={14} />原生音频</span>
                <input
                  type="checkbox"
                  checked={generateAudio}
                  onChange={(event) => setGenerateAudio(event.target.checked)}
                />
              </label>
            ) : null}
          </>
        )}
      </Menu>

    </div>
  )
}

function SettingsSection({
  icon,
  label,
  children,
}: {
  icon: React.ReactNode
  label: string
  children: React.ReactNode
}) {
  return (
    <section className={styles.settingsSection}>
      <div className={styles.settingsLabel}>{icon}<span>{label}</span></div>
      {children}
    </section>
  )
}
