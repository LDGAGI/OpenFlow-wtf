import { z } from "zod"

import { badRequest } from "@/lib/http"
import { providerCredentialsSchema } from "@/lib/providers/credentials-schema"
import { generateImage } from "@/lib/providers/registry"
import { buildStandardImageRequest } from "@/lib/providers/gpt-image"
import { IMAGE_ASPECT_RATIOS, IMAGE_SIZES } from "@/lib/providers/types"
import { isMediaAdapterCompatible, modelCapabilities } from "@/lib/provider-models"

const createSchema = z.object({
  credentials: providerCredentialsSchema,
  model: z.string().trim().min(1),
  prompt: z.string().trim().min(1).max(4000),
  size: z.enum(IMAGE_SIZES).default("1024x1024"),
  aspect_ratio: z.enum(IMAGE_ASPECT_RATIOS).optional(),
  quality: z.enum(["low", "medium", "high"]).default("medium"),
  resolution: z.enum(["1K", "2K", "4K"]).optional(),
  background: z.enum(["auto", "opaque", "transparent"]).default("opaque"),
  output_format: z.enum(["png", "jpeg", "webp"]).default("png"),
  output_compression: z.number().int().min(0).max(100).optional(),
  reference_images: z.array(z.string().url()).max(16).optional(),
}).superRefine((value, context) => {
  if (!isMediaAdapterCompatible("image", value.credentials.adapter, value.credentials.capabilityProfile)) {
    context.addIssue({ code: "custom", message: "图片接口与能力模板不匹配", path: ["credentials"] })
    return
  }
  const capabilities = modelCapabilities(value.credentials.capabilityProfile)
  if (capabilities?.kind !== "image") return
  if (value.aspect_ratio && !capabilities.aspectRatios.includes(value.aspect_ratio)) {
    context.addIssue({ code: "custom", message: "该模型不支持所选画幅", path: ["aspect_ratio"] })
  }
  if ((value.reference_images?.length ?? 0) > capabilities.maxReferenceImages) {
    context.addIssue({ code: "custom", message: `该模型参考图最多 ${capabilities.maxReferenceImages} 张`, path: ["reference_images"] })
  }
})

// 纯本地模式的无状态代理：只转发到用户自己的端点，不写任何数据库/磁盘
export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return badRequest("生图参数不合法")

  const { credentials, ...params } = parsed.data
  try {
    const result = await generateImage({
      ...buildStandardImageRequest(params),
      ...(params.aspect_ratio ? { aspect_ratio: params.aspect_ratio } : {}),
      ...(params.reference_images?.length ? { reference_images: params.reference_images } : {}),
      credentials,
    })
    return Response.json(result)
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "图片生成失败" },
      { status: 502 }
    )
  }
}
