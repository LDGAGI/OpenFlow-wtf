"use client"

import { useLayoutEffect, useRef } from "react"

type Props = React.TextareaHTMLAttributes<HTMLTextAreaElement> & {
  maxHeight?: number
}

/** Textarea that grows with its content. The CSS `min-height` sets the fixed
 *  initial height; beyond `maxHeight` the field scrolls internally. */
export function AutoTextarea({ maxHeight = 200, value, ...rest }: Props) {
  const ref = useRef<HTMLTextAreaElement>(null)

  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    el.style.height = "auto"
    el.style.height = `${Math.min(el.scrollHeight, maxHeight)}px`
    el.style.overflowY = el.scrollHeight > maxHeight ? "auto" : "hidden"
  }, [value, maxHeight])

  return <textarea ref={ref} rows={1} value={value} {...rest} />
}
