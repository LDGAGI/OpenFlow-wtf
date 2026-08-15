import assert from "node:assert/strict"
import test from "node:test"

import { getChatModelCapabilities } from "./chat-capabilities"
import { buildChatRequestBody, buildProviderMessages } from "./chat-request"
import { CHAT_SYSTEM_PROMPT } from "./chat-system-prompt"
import { estimateTokens, fitHistoryToBudget } from "./model-context"
import { sseDataLines } from "./sse"

async function collectSse(chunks: string[], options?: Parameters<typeof sseDataLines>[1]) {
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    start(controller) {
      for (const chunk of chunks) controller.enqueue(encoder.encode(chunk))
      controller.close()
    },
  })
  const result: string[] = []
  for await (const item of sseDataLines(stream, options)) result.push(item)
  return result
}

test("用户自定义模型不猜测上下文长度", () => {
  assert.equal(getChatModelCapabilities("custom-reasoner").contextTokens, null)
})

test("按协议生成互不混用的请求字段", () => {
  const messages = buildProviderMessages({
    protocol: "responses",
    history: [],
    message: "看图",
    images: ["data:image/png;base64,abc"],
  })
  const responses = buildChatRequestBody(
    { protocol: "responses", model: "gpt-5.5", reasoningEffort: "high" },
    messages
  )
  assert.deepEqual(responses.reasoning, { effort: "high" })
  assert.equal("reasoning_effort" in responses, false)
  assert.equal((messages[0].content as { type: string }[])[0].type, "input_text")

  const chat = buildChatRequestBody(
    { protocol: "chat-completions", model: "gpt-5.5", reasoningEffort: "medium" },
    [{ role: "user", content: "hello" }]
  )
  assert.equal(chat.reasoning_effort, "medium")
  assert.equal("reasoning" in chat, false)
})

test("历史用户图片会继续作为多模态内容发送", () => {
  const dataUrl = "data:image/png;base64,history"
  const messages = buildProviderMessages({
    protocol: "chat-completions",
    history: [
      { role: "user", content: "这是什么？", images: [dataUrl] },
      { role: "assistant", content: "这是一张图。" },
    ],
    message: "再看一下细节",
  })
  const historicalContent = messages[0]?.content
  assert.ok(Array.isArray(historicalContent))
  assert.deepEqual(historicalContent[1], {
    type: "image_url",
    image_url: { url: dataUrl },
  })
})

test("Chat Completions 可声明原生图片工具并携带工具结果续答", () => {
  const tools = [{
    type: "function",
    function: {
      name: "generate_image",
      parameters: { type: "object" },
    },
  }]
  const messages = [
    { role: "user" as const, content: "生成一张日落图片" },
    {
      role: "assistant" as const,
      content: "",
      tool_calls: [{
        id: "call_1",
        type: "function" as const,
        function: { name: "generate_image", arguments: '{"prompt":"日落"}' },
      }],
    },
    { role: "tool" as const, tool_call_id: "call_1", content: '{"ok":true}' },
  ]
  const body = buildChatRequestBody(
    { protocol: "chat-completions", model: "k3" },
    messages,
    CHAT_SYSTEM_PROMPT,
    tools
  )
  assert.deepEqual(body.tools, tools)
  assert.equal(body.tool_choice, "auto")
  assert.deepEqual((body.messages as typeof messages).slice(-2), messages.slice(-2))
})

test("按协议映射系统提示词", () => {
  const messages = [{ role: "user" as const, content: "hello" }]
  const responses = buildChatRequestBody(
    { protocol: "responses", model: "gpt-5.5" },
    messages,
    CHAT_SYSTEM_PROMPT
  )
  assert.equal(responses.instructions, CHAT_SYSTEM_PROMPT)
  assert.deepEqual(responses.input, messages)

  const chat = buildChatRequestBody(
    { protocol: "chat-completions", model: "gpt-5.5" },
    messages,
    CHAT_SYSTEM_PROMPT
  )
  assert.deepEqual((chat.messages as { role: string; content: string }[])[0], {
    role: "system",
    content: CHAT_SYSTEM_PROMPT,
  })
})

test("上下文估算对中文保守，并为图片预留预算", () => {
  assert.ok(estimateTokens("你".repeat(100)) > 100)
  const history = Array.from({ length: 40 }, (_, index) => ({
    role: "user" as const,
    content: `${index} ${"你".repeat(8000)}`,
  }))
  const picked = fitHistoryToBudget({
    messages: history,
    model: "gpt-5.5",
    currentMessage: "分析图片",
    currentImages: 9,
  })
  assert.ok(picked.length < history.length)
})

test("SSE 兼容 CRLF、分片边界、多行 data 和尾帧", async () => {
  const result = await collectSse([
    "event: response.output_text.delta\r\ndata: {\"delta\":\"你\"}\r",
    "\ndata: {\"delta\":\"好\"}\r\n\r\n",
    "data: [DONE]",
  ])
  assert.deepEqual(result, ['{"delta":"你"}\n{"delta":"好"}', "[DONE]"])
})
