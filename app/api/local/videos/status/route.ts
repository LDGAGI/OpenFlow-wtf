import { z } from "zod"

import { badRequest } from "@/lib/http"
import { isMediaAdapterCompatible } from "@/lib/provider-models"
import { providerCredentialsSchema } from "@/lib/providers/credentials-schema"
import { getVideoStatus } from "@/lib/providers/registry"

const statusSchema = z.object({
  credentials: providerCredentialsSchema,
  providerTaskId: z.string().trim().min(1),
}).superRefine((value, context) => {
  if (!isMediaAdapterCompatible("video", value.credentials.adapter, value.credentials.capabilityProfile)) {
    context.addIssue({ code: "custom", message: "视频接口与能力模板不匹配", path: ["credentials"] })
  }
})

// 纯本地模式的无状态代理：查询用户自己端点上的视频任务状态
export async function POST(request: Request) {
  const parsed = statusSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return badRequest("查询参数不合法")

  try {
    const result = await getVideoStatus(parsed.data.providerTaskId, parsed.data.credentials)
    return Response.json(result)
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "视频状态查询失败" },
      { status: 502 }
    )
  }
}
