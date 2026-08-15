import { z } from "zod"

import { CHAT_PROTOCOLS, REASONING_EFFORTS } from "@/lib/chat-capabilities"
import { streamChat } from "@/lib/chat-providers"
import { badRequest } from "@/lib/http"
import { compileSkillPrompt } from "@/lib/skills/runtime"
import type { ChatImageToolContext } from "@/lib/chat-image-tools"

const chatSchema = z.object({
  message: z.string().trim().min(1).max(8000),
  history: z
    .array(
      z.object({
        role: z.enum(["user", "assistant"]),
        content: z.string().min(1).max(8000),
        images: z.array(z.string().max(7_000_000)).max(9).optional(),
      })
    )
    // 条数放宽：真正的上限是总字符（≈token 预算），短消息对话可以带很多条
    .max(200)
    .refine(
      (items) => items.reduce((sum, item) => sum + item.content.length, 0) <= 512_000,
      "历史消息总长度超出上下文预算"
    )
    .optional(),
  images: z.array(z.string().max(7_000_000)).max(9).optional(),
  toolMode: z.enum(["ask", "auto"]).default("ask"),
  imageToolContext: z.object({
    current: z.object({
      modelOption: z.object({ source: z.literal("byok"), model: z.string(), connectionId: z.string().optional(), adapter: z.string().optional(), capabilityProfile: z.string().optional(), label: z.string().optional() }),
      aspectRatio: z.string(),
      resolution: z.enum(["1K", "2K", "4K"]).optional(),
      quality: z.enum(["low", "medium", "high"]),
      background: z.enum(["auto", "opaque", "transparent"]),
      outputFormat: z.enum(["png", "jpeg", "webp"]),
    }),
    models: z.array(z.object({
      source: z.literal("byok"), model: z.string(), connectionId: z.string().optional(), adapter: z.string().optional(), capabilityProfile: z.string().optional(), label: z.string(),
      aspectRatios: z.array(z.string()), resolutions: z.array(z.enum(["1K", "2K", "4K"])),
      qualities: z.array(z.enum(["low", "medium", "high"])), backgrounds: z.array(z.enum(["auto", "opaque", "transparent"])),
      outputFormats: z.array(z.enum(["png", "jpeg", "webp"])), points: z.number().int().nonnegative().nullable(),
    })).max(100),
  }).optional(),
  skill: z
    .object({
      name: z.string().trim().min(1).max(120),
      instructions: z.string().trim().min(1).max(200_000),
      files: z.array(z.object({ path: z.string().min(1).max(500), type: z.string().max(120), size: z.number().int().nonnegative().max(10_000_000) })).max(500).optional(),
    })
    .optional(),
  toolContinuation: z.object({
    id: z.string().min(1).max(200),
    name: z.enum(["generate_image", "propose_image_generation", "read_skill_file"]),
    arguments: z.string().max(20_000),
    result: z.string().max(20_000),
  }).optional(),
  settings: z
    .object({
      protocol: z.enum(CHAT_PROTOCOLS),
      baseUrl: z.string().trim().url().refine(
        (value) => value.startsWith("http://") || value.startsWith("https://"),
        "Base URL 必须是 http/https 地址"
      ),
      apiKey: z.string().trim().min(1),
      model: z.string().trim().min(1),
      reasoningEffort: z.enum(REASONING_EFFORTS).optional(),
    })
    .optional(),
})

function event(name: "reasoning.delta" | "message.delta" | "tool.requested" | "message.completed" | "error", data: unknown) {
  return `event: ${name}\ndata: ${JSON.stringify(data)}\n\n`
}

export async function POST(request: Request) {
  const parsed = chatSchema.safeParse(await request.json())
  if (!parsed.success) {
    const issue = parsed.error.issues[0]
    const field = issue?.path.length ? issue.path.join(".") : "请求"
    return badRequest(`${field} 参数不合法：${issue?.message ?? "格式错误"}`)
  }

  const { message, history, images, settings, skill, toolContinuation, toolMode, imageToolContext } = parsed.data
  const effectiveMessage = skill ? compileSkillPrompt(skill, message) : message
  if (!settings) return badRequest("请先配置对话 API")
  const encoder = new TextEncoder()
  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      try {
        const deltas = streamChat({
          settings,
          history: history ?? [],
          message: effectiveMessage,
          images,
          toolMode,
          imageToolContext: imageToolContext as ChatImageToolContext | undefined,
          toolContinuation,
          signal: request.signal,
        })
        for await (const item of deltas) {
          if (request.signal.aborted) break
          if (typeof item === "string") {
            controller.enqueue(encoder.encode(event("message.delta", { delta: item })))
          } else if (item.type === "text") {
            controller.enqueue(encoder.encode(event("message.delta", { delta: item.delta })))
          } else if (item.type === "reasoning") {
            controller.enqueue(encoder.encode(event("reasoning.delta", { delta: item.delta })))
          } else {
            controller.enqueue(encoder.encode(event("tool.requested", item)))
          }
        }
        if (!request.signal.aborted) {
          controller.enqueue(encoder.encode(event("message.completed", {})))
        }
      } catch (error) {
        if (!request.signal.aborted) {
          controller.enqueue(
            encoder.encode(
              event("error", {
                message:
                  error instanceof Error && error.name === "AbortError"
                    ? "已停止"
                    : error instanceof Error
                      ? error.message
                      : "对话失败",
              })
            )
          )
        }
      } finally {
        controller.close()
      }
    },
  })

  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache, no-transform",
      Connection: "keep-alive",
      "X-Accel-Buffering": "no",
    },
  })
}
