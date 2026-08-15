"use client"

import { useEffect, useRef, useState } from "react"
import { Check, ChevronDown } from "lucide-react"

import styles from "./select-menu.module.css"

export type SelectMenuOption = {
  value: string
  label: React.ReactNode
}

type SelectMenuProps = {
  value: string
  options: SelectMenuOption[]
  onChange: (value: string) => void
  ariaLabel?: string
  disabled?: boolean
}

/**
 * 表单场景的视觉下拉选择器：触发器外观对齐全局 .field，
 * 弹出层沿用 ui/menu 的深色菜单语言。菜单用 fixed 定位并贴近视口边缘时向上翻，
 * 避免被对话框 / 列表的 overflow 容器裁剪。
 */
export function SelectMenu({ value, options, onChange, ariaLabel, disabled }: SelectMenuProps) {
  const [open, setOpen] = useState(false)
  const [placement, setPlacement] = useState<{ left: number; width: number; top?: number; bottom?: number } | null>(null)
  const rootRef = useRef<HTMLDivElement>(null)
  const selected = options.find((option) => option.value === value)

  useEffect(() => {
    if (!open) return
    function closeOnPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false)
    }
    function closeOnScroll() {
      setOpen(false)
    }
    document.addEventListener("pointerdown", closeOnPointerDown)
    document.addEventListener("keydown", closeOnEscape)
    window.addEventListener("scroll", closeOnScroll, true)
    window.addEventListener("resize", closeOnScroll)
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown)
      document.removeEventListener("keydown", closeOnEscape)
      window.removeEventListener("scroll", closeOnScroll, true)
      window.removeEventListener("resize", closeOnScroll)
    }
  }, [open])

  function toggle() {
    if (disabled) return
    if (open) {
      setOpen(false)
      return
    }
    const rect = rootRef.current?.getBoundingClientRect()
    if (rect) {
      const menuHeight = Math.min(options.length * 34 + 14, 240)
      const flipUp =
        rect.bottom + menuHeight + 8 > window.innerHeight && rect.top - menuHeight - 8 > 0
      setPlacement({
        left: rect.left,
        width: rect.width,
        ...(flipUp
          ? { bottom: window.innerHeight - rect.top + 6 }
          : { top: rect.bottom + 6 }),
      })
    }
    setOpen(true)
  }

  return (
    <div ref={rootRef} className={styles.root}>
      <button
        type="button"
        className={`${styles.trigger} ${open ? styles.triggerOpen : ""}`}
        onClick={toggle}
        aria-expanded={open}
        aria-haspopup="listbox"
        aria-label={ariaLabel}
        disabled={disabled}
      >
        <span className={styles.triggerLabel}>{selected?.label ?? ""}</span>
        <ChevronDown size={14} aria-hidden="true" className={open ? styles.chevronOpen : ""} />
      </button>
      {open && placement ? (
        <div
          role="listbox"
          aria-label={ariaLabel}
          className={styles.menu}
          style={{
            left: placement.left,
            width: placement.width,
            top: placement.top,
            bottom: placement.bottom,
          }}
        >
          {options.map((option) => {
            const active = option.value === value
            return (
              <button
                key={option.value}
                type="button"
                role="option"
                aria-selected={active}
                className={`${styles.option} ${active ? styles.optionActive : ""}`}
                onClick={() => {
                  onChange(option.value)
                  setOpen(false)
                }}
              >
                <span className={styles.optionLabel}>{option.label}</span>
                {active ? <Check size={13} aria-hidden="true" /> : null}
              </button>
            )
          })}
        </div>
      ) : null}
    </div>
  )
}
