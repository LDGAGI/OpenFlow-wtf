"use client"

import styles from "./resize-handle.module.css"

type Props = {
  className?: string
  axis?: "x" | "y"
  inFlow?: boolean
  onStart: () => void
  onDrag: (delta: number) => void
}

/** Edge drag handle for resizable panels. Reports cumulative movement from drag start. */
export function ResizeHandle({ className, axis = "x", inFlow = false, onStart, onDrag }: Props) {
  function handlePointerDown(event: React.PointerEvent<HTMLDivElement>) {
    event.preventDefault()
    const startX = event.clientX
    const startY = event.clientY
    onStart()
    function move(pointerEvent: PointerEvent) {
      onDrag(axis === "x" ? pointerEvent.clientX - startX : pointerEvent.clientY - startY)
    }
    function up() {
      document.removeEventListener("pointermove", move)
      document.removeEventListener("pointerup", up)
      document.body.style.cursor = ""
      document.body.style.userSelect = ""
    }
    document.body.style.cursor = axis === "x" ? "col-resize" : "row-resize"
    document.body.style.userSelect = "none"
    document.addEventListener("pointermove", move)
    document.addEventListener("pointerup", up)
  }

  return (
    <div
      className={`${styles.handle} ${inFlow ? styles.inFlow : ""} ${className ?? ""}`}
      data-axis={axis}
      onPointerDown={handlePointerDown}
      role="separator"
      aria-orientation={axis === "x" ? "vertical" : "horizontal"}
    />
  )
}
