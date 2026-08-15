import { z } from "zod"

import { listProviderModels } from "@/lib/chat-providers"
import { badRequest } from "@/lib/http"

const listSchema = z.object({
  baseUrl: z.string().trim().url().refine(
    (value) => value.startsWith("http://") || value.startsWith("https://"),
    "Base URL 必须是 http/https 地址"
  ),
  apiKey: z.string().trim().min(1),
  path: z.string().trim().startsWith("/").optional(),
  auth: z.enum(["bearer", "x-api-key", "query", "none"]).default("bearer"),
})

// 纯转发：凭证由调用方自带，无需登录
export async function POST(request: Request) {
  const parsed = listSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return badRequest("参数不合法")

  try {
    const models = await listProviderModels(parsed.data)
    return Response.json({
      models: models.map((item) => item.id),
      capabilities: Object.fromEntries(models.map((item) => [item.id, item.capabilities])),
    })
  } catch (error) {
    return badRequest(error instanceof Error ? error.message : "拉取模型失败")
  }
}
