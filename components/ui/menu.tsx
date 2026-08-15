"use client"

import { useEffect, useRef, useState } from "react"
import { ChevronDown } from "lucide-react"

import styles from "./menu.module.css"

type MenuProps = {
  icon?: React.ReactNode
  label: React.ReactNode
  title?: string
  chevron?: boolean
  active?: boolean
  disabled?: boolean
  align?: "left" | "right"
  menuClassName?: string
  menuLabel?: string
  children: (close: () => void) => React.ReactNode
}

export function Menu({
  icon,
  label,
  title,
  chevron,
  active,
  disabled,
  align,
  menuClassName,
  menuLabel,
  children,
}: MenuProps) {
  const [open, setOpen] = useState(false)
  const rootRef = useRef<HTMLDivElement>(null)

  useEffect(() => {
    if (!open) return
    function closeOnPointerDown(event: PointerEvent) {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false)
    }
    function closeOnEscape(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false)
    }
    document.addEventListener("pointerdown", closeOnPointerDown)
    document.addEventListener("keydown", closeOnEscape)
    return () => {
      document.removeEventListener("pointerdown", closeOnPointerDown)
      document.removeEventListener("keydown", closeOnEscape)
    }
  }, [open])

  return (
    <div ref={rootRef} className={styles.popover}>
      <button
        type="button"
        className={`${styles.chip} ${open || active ? styles.chipActive : ""}`}
        onClick={() => setOpen((current) => !current)}
        aria-expanded={open}
        aria-haspopup="menu"
        disabled={disabled}
        title={title}
      >
        {icon}
        <span className={styles.chipLabel}>{label}</span>
        {chevron ? <ChevronDown size={12} aria-hidden="true" /> : null}
      </button>
      {open ? (
        <div
          role="menu"
          aria-label={menuLabel ?? title}
          className={`${styles.menu} ${align === "right" ? styles.alignRight : ""} ${menuClassName ?? ""}`}
        >
          {children(() => setOpen(false))}
        </div>
      ) : null}
    </div>
  )
}

export function MenuOption({
  active,
  onClick,
  icon,
  children,
}: {
  active?: boolean
  onClick: () => void
  icon?: React.ReactNode
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      role="menuitemradio"
      aria-checked={active}
      className={`${styles.option} ${active ? styles.optionActive : ""}`}
      onClick={onClick}
    >
      {icon}
      {children}
    </button>
  )
}

/** 选项末尾的弱化提示。 */
export function MenuOptionHint({ children }: { children: React.ReactNode }) {
  return <span className={styles.optionHint}>{children}</span>
}
