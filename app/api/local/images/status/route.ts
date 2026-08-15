import { z } from "zod"

import { badRequest } from "@/lib/http"
import { isMediaAdapterCompatible } from "@/lib/provider-models"
import { providerCredentialsSchema } from "@/lib/providers/credentials-schema"
import { getImageStatus } from "@/lib/providers/registry"

const statusSchema = z.object({
  credentials: providerCredentialsSchema,
  model: z.string().trim().min(1),
  providerTaskId: z.string().trim().min(1),
  providerOperation: z.enum(["image_generation", "image_edit"]),
}).superRefine((value, context) => {
  if (!isMediaAdapterCompatible("image", value.credentials.adapter, value.credentials.capabilityProfile)) {
    context.addIssue({ code: "custom", message: "图片接口与能力模板不匹配", path: ["credentials"] })
  }
})

// 纯本地模式的无状态代理：查询用户自己端点上的图片任务状态。
export async function POST(request: Request) {
  const parsed = statusSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return badRequest("查询参数不合法")

  try {
    const { credentials, model, providerTaskId, providerOperation } = parsed.data
    return Response.json(await getImageStatus(
      model,
      providerTaskId,
      providerOperation,
      credentials
    ))
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "图片状态查询失败" },
      { status: 502 }
    )
  }
}
