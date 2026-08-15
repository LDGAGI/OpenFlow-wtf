import {
  normalizeReasoningEffort,
  type ChatProtocol,
  type ReasoningEffort,
} from "./chat-capabilities"

export type ChatHistoryMessage = {
  role: "user" | "assistant"
  content: string
  images?: string[]
}

export type ProviderMessage = {
  role: "system" | "user" | "assistant" | "tool"
  tool_call_id?: string
  tool_calls?: {
    id: string
    type: "function"
    function: { name: string; arguments: string }
  }[]
  content:
    | string
    | (
        | { type: "text"; text: string }
        | { type: "image_url"; image_url: { url: string } }
        | { type: "input_text"; text: string }
        | { type: "input_image"; image_url: string }
      )[]
}

export type ChatRequestSettings = {
  protocol: ChatProtocol
  model: string
  reasoningEffort?: ReasoningEffort
}

export function buildProviderMessages(input: {
  protocol: ChatProtocol
  history: ChatHistoryMessage[]
  message: string
  images?: string[]
}): ProviderMessage[] {
  const messages: ProviderMessage[] = input.history.map((message) => {
    if (message.role !== "user" || !message.images?.length) {
      return { role: message.role, content: message.content }
    }
    if (input.protocol === "responses") {
      return {
        role: "user",
        content: [
          { type: "input_text", text: message.content },
          ...message.images.map((url) => ({ type: "input_image" as const, image_url: url })),
        ],
      }
    }
    return {
      role: "user",
      content: [
        { type: "text", text: message.content },
        ...message.images.map((url) => ({
          type: "image_url" as const,
          image_url: { url },
        })),
      ],
    }
  })
  if (!input.images?.length) {
    messages.push({ role: "user", content: input.message })
    return messages
  }

  if (input.protocol === "responses") {
    messages.push({
      role: "user",
      content: [
        { type: "input_text", text: input.message },
        ...input.images.map((url) => ({ type: "input_image" as const, image_url: url })),
      ],
    })
  } else {
    messages.push({
      role: "user",
      content: [
        { type: "text", text: input.message },
        ...input.images.map((url) => ({
          type: "image_url" as const,
          image_url: { url },
        })),
      ],
    })
  }
  return messages
}

export function buildChatRequestBody(
  settings: ChatRequestSettings,
  messages: ProviderMessage[],
  systemPrompt?: string,
  tools?: Record<string, unknown>[]
): Record<string, unknown> {
  const effort = normalizeReasoningEffort(settings.model, settings.reasoningEffort)
  if (settings.protocol === "responses") {
    const input: unknown[] = messages.flatMap((message): unknown[] => {
      if (message.role === "assistant" && message.tool_calls?.length) {
        return message.tool_calls.map((call) => ({
          type: "function_call",
          call_id: call.id,
          name: call.function.name,
          arguments: call.function.arguments,
        }))
      }
      if (message.role === "tool" && message.tool_call_id) {
        return [{ type: "function_call_output", call_id: message.tool_call_id, output: message.content }]
      }
      return [message]
    })
    return {
      model: settings.model,
      input,
      ...(systemPrompt ? { instructions: systemPrompt } : {}),
      stream: true,
      ...(effort ? { reasoning: { effort } } : {}),
      ...(tools?.length ? { tools, tool_choice: "auto" } : {}),
    }
  }
  return {
    model: settings.model,
    messages: systemPrompt
      ? [{ role: "system", content: systemPrompt }, ...messages]
      : messages,
    stream: true,
    ...(effort ? { reasoning_effort: effort } : {}),
    ...(tools?.length ? { tools, tool_choice: "auto" } : {}),
  }
}
