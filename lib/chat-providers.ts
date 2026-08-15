import "server-only"

import { describeChatModel, type ChatProtocol, type ReasoningEffort } from "./chat-capabilities"
import { CHAT_SYSTEM_PROMPT } from "./chat-system-prompt"
import {
  buildChatRequestBody,
  buildProviderMessages,
  type ChatHistoryMessage,
  type ProviderMessage,
} from "./chat-request"
import { fitHistoryToBudget } from "./model-context"
import { extractProviderModelIds } from "./provider-model-discovery"
import { sseDataLines } from "./sse"
import type { ChatImageToolContext, ChatToolMode } from "./chat-image-tools"

export type { ChatProtocol, ReasoningEffort }

type ChatToolName = "generate_image" | "propose_image_generation" | "read_skill_file"

export type ChatStreamEvent =
  | { type: "text"; delta: string }
  | { type: "reasoning"; delta: string }
  | { type: "tool_call"; id: string; name: ChatToolName; arguments: string }

export type ChatToolContinuation = {
  id: string
  name: ChatToolName
  arguments: string
  result: string
}

export type ChatSettingsInput = {
  protocol: ChatProtocol
  baseUrl: string
  apiKey: string
  model: string
  /** 思考级别；undefined 时不向供应商传该参数（兼容不支持的端点） */
  reasoningEffort?: ReasoningEffort
}

const OPENFLOW_USER_AGENT = "OpenFlow/0.1.0"

function imageTool(mode: ChatToolMode, context?: ChatImageToolContext) {
  const models = context?.models ?? []
  const modelIds = models.map((item) => item.model)
  const ratios = [...new Set(models.flatMap((item) => item.aspectRatios))]
  const resolutions = [...new Set(models.flatMap((item) => item.resolutions))]
  const qualities = [...new Set(models.flatMap((item) => item.qualities))]
  const backgrounds = [...new Set(models.flatMap((item) => item.backgrounds))]
  const outputFormats = [...new Set(models.flatMap((item) => item.outputFormats))]
  const name = mode === "ask" ? "propose_image_generation" : "generate_image"
  return {
    type: "function",
    function: {
      name,
      description: mode === "ask"
        ? `准备一份图片生成提案供用户确认，不得直接执行。只填写用户明确表达的可选参数；缺失参数由应用按所选模型的真实能力补全。`
        : `直接提交图片生成。只有用户明确要求生成图片时调用；只填写用户明确表达的可选参数，缺失参数由应用按当前模型的真实能力补全，不得自行提高分辨率、质量或数量。`,
      parameters: {
        type: "object",
        properties: {
          prompt: { type: "string", description: "可直接用于图片生成的完整提示词" },
          ...(modelIds.length ? { model: { type: "string", enum: modelIds } } : {}),
          ...(ratios.length ? { aspectRatio: { type: "string", enum: ratios } } : {}),
          ...(resolutions.length ? { resolution: { type: "string", enum: resolutions } } : {}),
          ...(qualities.length ? { quality: { type: "string", enum: qualities } } : {}),
          ...(backgrounds.length ? { background: { type: "string", enum: backgrounds } } : {}),
          ...(outputFormats.length ? { outputFormat: { type: "string", enum: outputFormats } } : {}),
          count: { type: "integer", minimum: 1, maximum: 9, description: "生成数量；用户未明确要求时必须为 1" },
        },
        required: ["prompt", "count"],
        additionalProperties: false,
      },
    },
  }
}

const READ_SKILL_TOOL =
  {
    type: "function",
    function: {
      name: "read_skill_file",
      description: "读取当前 Skill 清单中的一份文本参考文件。只能传入清单中的精确相对路径。",
      parameters: {
        type: "object",
        properties: { path: { type: "string", description: "Skill 文件清单中的相对路径" } },
        required: ["path"],
        additionalProperties: false,
      },
    },
  }

function chatTools(mode: ChatToolMode, context?: ChatImageToolContext) {
  return [imageTool(mode, context), READ_SKILL_TOOL]
}

function responsesTools(mode: ChatToolMode, context?: ChatImageToolContext) {
  return chatTools(mode, context).map((tool) => {
  const fn = tool.function
  return { type: "function", name: fn.name, description: fn.description, parameters: fn.parameters, strict: false }
  })
}

export function normalizeBaseUrl(baseUrl: string) {
  return baseUrl.trim().replace(/\/+$/, "")
}

async function readErrorMessage(response: Response) {
  const text = await response.text().catch(() => "")
  let detail = text.slice(0, 300)
  try {
    const parsed = JSON.parse(text) as { error?: { message?: string } }
    if (parsed.error?.message) detail = parsed.error.message
  } catch {
    // 保留原始文本
  }
  if (response.status === 401 || response.status === 403) return "API Key 无效或没有权限"
  if (response.status === 404) return "端点不存在或不是 OpenAI 兼容接口"
  if (response.status === 429) return "触发供应商限流，请稍后重试"
  return `供应商返回错误（${response.status}）：${detail || "无详细信息"}`
}

/** 上游返回 200 却没有任何有效文本分片时抛出，避免前端永远停在「正在响应…」 */
function emptyStreamError(response: Response, raw: { text: string }) {
  const detail = raw.text.replace(/\s+/g, " ").trim().slice(0, 200)
  return new Error(
    `供应商返回了空响应（HTTP ${response.status}，Content-Type: ${response.headers.get("content-type") ?? "未知"}）` +
      (detail ? `：${detail}` : "，无任何响应体")
  )
}

/** 高思考等级可能在响应头前等待较久，连接阶段给足时间但不能无限悬挂。 */
const CONNECTION_TIMEOUT_MS = 120_000

function linkedUpstreamSignal(signal: AbortSignal) {
  const controller = new AbortController()
  let connectionTimedOut = false
  const abort = () => controller.abort(signal.reason)
  if (signal.aborted) abort()
  else signal.addEventListener("abort", abort, { once: true })
  const timer = setTimeout(() => {
    connectionTimedOut = true
    controller.abort()
  }, CONNECTION_TIMEOUT_MS)
  return {
    signal: controller.signal,
    connected() {
      clearTimeout(timer)
    },
    dispose() {
      clearTimeout(timer)
      signal.removeEventListener("abort", abort)
    },
    didConnectionTimeout: () => connectionTimedOut,
  }
}

async function openProviderStream(input: {
  url: string
  apiKey: string
  body: Record<string, unknown>
  signal: AbortSignal
}) {
  const linked = linkedUpstreamSignal(input.signal)
  try {
    const response = await fetch(input.url, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${input.apiKey}`,
        "User-Agent": OPENFLOW_USER_AGENT,
      },
      body: JSON.stringify(input.body),
      signal: linked.signal,
    })
    linked.connected()
    return { response, dispose: linked.dispose }
  } catch (error) {
    linked.dispose()
    if (linked.didConnectionTimeout()) throw new Error("连接供应商超时，请稍后重试")
    if (input.signal.aborted || (error instanceof Error && error.name === "AbortError")) {
      throw error
    }
    throw new Error("无法连接该端点，请检查 Base URL 或网络")
  }
}

function nestedMessage(value: unknown): string | null {
  if (!value || typeof value !== "object") return null
  const record = value as Record<string, unknown>
  if (typeof record.message === "string") return record.message
  return nestedMessage(record.error)
}

function responseCompletedText(value: unknown): string {
  if (!value || typeof value !== "object") return ""
  const response = (value as Record<string, unknown>).response
  if (!response || typeof response !== "object") return ""
  const output = (response as Record<string, unknown>).output
  if (!Array.isArray(output)) return ""
  const parts: string[] = []
  for (const item of output) {
    if (!item || typeof item !== "object") continue
    const content = (item as Record<string, unknown>).content
    if (!Array.isArray(content)) continue
    for (const part of content) {
      if (!part || typeof part !== "object") continue
      const record = part as Record<string, unknown>
      if (
        (record.type === "output_text" || record.type === "refusal") &&
        typeof record.text === "string"
      ) {
        parts.push(record.text)
      }
      if (record.type === "refusal" && typeof record.refusal === "string") {
        parts.push(record.refusal)
      }
    }
  }
  return parts.join("")
}

async function* streamChatCompletions(
  settings: ChatSettingsInput,
  messages: ProviderMessage[],
  signal: AbortSignal,
  tools?: Record<string, unknown>[]
) {
  const upstream = await openProviderStream({
    url: `${normalizeBaseUrl(settings.baseUrl)}/chat/completions`,
    apiKey: settings.apiKey,
    body: buildChatRequestBody(settings, messages, CHAT_SYSTEM_PROMPT, tools),
    signal,
  })
  const { response } = upstream
  try {
    if (!response.ok) throw new Error(await readErrorMessage(response))
    if (!response.body) throw new Error("供应商未返回流式内容")

    const raw: { text: string } = { text: "" }
    let yielded = 0
    const toolCalls = new Map<number, { id: string; name: string; arguments: string }>()
    for await (const data of sseDataLines(response.body, { rawSink: raw })) {
      if (data === "[DONE]") break
      let parsed: {
        error?: unknown
        choices?: { delta?: {
          content?: string
          refusal?: string
          reasoning_content?: string
          reasoning?: string | { content?: string }
          tool_calls?: { index?: number; id?: string; function?: { name?: string; arguments?: string } }[]
        } }[]
      }
      try {
        parsed = JSON.parse(data) as typeof parsed
      } catch {
        continue
      }
      const error = nestedMessage(parsed.error)
      if (error) throw new Error(error)
      const delta = parsed.choices?.[0]?.delta
      const reasoning = delta?.reasoning_content ??
        (typeof delta?.reasoning === "string" ? delta.reasoning : delta?.reasoning?.content)
      if (reasoning) {
        yielded++
        yield { type: "reasoning", delta: reasoning } satisfies ChatStreamEvent
      }
      for (const chunk of delta?.tool_calls ?? []) {
        const index = chunk.index ?? 0
        const current = toolCalls.get(index) ?? { id: "", name: "", arguments: "" }
        if (chunk.id) current.id = chunk.id
        if (chunk.function?.name) current.name += chunk.function.name
        if (chunk.function?.arguments) current.arguments += chunk.function.arguments
        toolCalls.set(index, current)
      }
      const text = delta?.content ?? delta?.refusal
      if (text) {
        yielded++
        yield { type: "text", delta: text } satisfies ChatStreamEvent
      }
    }
    const toolCall = [...toolCalls.values()].find((item) => item.name === "generate_image" || item.name === "propose_image_generation" || item.name === "read_skill_file")
    if (toolCall?.id) {
      yielded++
      yield { type: "tool_call", id: toolCall.id, name: toolCall.name as ChatToolName, arguments: toolCall.arguments } satisfies ChatStreamEvent
    }
    if (!yielded) throw emptyStreamError(response, raw)
  } finally {
    upstream.dispose()
  }
}

async function* streamResponses(
  settings: ChatSettingsInput,
  messages: ProviderMessage[],
  signal: AbortSignal,
  tools?: Record<string, unknown>[]
) {
  const upstream = await openProviderStream({
    url: `${normalizeBaseUrl(settings.baseUrl)}/responses`,
    apiKey: settings.apiKey,
    body: buildChatRequestBody(settings, messages, CHAT_SYSTEM_PROMPT, tools),
    signal,
  })
  const { response } = upstream
  try {
    if (!response.ok) throw new Error(await readErrorMessage(response))
    if (!response.body) throw new Error("供应商未返回流式内容")

    const raw: { text: string } = { text: "" }
    let yielded = 0
    let toolCall: { id: string; name: string; arguments: string } | null = null
    for await (const data of sseDataLines(response.body, { rawSink: raw })) {
      if (data === "[DONE]") break
      let parsed: Record<string, unknown>
      try {
        parsed = JSON.parse(data) as Record<string, unknown>
      } catch {
        continue
      }
      if (parsed.type === "error" || parsed.type === "response.failed") {
        throw new Error(nestedMessage(parsed) ?? "供应商生成失败")
      }
      if (parsed.type === "response.incomplete") {
        throw new Error(nestedMessage(parsed) ?? "供应商响应不完整")
      }
      if (parsed.type === "response.output_item.added" && parsed.item && typeof parsed.item === "object") {
        const item = parsed.item as Record<string, unknown>
        if (item.type === "function_call" && typeof item.call_id === "string" && typeof item.name === "string") {
          toolCall = { id: item.call_id, name: item.name, arguments: typeof item.arguments === "string" ? item.arguments : "" }
        }
      }
      if (parsed.type === "response.function_call_arguments.delta" && toolCall && typeof parsed.delta === "string") {
        toolCall.arguments += parsed.delta
      }
      if (parsed.type === "response.output_item.done" && parsed.item && typeof parsed.item === "object") {
        const item = parsed.item as Record<string, unknown>
        if (item.type === "function_call" && typeof item.call_id === "string" && typeof item.name === "string") {
          toolCall = { id: item.call_id, name: item.name, arguments: typeof item.arguments === "string" ? item.arguments : toolCall?.arguments ?? "" }
        }
      }
      if (
        (parsed.type === "response.output_text.delta" ||
          parsed.type === "response.refusal.delta") &&
        typeof parsed.delta === "string"
      ) {
        yielded++
        yield { type: "text", delta: parsed.delta } satisfies ChatStreamEvent
      }
      if (
        (parsed.type === "response.reasoning_summary_text.delta" ||
          parsed.type === "response.reasoning_text.delta") &&
        typeof parsed.delta === "string"
      ) {
        yielded++
        yield { type: "reasoning", delta: parsed.delta } satisfies ChatStreamEvent
      }
      if (parsed.type === "response.completed" && !yielded) {
        const text = responseCompletedText(parsed)
        if (text) {
          yielded++
          yield { type: "text", delta: text } satisfies ChatStreamEvent
        }
      }
    }
    if (toolCall && (toolCall.name === "generate_image" || toolCall.name === "propose_image_generation" || toolCall.name === "read_skill_file")) {
      yielded++
      yield { type: "tool_call", id: toolCall.id, name: toolCall.name, arguments: toolCall.arguments } satisfies ChatStreamEvent
    }
    if (!yielded) throw emptyStreamError(response, raw)
  } finally {
    upstream.dispose()
  }
}

/** 统一入口：按协议流式调用 OpenAI 兼容接口，产出文本 delta */
export function streamChat(input: {
  settings: ChatSettingsInput
  history: ChatHistoryMessage[]
  message: string
  images?: string[]
  toolMode?: ChatToolMode
  imageToolContext?: ChatImageToolContext
  toolContinuation?: ChatToolContinuation
  signal: AbortSignal
}): AsyncIterable<ChatStreamEvent> {
  const history = fitHistoryToBudget({
    messages: input.history,
    model: input.settings.model,
    currentMessage: input.message,
    currentImages: input.images?.length,
  })
  const messages = buildProviderMessages({
    protocol: input.settings.protocol,
    history,
    message: input.message,
    images: input.images,
  })
  if (input.toolContinuation) {
    messages.push({
      role: "assistant",
      content: "",
      tool_calls: [{
        id: input.toolContinuation.id,
        type: "function",
        function: {
          name: input.toolContinuation.name,
          arguments: input.toolContinuation.arguments,
        },
      }],
    })
    messages.push({
      role: "tool",
      tool_call_id: input.toolContinuation.id,
      content: input.toolContinuation.result,
    })
  }
  const mode = input.toolMode ?? "ask"
  return input.settings.protocol === "responses"
    ? streamResponses(input.settings, messages, input.signal, responsesTools(mode, input.imageToolContext))
    : streamChatCompletions(input.settings, messages, input.signal, chatTools(mode, input.imageToolContext))
}

/** 拉取供应商模型列表 */
export async function listProviderModels(input: {
  baseUrl: string
  apiKey: string
  path?: string
  auth?: "bearer" | "x-api-key" | "query" | "none"
}) {
  const auth = input.auth ?? "bearer"
  const path = input.path?.trim() || "/models"
  const url = new URL(`${normalizeBaseUrl(input.baseUrl)}${path.startsWith("/") ? path : `/${path}`}`)
  const headers = new Headers()
  headers.set("User-Agent", OPENFLOW_USER_AGENT)
  if (auth === "bearer") headers.set("Authorization", `Bearer ${input.apiKey}`)
  if (auth === "x-api-key") {
    headers.set("x-api-key", input.apiKey)
    headers.set("x-goog-api-key", input.apiKey)
  }
  if (auth === "query") url.searchParams.set("key", input.apiKey)
  let response: Response
  try {
    response = await fetch(url, {
      headers,
      signal: AbortSignal.timeout(8000),
    })
  } catch {
    throw new Error("无法连接该端点，请检查 Base URL")
  }
  if (!response.ok) throw new Error(await readErrorMessage(response))
  const text = await response.text()
  if (text.trimStart().startsWith("<")) {
    throw new Error("模型列表地址返回了网页内容，请检查 Base URL 或在高级设置中填写模型列表路径")
  }
  let parsed: unknown
  try {
    parsed = JSON.parse(text)
  } catch {
    throw new Error("模型列表接口未返回有效 JSON，请检查模型列表路径")
  }
  const models = extractProviderModelIds(parsed)
  if (!models.length) {
    throw new Error("接口返回成功，但未识别到模型 ID；该供应商可能不提供模型列表，请手动添加")
  }
  return models.sort().map(describeChatModel)
}
