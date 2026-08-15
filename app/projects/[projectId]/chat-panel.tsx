"use client"

import { useEffect, useRef, useState } from "react"
import ReactMarkdown from "react-markdown"
import remarkGfm from "remark-gfm"
import { ArrowDown, Bot, Check, ChevronDown, ChevronUp, CircleHelp, CircleStop, Copy, MessageSquare, PanelRightClose, PanelRightOpen, Plus, Send, Settings, Sparkles, Trash2, X } from "lucide-react"

import { AutoTextarea } from "@/components/ui/auto-textarea"
import { ResizeHandle } from "@/components/ui/resize-handle"
import { activeChatProvider, loadChatSettings, saveChatSettings, type ChatProviderType, type ChatSettings } from "@/lib/chat-settings"
import { fitHistoryToBudget } from "@/lib/model-context"
import type { StoredSkill } from "@/lib/skills/types"
import { MAX_SKILL_READ_BYTES, MAX_SKILL_READS, readSkillTextFile, skillFileManifest } from "@/lib/skills/resources"
import type { ChatImageGenerationRequest, ChatImageToolContext, ChatToolMode, ImageGenerationApproval, ImageGenerationProposal } from "@/lib/chat-image-tools"
import { imageModelFamilyKey, imageModelResolution } from "@/lib/image-model-families"
import { createClientId } from "@/lib/client-id"

// 中文语境下 `**` 紧贴 CJK 字符时常不满足 CommonMark flanking 规则，粗体失效；
// 在两者之间补零宽空格（不可见）让解析成立。
const CJK_RANGE = "\\u2e80-\\u9fff\\uf900-\\ufaff\\uff00-\\uffef"
const CJK_EMPHASIS_RE = new RegExp(`([${CJK_RANGE}])(\\*\\*)(?=[${CJK_RANGE}])`, "g")
const normalizeCjkMarkdown = (text: string) => text.replace(CJK_EMPHASIS_RE, "$1\u200b$2\u200b")

/** 引用块：右上角悬浮复制按钮，一键复制框内全部文字 */
function MarkdownBlockquote({ children }: { children?: React.ReactNode }) {
  const ref = useRef<HTMLQuoteElement>(null)
  const [copied, setCopied] = useState(false)
  async function copyQuote() {
    const text = ref.current?.innerText?.trim()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // 剪贴板不可用时静默失败
    }
  }
  return (
    <blockquote ref={ref}>
      <button
        type="button"
        className={styles.quoteCopy}
        data-copied={copied}
        onClick={copyQuote}
        title={copied ? "已复制" : "复制引用内容"}
        aria-label={copied ? "已复制" : "复制引用内容"}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
      {children}
    </blockquote>
  )
}

/** 代码块：复制 code 节点内容，避免把按钮自身计入剪贴板。 */
function MarkdownPre({ children }: { children?: React.ReactNode }) {
  const ref = useRef<HTMLPreElement>(null)
  const [copied, setCopied] = useState(false)
  async function copyCode() {
    const text = ref.current?.querySelector("code")?.innerText?.trim()
    if (!text) return
    try {
      await navigator.clipboard.writeText(text)
      setCopied(true)
      window.setTimeout(() => setCopied(false), 1500)
    } catch {
      // 剪贴板不可用时静默失败
    }
  }
  return (
    <div className={styles.codeBlock}>
      <button
        type="button"
        className={styles.quoteCopy}
        data-copied={copied}
        onClick={copyCode}
        title={copied ? "已复制" : "复制代码块"}
        aria-label={copied ? "已复制" : "复制代码块"}
      >
        {copied ? <Check size={12} /> : <Copy size={12} />}
      </button>
      <pre ref={ref}>{children}</pre>
    </div>
  )
}

import { clearChatMessages, listChatMessages, saveChatMessage, type LocalChatMessage } from "@/lib/local-files/chat-index"

import { ChatSettingsDialog } from "./chat-settings-dialog"
import { FlowActivity, ResponseActions } from "./flow-activity"
import { ImageApprovalCard } from "./image-approval-card"
import { SkillManager } from "./skill-manager"
import { HISTORY_IMAGE_DRAG_TYPE } from "./workbench-types"
import styles from "./chat-panel.module.css"

const COLLAPSED_KEY = "openflow.chat-panel.collapsed"
const WIDTH_KEY = "openflow.chat-panel.width"
const MIN_WIDTH = 260
const MAX_WIDTH = 560
const DEFAULT_WIDTH = 320
const MAX_IMAGES = 9
const MAX_IMAGE_EDGE = 1600
const DIRECT_IMAGE_TYPES = new Set(["image/png", "image/jpeg", "image/webp"])
const TOOL_MODE_KEY = "openflow.chat.tool-mode"
const AUTO_APPROVAL_POINTS = 50

type PendingImage = { id: string; dataUrl: string }

/** 读取图片为模型可接受的 data URL；非 PNG/JPEG/WebP 与超规格图统一转为 JPEG。 */
async function fileToDataUrl(file: File): Promise<string> {
  const dataUrl = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader()
    reader.onload = () => resolve(reader.result as string)
    reader.onerror = () => reject(new Error("读取文件失败"))
    reader.readAsDataURL(file)
  })
  const image = await new Promise<HTMLImageElement>((resolve, reject) => {
    const el = new Image()
    el.onload = () => resolve(el)
    el.onerror = () => reject(new Error("图片解析失败"))
    el.src = dataUrl
  })
  if (
    DIRECT_IMAGE_TYPES.has(file.type.toLowerCase()) &&
    image.width <= MAX_IMAGE_EDGE &&
    image.height <= MAX_IMAGE_EDGE &&
    dataUrl.length < 1_500_000
  ) {
    return dataUrl
  }
  const scale = Math.min(1, MAX_IMAGE_EDGE / Math.max(image.width, image.height))
  const canvas = document.createElement("canvas")
  canvas.width = Math.round(image.width * scale)
  canvas.height = Math.round(image.height * scale)
  const context = canvas.getContext("2d")
  if (!context) throw new Error("图片转换失败")
  context.drawImage(image, 0, 0, canvas.width, canvas.height)
  return canvas.toDataURL("image/jpeg", 0.85)
}

export function ChatPanel({ projectId, guest = false, resolveHistoryImage, imageToolContext, onGenerateImageRequest }: {
  projectId: string
  /** 未配置对话 API 时禁用输入并引导配置。 */
  guest?: boolean
  resolveHistoryImage?: (id: string) => Promise<File>
  imageToolContext?: ChatImageToolContext
  onGenerateImageRequest?: (request: ChatImageGenerationRequest) => Promise<string | undefined>
}) {
  const [messages, setMessages] = useState<LocalChatMessage[]>([])
  const [input, setInput] = useState("")
  const [streaming, setStreaming] = useState(false)
  // Keep the server render and the first client render deterministic. Persisted
  // layout preferences are restored after hydration in the effect below.
  const [collapsed, setCollapsed] = useState(false)
  const [width, setWidth] = useState(DEFAULT_WIDTH)
  const dragBase = useRef(DEFAULT_WIDTH)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [skillManagerOpen, setSkillManagerOpen] = useState(false)
  const [activeSkill, setActiveSkill] = useState<StoredSkill | null>(null)
  const [chatSettings, setChatSettings] = useState<ChatSettings | null>(null)
  const [pendingImages, setPendingImages] = useState<PendingImage[]>([])
  const [dragging, setDragging] = useState(false)
  const [modelMenuOpen, setModelMenuOpen] = useState(false)
  const [toolMode, setToolMode] = useState<ChatToolMode>("ask")
  const [modeMenuOpen, setModeMenuOpen] = useState(false)
  const abortRef = useRef<AbortController | null>(null)
  const activeAssistantIdRef = useRef<string | null>(null)
  const endRef = useRef<HTMLDivElement | null>(null)
  const messagesRef = useRef<HTMLDivElement | null>(null)
  const followLatestRef = useRef(true)
  const [showLatestButton, setShowLatestButton] = useState(false)
  const fileInputRef = useRef<HTMLInputElement | null>(null)
  const modelMenuRef = useRef<HTMLDivElement | null>(null)
  const skillMenuRef = useRef<HTMLDivElement | null>(null)
  const modeMenuRef = useRef<HTMLDivElement | null>(null)
  const activeProvider = chatSettings ? activeChatProvider(chatSettings) : null

  useEffect(() => {
    const frame = window.requestAnimationFrame(() => {
      const savedWidth = Number(window.localStorage.getItem(WIDTH_KEY))
      if (savedWidth >= MIN_WIDTH && savedWidth <= MAX_WIDTH) setWidth(savedWidth)
      setCollapsed(window.localStorage.getItem(COLLAPSED_KEY) === "1")
      setChatSettings(loadChatSettings())
      const savedMode = window.localStorage.getItem(`${TOOL_MODE_KEY}.${guest ? "guest" : "user"}`)
      if (savedMode === "ask" || savedMode === "auto") setToolMode(savedMode)
    })
    return () => window.cancelAnimationFrame(frame)
  }, [guest])
  useEffect(() => {
    if (!modeMenuOpen) return
    function close(event: PointerEvent) { if (!modeMenuRef.current?.contains(event.target as Node)) setModeMenuOpen(false) }
    document.addEventListener("pointerdown", close)
    return () => document.removeEventListener("pointerdown", close)
  }, [modeMenuOpen])

  function changeToolMode(mode: ChatToolMode) {
    setToolMode(mode)
    setModeMenuOpen(false)
    window.localStorage.setItem(`${TOOL_MODE_KEY}.${guest ? "guest" : "user"}`, mode)
  }

  function resolveApproval(proposal: ImageGenerationProposal): ImageGenerationApproval {
    if (!imageToolContext) throw new Error("当前工作台没有可用的图片设置")
    const current = imageToolContext.current.modelOption
    const currentModel = imageToolContext.models.find((item) => item.model === current.model && item.source === current.source)
    if (!currentModel) throw new Error("当前自有模型未配置能力档案，请先在设置中映射模型后再使用图片工具")
    let selected = imageToolContext.models.find((item) => item.model === proposal.model && item.source === current.source) ?? imageToolContext.models.find((item) => item.model === proposal.model) ?? currentModel
    const family = imageModelFamilyKey(selected.model)
    if (family && proposal.resolution) {
      selected = imageToolContext.models.find((item) => item.source === selected.source && imageModelFamilyKey(item.model) === family && imageModelResolution(item.model) === proposal.resolution) ?? selected
    }
    const aspectRatio = selected.aspectRatios.includes(proposal.aspectRatio ?? "") ? proposal.aspectRatio! : selected.aspectRatios.includes(imageToolContext.current.aspectRatio) ? imageToolContext.current.aspectRatio : selected.aspectRatios[0] ?? "1:1"
    const resolution = selected.resolutions.includes(proposal.resolution!) ? proposal.resolution : selected.resolutions.includes(imageToolContext.current.resolution!) ? imageToolContext.current.resolution : selected.resolutions[0]
    const quality = selected.qualities.includes(proposal.quality!) ? proposal.quality : selected.qualities.includes(imageToolContext.current.quality) ? imageToolContext.current.quality : selected.qualities[0]
    const background = selected.backgrounds.includes(proposal.background!) ? proposal.background : selected.backgrounds.includes(imageToolContext.current.background) ? imageToolContext.current.background : selected.backgrounds[0]
    const outputFormat = selected.outputFormats.includes(proposal.outputFormat!) ? proposal.outputFormat : selected.outputFormats.includes(imageToolContext.current.outputFormat) ? imageToolContext.current.outputFormat : selected.outputFormats[0]
    return { prompt: proposal.prompt, model: selected.model, modelOption: selected, aspectRatio, ...(resolution ? { resolution } : {}), ...(quality ? { quality } : {}), ...(background ? { background } : {}), ...(outputFormat ? { outputFormat } : {}), count: Math.min(9, Math.max(1, Math.round(proposal.count || 1))), status: "draft" }
  }

  function approvalRequest(approval: ImageGenerationApproval): ChatImageGenerationRequest {
    return { prompt: approval.prompt, modelOption: approval.modelOption, aspectRatio: approval.aspectRatio ?? "1:1", ...(approval.resolution ? { resolution: approval.resolution } : {}), ...(approval.quality ? { quality: approval.quality } : {}), ...(approval.background ? { background: approval.background } : {}), ...(approval.outputFormat ? { outputFormat: approval.outputFormat } : {}) }
  }

  function approvalDetail(approval: ImageGenerationApproval) {
    return [ `${approval.count} 张`, approval.aspectRatio, approval.resolution, approval.quality, approval.background, approval.outputFormat?.toUpperCase() ].filter(Boolean).join(" · ")
  }

  function updateApproval(messageId: string, approval: ImageGenerationApproval) {
    setMessages((current) => current.map((message) => {
      if (message.id !== messageId) return message
      const next = { ...message, imageApproval: approval }
      void saveChatMessage(next)
      return next
    }))
  }

  async function submitApproval(message: LocalChatMessage) {
    const approval = message.imageApproval
    if (!approval || !onGenerateImageRequest) return
    updateApproval(message.id, { ...approval, status: "submitting", error: undefined })
    try {
      await Promise.all(Array.from({ length: approval.count }, () => onGenerateImageRequest(approvalRequest(approval))))
      updateApproval(message.id, { ...approval, status: "submitted", error: undefined })
    } catch (error) {
      updateApproval(message.id, { ...approval, status: "failed", error: error instanceof Error ? error.message : "提交失败" })
    }
  }
  useEffect(() => {
    void listChatMessages(projectId).then((stored) => {
      const now = Date.now()
      const repaired = stored.map((message) => {
        if (message.role !== "assistant" || message.responseStatus !== "streaming") return message
        const next: LocalChatMessage = {
          ...message,
          responseStatus: "stopped",
          completedAt: message.completedAt ?? now,
          tool: message.tool?.status === "running" ? { ...message.tool, status: "completed", label: "已停止" } : message.tool,
          trace: message.trace?.map((event) => event.status === "running" ? { ...event, status: "completed" as const, detail: "任务已停止" } : event),
        }
        void saveChatMessage(next)
        return next
      })
      setMessages(repaired)
    })
  }, [projectId])
  useEffect(() => {
    if (!followLatestRef.current) return
    endRef.current?.scrollIntoView({ block: "end" })
  }, [messages])

  function handleMessagesScroll() {
    const element = messagesRef.current
    if (!element) return
    const distanceToBottom = element.scrollHeight - element.scrollTop - element.clientHeight
    const atBottom = distanceToBottom <= 48
    followLatestRef.current = atBottom
    setShowLatestButton(!atBottom)
  }

  function scrollToLatest() {
    followLatestRef.current = true
    setShowLatestButton(false)
    endRef.current?.scrollIntoView({ behavior: "smooth", block: "end" })
  }
  useEffect(() => {
    if (!modelMenuOpen) return
    function onPointerDown(event: PointerEvent) {
      if (!modelMenuRef.current?.contains(event.target as Node)) setModelMenuOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setModelMenuOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [modelMenuOpen])
  useEffect(() => {
    if (!skillManagerOpen) return
    function onPointerDown(event: PointerEvent) {
      if (!skillMenuRef.current?.contains(event.target as Node)) setSkillManagerOpen(false)
    }
    function onKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setSkillManagerOpen(false)
    }
    document.addEventListener("pointerdown", onPointerDown)
    document.addEventListener("keydown", onKeyDown)
    return () => {
      document.removeEventListener("pointerdown", onPointerDown)
      document.removeEventListener("keydown", onKeyDown)
    }
  }, [skillManagerOpen])

  function toggleCollapsed() {
    setCollapsed((current) => {
      window.localStorage.setItem(COLLAPSED_KEY, current ? "0" : "1")
      return !current
    })
  }

  function resize(deltaX: number) {
    const next = Math.min(MAX_WIDTH, Math.max(MIN_WIDTH, dragBase.current - deltaX))
    setWidth(next)
    window.localStorage.setItem(WIDTH_KEY, String(next))
  }

  async function addImages(files: FileList | File[] | null) {
    if (!files) return
    const remaining = MAX_IMAGES - pendingImages.length
    const accepted = [...files].filter((file) => file.type.startsWith("image/")).slice(0, Math.max(0, remaining))
    for (const file of accepted) {
      try {
        const dataUrl = await fileToDataUrl(file)
        setPendingImages((current) =>
          current.length >= MAX_IMAGES ? current : [...current, { id: createClientId(), dataUrl }]
        )
      } catch {
        // 忽略无法解析的文件
      }
    }
  }

  /** 粘贴图片：截图/文件粘贴（无文本）阻止默认插入；图文混排保留文本默认行为 */
  function handlePaste(event: React.ClipboardEvent<HTMLTextAreaElement>) {
    const images = [...event.clipboardData.files].filter((file) => file.type.startsWith("image/"))
    if (!images.length) return
    if (!event.clipboardData.getData("text")) event.preventDefault()
    void addImages(images)
  }

  function handleDragOver(event: React.DragEvent) {
    if (
      !event.dataTransfer.types.includes("Files") &&
      !event.dataTransfer.types.includes(HISTORY_IMAGE_DRAG_TYPE)
    ) return
    event.preventDefault()
    event.dataTransfer.dropEffect = "copy"
    setDragging(true)
  }

  function handleDragLeave(event: React.DragEvent) {
    if (event.currentTarget.contains(event.relatedTarget as Node)) return
    setDragging(false)
  }

  async function handleDrop(event: React.DragEvent) {
    event.preventDefault()
    setDragging(false)
    const historyImageId = event.dataTransfer.getData(HISTORY_IMAGE_DRAG_TYPE)
    if (historyImageId && resolveHistoryImage) {
      try {
        await addImages([await resolveHistoryImage(historyImageId)])
      } catch {
        // 历史图片不可读时不添加附件
      }
      return
    }
    await addImages(event.dataTransfer.files)
  }

  async function send() {
    const content = input.trim()
    const images = pendingImages.map((item) => item.dataUrl)
    if ((!content && !images.length) || streaming) return
    const userText = content || "请分析这些图片"
    const userMessage: LocalChatMessage = { id: createClientId(), projectId, role: "user", content: userText, images: images.length ? images : undefined, createdAt: Date.now() }
      const assistant: LocalChatMessage = { id: createClientId(), projectId, role: "assistant", content: "", responseStatus: "streaming", createdAt: Date.now() + 1 }
      const reasoningStartedAt = Date.now()
    setMessages((current) => [...current, userMessage, assistant])
    followLatestRef.current = true
    setShowLatestButton(false)
    setInput("")
    setPendingImages([])
    setStreaming(true)
    activeAssistantIdRef.current = assistant.id
    await saveChatMessage(userMessage)
    const controller = new AbortController()
    abortRef.current = controller
    try {
      const history = fitHistoryToBudget({
        messages,
        model: chatSettings?.activeModel,
        currentMessage: activeSkill ? `${activeSkill.instructions}\n${userText}` : userText,
        currentImages: images.length,
      })
        .filter((item) => item.content.trim().length > 0)
        .map((item) => ({
          role: item.role,
          content: item.content,
          ...(item.role === "user" && item.images?.length ? { images: item.images } : {}),
        }))
      const requestBody = {
          message: userText,
          history,
          ...(images.length ? { images } : {}),
          ...(activeSkill ? { skill: { id: activeSkill.id, name: activeSkill.name, instructions: activeSkill.instructions, files: skillFileManifest(activeSkill) } } : {}),
          toolMode,
          ...(imageToolContext ? { imageToolContext } : {}),
          ...(chatSettings
            ? {
                settings: {
                  protocol: "chat-completions",
                  baseUrl: activeChatProvider(chatSettings).baseUrl,
                  apiKey: activeChatProvider(chatSettings).apiKey,
                  model: chatSettings.activeModel,
                },
              }
            : {}),
      }
      let full = ""
      let reasoning = ""
      let trace: NonNullable<LocalChatMessage["trace"]> = []
      function updateTrace(id: string, label: string, status: "running" | "completed" | "failed", detail?: string) {
        trace = trace.map((item) => item.status === "running" && item.id !== id ? { ...item, status: "completed" as const } : item)
        const existing = trace.findIndex((item) => item.id === id)
        const next = { id, label, status, createdAt: existing >= 0 ? trace[existing].createdAt : Date.now(), ...(detail ? { detail } : {}) }
        trace = existing >= 0 ? trace.map((item, index) => index === existing ? next : item) : [...trace, next]
        setMessages((current) => current.map((item) => item.id === assistant.id ? { ...item, trace } : item))
      }
      type ToolRequest = { id: string; name: "generate_image" | "propose_image_generation" | "read_skill_file"; arguments: string }

      async function consume(body: Record<string, unknown>): Promise<ToolRequest | null> {
        const response = await fetch("/api/local/chat/stream", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
          signal: controller.signal,
        })
        if (!response.ok) {
          const data = await response.json().catch(() => null) as { error?: string } | null
          throw new Error(data?.error ?? `对话连接失败（${response.status}）`)
        }
        if (!response.body) throw new Error("对话连接失败：响应内容为空")
        const reader = response.body.getReader()
        const decoder = new TextDecoder()
        let buffer = ""
        let toolRequest: ToolRequest | null = null
        while (true) {
          const { value, done } = await reader.read()
          if (done) break
          buffer += decoder.decode(value, { stream: true })
          const frames = buffer.split("\n\n")
          buffer = frames.pop() ?? ""
          for (const frame of frames) {
            const eventName = frame.match(/^event: (.+)$/m)?.[1]
            const raw = frame.match(/^data: (.+)$/m)?.[1]
            if (!raw) continue
            const data = JSON.parse(raw) as { delta?: string; message?: string; id?: string; name?: "generate_image" | "propose_image_generation" | "read_skill_file"; arguments?: string }
            if (eventName === "reasoning.delta" && data.delta) {
              reasoning += data.delta
              setMessages((current) => current.map((item) => item.id === assistant.id ? { ...item, reasoning, reasoningStatus: "streaming" } : item))
            }
            if (eventName === "message.delta" && data.delta) {
              full += data.delta
              setMessages((current) => current.map((item) => item.id === assistant.id ? {
                ...item,
                content: full,
                ...(reasoning ? { reasoningStatus: "completed" as const, reasoningSeconds: Math.max(1, Math.round((Date.now() - reasoningStartedAt) / 1000)) } : {}),
              } : item))
            }
            if (eventName === "tool.requested" && data.id && data.name && typeof data.arguments === "string") {
              toolRequest = { id: data.id, name: data.name, arguments: data.arguments }
              if (reasoning) {
                setMessages((current) => current.map((item) => item.id === assistant.id ? {
                  ...item,
                  reasoningStatus: "completed",
                  reasoningSeconds: Math.max(1, Math.round((Date.now() - reasoningStartedAt) / 1000)),
                } : item))
              }
            }
            if (eventName === "message.completed" && reasoning) {
              setMessages((current) => current.map((item) => item.id === assistant.id ? {
                ...item,
                reasoningStatus: "completed",
                reasoningSeconds: Math.max(1, Math.round((Date.now() - reasoningStartedAt) / 1000)),
              } : item))
            }
            if (eventName === "error") throw new Error(data.message ?? "对话失败")
          }
        }
        return toolRequest
      }

      let toolRequest = await consume(requestBody)
      let tool: LocalChatMessage["tool"]
      let imageApproval: ImageGenerationApproval | undefined
      let readCount = 0
      let readBytes = 0
      while (toolRequest) {
        if (toolRequest.name === "read_skill_file") {
          let result: string
          const requestedPath = (() => { try { const parsed = JSON.parse(toolRequest!.arguments) as { path?: unknown }; return typeof parsed.path === "string" ? parsed.path : "" } catch { return "" } })()
          try {
            if (!activeSkill) throw new Error("当前没有启用 Skill")
            if (readCount >= MAX_SKILL_READS) throw new Error("本轮读取文件数量已达上限")
            const file = await readSkillTextFile(activeSkill, requestedPath)
            if (readBytes + file.bytes > MAX_SKILL_READ_BYTES) throw new Error("本轮读取内容已达 1 MB 上限")
            readCount++
            readBytes += file.bytes
            tool = { name: "read_skill_file", status: "running", label: "正在读取", detail: file.path }
            updateTrace(`skill-${readCount}`, "读取 Skill 参考", "running", file.path)
            result = JSON.stringify({ ok: true, path: file.path, content: file.content })
          } catch (error) {
            const message = error instanceof Error ? error.message : "读取 Skill 文件失败"
            tool = { name: "read_skill_file", status: "failed", label: "读取失败", detail: message }
            updateTrace(`skill-${readCount + 1}`, "读取 Skill 参考", "failed", message)
            result = JSON.stringify({ ok: false, error: message, path: requestedPath })
          }
          setMessages((current) => current.map((item) => item.id === assistant.id ? { ...item, tool } : item))
          toolRequest = await consume({ ...requestBody, toolContinuation: { ...toolRequest, result } })
          continue
        }
        if (toolRequest.name === "propose_image_generation") {
          try {
            imageApproval = resolveApproval(JSON.parse(toolRequest.arguments) as ImageGenerationProposal)
            tool = { name: "propose_image_generation", status: "completed", label: "等待确认", detail: approvalDetail(imageApproval) }
            updateTrace("image-proposal", "准备图片参数", "completed", approvalDetail(imageApproval))
          } catch (error) {
            const message = error instanceof Error ? error.message : "图片参数无法解析"
            tool = { name: "propose_image_generation", status: "failed", label: "提案失败", detail: message }
            updateTrace("image-proposal", "准备图片参数", "failed", message)
          }
          setMessages((current) => current.map((item) => item.id === assistant.id ? { ...item, tool, ...(imageApproval ? { imageApproval } : {}) } : item))
          toolRequest = null
          continue
        }
        tool = { name: "generate_image", status: "running", label: "正在生成图片", detail: "使用工作台当前模型与参数" }
        updateTrace("image-generation", "提交图片任务", "running", "使用当前模型与参数")
        setMessages((current) => current.map((item) => item.id === assistant.id ? { ...item, tool } : item))
        let result: string
        try {
          const parsedArguments = JSON.parse(toolRequest.arguments) as ImageGenerationProposal
          const imagePrompt = typeof parsedArguments.prompt === "string" ? parsedArguments.prompt.trim() : ""
          if (!imagePrompt) throw new Error("模型没有提供有效的图片提示词")
          const approval = resolveApproval(parsedArguments)
          const model = imageToolContext?.models.find((item) => item.model === approval.modelOption.model && item.source === approval.modelOption.source)
          if (model?.points != null && model.points * approval.count > AUTO_APPROVAL_POINTS) {
            imageApproval = approval
            tool = { name: "propose_image_generation", status: "completed", label: "等待确认", detail: approvalDetail(approval) }
            updateTrace("image-generation", "等待用户确认", "completed", approvalDetail(approval))
            setMessages((current) => current.map((item) => item.id === assistant.id ? { ...item, tool, imageApproval } : item))
            toolRequest = null
            continue
          }
          if (!onGenerateImageRequest) throw new Error("当前工作台不支持图片生成")
          const ids = await Promise.all(Array.from({ length: approval.count }, () => onGenerateImageRequest(approvalRequest(approval))))
          const generationId = ids.find(Boolean)
          tool = { name: "generate_image", status: "completed", label: "图片生成已提交", detail: approvalDetail(approval), ...(generationId ? { generationId } : {}) }
          updateTrace("image-generation", "图片任务已提交", "completed", approvalDetail(approval))
          result = JSON.stringify({ ok: true, status: "submitted", prompt: imagePrompt })
        } catch (error) {
          const message = error instanceof Error ? error.message : "图片生成失败"
          tool = { name: "generate_image", status: "failed", label: "图片生成失败", detail: message }
          updateTrace("image-generation", "图片任务提交失败", "failed", message)
          result = JSON.stringify({ ok: false, error: message })
        }
        setMessages((current) => current.map((item) => item.id === assistant.id ? { ...item, tool } : item))
        toolRequest = await consume({
          ...requestBody,
          toolContinuation: { ...toolRequest, result },
        })
      }
      if (tool?.name === "read_skill_file" && tool.status === "running") {
        tool = { ...tool, status: "completed", label: "参考资料已读取" }
        trace = trace.map((item) => item.status === "running" ? { ...item, status: "completed" as const } : item)
        setMessages((current) => current.map((item) => item.id === assistant.id ? { ...item, tool } : item))
      }
      const completedReasoning = reasoning ? {
        reasoning,
        reasoningStatus: "completed" as const,
        reasoningSeconds: Math.max(1, Math.round((Date.now() - reasoningStartedAt) / 1000)),
      } : {}
      const completedMessage = { ...assistant, content: full, responseStatus: "completed" as const, completedAt: Date.now(), ...completedReasoning, ...(trace.length ? { trace } : {}), ...(tool ? { tool } : {}), ...(imageApproval ? { imageApproval } : {}) }
      setMessages((current) => current.map((item) => item.id === assistant.id ? completedMessage : item))
      await saveChatMessage(completedMessage)
    } catch (error) {
      if ((error as DOMException).name !== "AbortError") {
        const message = error instanceof Error ? error.message : "对话失败"
        setMessages((current) => current.map((item) => item.id === assistant.id
          ? { ...item, responseStatus: "failed", completedAt: Date.now(), content: item.content ? `${item.content}\n\n${message}` : message, trace: item.trace?.map((event) => event.status === "running" ? { ...event, status: "failed" as const, detail: message } : event) }
          : item))
      }
    } finally { abortRef.current = null; activeAssistantIdRef.current = null; setStreaming(false) }
  }

  function stopResponse() {
    const assistantId = activeAssistantIdRef.current
    abortRef.current?.abort()
    if (!assistantId) {
      setStreaming(false)
      return
    }
    const stoppedAt = Date.now()
    setMessages((current) => current.map((message) => {
      if (message.id !== assistantId || message.responseStatus !== "streaming") return message
      const next: LocalChatMessage = {
        ...message,
        responseStatus: "stopped",
        completedAt: stoppedAt,
        tool: message.tool?.status === "running" ? { ...message.tool, status: "completed", label: "已停止" } : message.tool,
        trace: message.trace?.map((event) => event.status === "running" ? { ...event, status: "completed" as const, detail: "用户已停止" } : event),
      }
      void saveChatMessage(next)
      return next
    }))
    setStreaming(false)
  }

  function switchModel(providerId: ChatProviderType, nextModel: string) {
    setModelMenuOpen(false)
    setChatSettings((current) => {
      const provider = current?.providers.find((item) => item.id === providerId)
      if (!current || !provider?.models.includes(nextModel)) return current
      const next = { ...current, activeProviderId: providerId, activeModel: nextModel }
      saveChatSettings(next)
      return next
    })
  }

  async function clear() { abortRef.current?.abort(); await clearChatMessages(projectId); setMessages([]); setStreaming(false) }

  if (collapsed) {
    return (
      <aside className={`${styles.panel} ${styles.collapsed}`}>
        <button type="button" className={styles.expandButton} onClick={toggleCollapsed} title="展开对话" aria-label="展开对话">
          <PanelRightOpen size={15} />
        </button>
      </aside>
    )
  }

  return (
    <aside className={styles.panel} style={{ width }}>
      <ResizeHandle className={styles.handleLeft} onStart={() => { dragBase.current = width }} onDrag={resize} />
      <div className={styles.conversation}>
        <div className={styles.header}>
          <div className={styles.headerTitle}>
            <MessageSquare size={14} />
            <strong>基础对话</strong>
          </div>
          <div className={styles.headerActions}>
            <button className="button icon-button" onClick={() => setSettingsOpen(true)} title="对话 API 设置" aria-label="对话 API 设置">
              <Settings size={13} />
            </button>
            <button className="button icon-button" onClick={clear} title="清空对话" aria-label="清空对话">
              <Trash2 size={13} />
            </button>
            <button className="button icon-button" onClick={toggleCollapsed} title="收起对话" aria-label="收起对话">
              <PanelRightClose size={13} />
            </button>
          </div>
        </div>
        <div className={styles.messagesWrap}>
          <div className={styles.messages} ref={messagesRef} onScroll={handleMessagesScroll}>
          {messages.length ? (
            messages.map((message) => (
              <div className={`${styles.message} ${message.role === "user" ? styles.user : styles.assistant}`} key={message.id}>
                {message.images?.length ? (
                  <div className={styles.messageImages}>
                    {message.images.map((src, index) => (
                      // eslint-disable-next-line @next/next/no-img-element -- data URL 预览，无需 next/image 优化
                      <img key={index} src={src} alt={`图片 ${index + 1}`} />
                    ))}
                  </div>
                ) : null}
                {message.role === "assistant" ? (
                  <div>
                    {message.responseStatus !== "completed" || message.tool ? <FlowActivity message={message} /> : null}
                    <div className={styles.markdown}>
                      {message.content ? (
                        <ReactMarkdown
                            remarkPlugins={[remarkGfm]}
                            components={{
                              a: (props) => <a {...props} target="_blank" rel="noreferrer noopener" />,
                              blockquote: (props) => <MarkdownBlockquote {...props} />,
                              pre: (props) => <MarkdownPre {...props} />,
                            }}
                          >
                            {normalizeCjkMarkdown(message.content)}
                          </ReactMarkdown>
                      ) : null}
                    </div>
                    {message.imageApproval && imageToolContext ? (
                      <ImageApprovalCard
                        approval={message.imageApproval}
                        context={imageToolContext}
                        onChange={(approval) => updateApproval(message.id, approval)}
                        onSubmit={() => { void submitApproval(message) }}
                      />
                    ) : null}
                    {message.responseStatus === "completed" && message.content ? <ResponseActions content={message.content} /> : null}
                  </div>
                ) : (
                  <p>{message.content}</p>
                )}
              </div>
            ))
          ) : (
            <div className={styles.chatEmpty}>
              <MessageSquare size={22} />
              <strong>开始对话</strong>
            </div>
          )}
            <div ref={endRef} />
          </div>
          {showLatestButton ? (
            <button type="button" className={styles.latestButton} onClick={scrollToLatest} title="返回最新消息" aria-label="返回最新消息">
              <ArrowDown size={14} />
            </button>
          ) : null}
        </div>
      </div>
      <div
        className={`${styles.inputBar} ${dragging ? styles.dragging : ""}`}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={(event) => { void handleDrop(event) }}
      >
        {pendingImages.length ? (
          <div className={styles.previews}>
            {pendingImages.map((item, index) => (
              <div className={styles.previewItem} key={item.id}>
                {/* eslint-disable-next-line @next/next/no-img-element -- data URL 预览，无需 next/image 优化 */}
                <img src={item.dataUrl} alt={`待发送图片 ${index + 1}`} />
                <span className={styles.previewIndex}>{index + 1}</span>
                <button
                  className={styles.previewRemove}
                  onClick={() => setPendingImages((current) => current.filter((image) => image.id !== item.id))}
                  title="移除图片"
                  aria-label={`移除第 ${index + 1} 张图片`}
                >
                  <X size={11} />
                </button>
              </div>
            ))}
          </div>
        ) : null}
        {guest && !chatSettings ? (
          <button type="button" className={styles.configPrompt} onClick={() => setSettingsOpen(true)}>
            <Settings size={13} />
            未配置对话 API，点击配置后使用
          </button>
        ) : (
          <>
            {activeSkill ? (
              <div className={styles.skillChip}>
                <Sparkles size={12} />
                <span title={activeSkill.name}>{activeSkill.name}</span>
                <button type="button" onClick={() => setActiveSkill(null)} title="关闭 Skill" aria-label={`关闭 ${activeSkill.name}`}><X size={12} /></button>
              </div>
            ) : null}
            <AutoTextarea
              className={styles.input}
              value={input}
              onChange={(event) => {
                const next = event.target.value
                setInput(next)
                setSkillManagerOpen(/^\/[^\s]*$/.test(next))
              }}
              onKeyDown={(event) => {
                const slashSelecting = skillManagerOpen && /^\/[^\s]*$/.test(input)
                if (slashSelecting && ["Enter", "ArrowUp", "ArrowDown"].includes(event.key)) return
                if (event.key === "Enter" && !event.shiftKey) { event.preventDefault(); void send() }
              }}
              onPaste={handlePaste}
              placeholder="输入消息，可粘贴或拖拽图片…"
              maxHeight={140}
            />
            <div className={styles.toolbar}>
              <div className={styles.toolbarLeft}>
                <button
                  className={`button icon-button ${styles.toolButton}`}
                  onClick={() => fileInputRef.current?.click()}
                  disabled={streaming || pendingImages.length >= MAX_IMAGES}
                  title="上传图片"
                  aria-label="上传图片"
                >
                  <Plus size={15} />
                </button>
                <input
                  ref={fileInputRef}
                  type="file"
                  accept="image/*"
                  multiple
                  hidden
                  onChange={(event) => {
                    void addImages(event.target.files)
                    event.target.value = ""
                  }}
                />
                <div className={styles.skillMenuAnchor} ref={skillMenuRef}>
                  <button
                    type="button"
                    className={`${styles.skillTrigger} ${activeSkill ? styles.skillTriggerActive : ""}`}
                    onClick={() => setSkillManagerOpen((open) => !open)}
                    aria-expanded={skillManagerOpen}
                    title="选择 Skill"
                  >
                    <Sparkles size={13} />
                    <span>Skill</span>
                  </button>
                  {skillManagerOpen ? (
                    <SkillManager
                      activeSkill={activeSkill}
                      query={input.startsWith("/") ? input.slice(1) : ""}
                      onActivate={(skill) => {
                        setActiveSkill(skill)
                        if (input.startsWith("/")) setInput("")
                      }}
                      onClose={() => setSkillManagerOpen(false)}
                    />
                  ) : null}
                </div>
                <div className={styles.modeMenuAnchor} ref={modeMenuRef}>
                  <button type="button" className={styles.modeTrigger} data-mode={toolMode} onClick={() => setModeMenuOpen((open) => !open)} aria-expanded={modeMenuOpen} title={toolMode === "ask" ? "执行前确认" : "按当前偏好自动执行"}>
                    {toolMode === "ask" ? <CircleHelp size={13} /> : <Bot size={13} />}
                    <span>{toolMode === "ask" ? "Ask" : "Auto"}</span>
                    <ChevronDown size={11} />
                  </button>
                  {modeMenuOpen ? (
                    <div className={styles.modeDropdown} role="menu" aria-label="工具执行模式">
                      <button type="button" role="menuitemradio" aria-checked={toolMode === "ask"} data-active={toolMode === "ask"} onClick={() => changeToolMode("ask")}><CircleHelp size={13} /><span><strong>Ask</strong><small>执行前确认</small></span></button>
                      <button type="button" role="menuitemradio" aria-checked={toolMode === "auto"} data-active={toolMode === "auto"} onClick={() => changeToolMode("auto")}><Bot size={13} /><span><strong>Auto</strong><small>按当前偏好执行</small></span></button>
                    </div>
                  ) : null}
                </div>
              </div>
              <div className={styles.toolbarRight}>
                {chatSettings ? (
                  <div className={styles.modelMenu} ref={modelMenuRef}>
                    <button
                      className={styles.modelTrigger}
                      onClick={() => setModelMenuOpen((open) => !open)}
                      aria-expanded={modelMenuOpen}
                      title="切换模型"
                    >
                      <span>{activeProvider?.name} · {chatSettings.activeModel}</span>
                      <ChevronUp size={12} />
                    </button>
                    {modelMenuOpen ? (
                      <div className={styles.modelDropdown} role="menu">
                        {chatSettings.providers.map((provider) => (
                          <div className={styles.modelGroup} key={provider.id}>
                            <strong>{provider.name}</strong>
                            {provider.models.map((item) => (
                              <button
                                key={`${provider.id}:${item}`}
                                role="menuitem"
                                className={provider.id === chatSettings.activeProviderId && item === chatSettings.activeModel ? styles.modelOptionActive : ""}
                                onClick={() => switchModel(provider.id, item)}
                                title={item}
                              >
                                {item}
                              </button>
                            ))}
                          </div>
                        ))}
                        <button className={styles.manageModels} role="menuitem" onClick={() => { setModelMenuOpen(false); setSettingsOpen(true) }}>
                          管理对话模型…
                        </button>
                      </div>
                    ) : null}
                  </div>
                ) : null}
                <button
                  className="button button-primary icon-button"
                  onClick={streaming ? stopResponse : send}
                  disabled={!streaming && !input.trim() && !pendingImages.length}
                  title={streaming ? "停止" : "发送"}
                  aria-label={streaming ? "停止" : "发送"}
                >
                  {streaming ? <CircleStop size={15} /> : <Send size={15} />}
                </button>
              </div>
            </div>
          </>
        )}
      </div>
      {settingsOpen ? (
        <ChatSettingsDialog
          onSaved={(settings) => {
            setChatSettings(settings)
            setSettingsOpen(false)
          }}
          onCancel={() => setSettingsOpen(false)}
        />
      ) : null}
    </aside>
  )
}
