"use client"

import { useEffect, useState } from "react"
import { Check, ChevronDown, CircleAlert, Copy, RotateCcw } from "lucide-react"

import type { LocalChatMessage } from "@/lib/local-files/chat-index"

import styles from "./flow-activity.module.css"

function formatElapsed(milliseconds: number) {
  const seconds = Math.max(0, milliseconds) / 1000
  if (seconds < 60) return `${seconds.toFixed(1)}s`
  return `${Math.floor(seconds / 60)}m ${(seconds % 60).toFixed(1)}s`
}

function useElapsed(startedAt: number, stoppedAt: number | undefined, running: boolean) {
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    if (!running) return
    const timer = window.setInterval(() => setNow(Date.now()), 100)
    return () => window.clearInterval(timer)
  }, [running])
  return formatElapsed((running ? now : stoppedAt ?? startedAt) - startedAt)
}

function ActivityMark({ state }: { state: "running" | "completed" | "failed" | "stopped" }) {
  if (state === "completed") return <span className={styles.mark} data-state={state}><Check size={11} /></span>
  if (state === "stopped") return <span className={styles.mark} data-state={state}><span className={styles.stopGlyph} /></span>
  if (state === "failed") return <span className={styles.mark} data-state={state}><CircleAlert size={11} /></span>
  return (
    <span className={styles.gyroMark} aria-hidden>
      <i className={styles.gyroAxisA}><i className={styles.gyroRingA} /></i>
      <i className={styles.gyroAxisB}><i className={styles.gyroRingB} /></i>
    </span>
  )
}

export function FlowActivity({ message }: { message: LocalChatMessage }) {
  const failed = message.responseStatus === "failed" || message.tool?.status === "failed"
  const stopped = message.responseStatus === "stopped"
  const running = !failed && !stopped && (message.responseStatus === "streaming" || message.tool?.status === "running")
  const state = failed ? "failed" : stopped ? "stopped" : running ? "running" : "completed"
  const trace = message.trace?.length ? message.trace : message.tool ? [{ id: message.tool.name, label: message.tool.label, detail: message.tool.detail, status: message.tool.status, createdAt: message.createdAt }] : []
  const hasTool = trace.length > 0
  const [manualOpen, setManualOpen] = useState<boolean | null>(null)
  const expanded = manualOpen ?? (running && hasTool)
  const elapsed = useElapsed(message.createdAt, message.completedAt, running)
  const label = stopped
    ? "已停止"
    : failed
    ? "执行失败"
    : message.tool?.status === "running"
      ? message.tool.label
      : message.tool?.name === "propose_image_generation"
        ? "图片参数已准备"
        : running && message.content
          ? "正在生成回答"
          : running
            ? "思考中"
            : hasTool
              ? "执行完成"
              : "回答完成"

  return (
    <div className={styles.activity} data-state={state}>
      <button
        type="button"
        className={styles.summary}
        disabled={!hasTool}
        aria-expanded={hasTool ? expanded : undefined}
        onClick={() => hasTool && setManualOpen((current) => !(current ?? (running && hasTool)))}
      >
        <ActivityMark state={state} />
        <span className={styles.label}>{label}</span>
        <span className={styles.elapsed}>{message.reasoningSeconds ? `${message.reasoningSeconds}s` : elapsed}</span>
        {hasTool ? <ChevronDown size={13} className={styles.chevron} /> : null}
      </button>
      {hasTool ? (
        <div className={styles.drawer} data-open={expanded}>
          <div className={styles.drawerClip}>
            <div className={styles.trace}>
              <span className={styles.traceLine} aria-hidden />
              {trace.map((item) => (
                <div className={styles.traceRow} data-state={item.status} key={item.id}>
                  <span className={styles.traceDot} data-state={item.status === "running" ? "running" : item.status}>
                    {item.status === "completed" ? <Check size={9} /> : item.status === "failed" ? <CircleAlert size={9} /> : <span className={styles.miniPulse} />}
                  </span>
                  <span>{item.label}</span>
                  {item.detail ? <small>{item.detail}</small> : null}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function ResponseActions({ content, onRetry }: { content: string; onRetry?: () => void }) {
  const [copied, setCopied] = useState(false)
  async function copy() {
    try {
      await navigator.clipboard.writeText(content)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1400)
    } catch {
      // Clipboard permission may be unavailable in embedded browsers.
    }
  }
  return (
    <div className={styles.actions}>
      <button type="button" onClick={() => { void copy() }} aria-label={copied ? "已复制" : "复制回答"} title={copied ? "已复制" : "复制回答"} data-active={copied}>
        {copied ? <Check size={13} /> : <Copy size={13} />}
      </button>
      {onRetry ? <button type="button" onClick={onRetry} aria-label="重新回答" title="重新回答"><RotateCcw size={13} /></button> : null}
    </div>
  )
}
