import { z } from "zod"

import { badRequest } from "@/lib/http"
import { isMediaAdapterCompatible, resolveVideoModelCapabilities } from "@/lib/provider-models"
import { providerCredentialsSchema } from "@/lib/providers/credentials-schema"
import { generateVideo } from "@/lib/providers/registry"
import {
  VIDEO_ASPECT_RATIOS,
  VIDEO_DURATIONS,
  VIDEO_RESOLUTIONS,
} from "@/lib/providers/types"
import { validateVideoRequestPolicy } from "@/lib/video-request-policy"

const publicHttpsUrl = z.string().url().refine((value) => value.startsWith("https://"), "参考素材必须是公网 HTTPS URL")

const createSchema = z
  .object({
    credentials: providerCredentialsSchema,
    model: z.string().trim().min(1),
    prompt: z.string().trim().min(1).max(5000),
    duration: z.number().int().min(4).max(30).default(4),
    aspect_ratio: z.enum(VIDEO_ASPECT_RATIOS).default("9:16"),
    generate_audio: z.boolean().default(true),
    resolution: z.enum(VIDEO_RESOLUTIONS).default("480p"),
    reference_mode: z.enum(["frame", "media"]).optional(),
    reference_image_urls: z.array(publicHttpsUrl).max(5).optional(),
    first_image_url: publicHttpsUrl.optional(),
    last_image_url: publicHttpsUrl.optional(),
    reference_videos: z.array(publicHttpsUrl).max(3).optional(),
    reference_audios: z.array(publicHttpsUrl).max(3).optional(),
    negative_prompt: z.string().trim().max(1200).optional(),
    seed: z.number().int().min(0).max(2147483647).optional(),
  })
  .superRefine((value, context) => {
    if (!isMediaAdapterCompatible("video", value.credentials.adapter, value.credentials.capabilityProfile)) {
      context.addIssue({ code: "custom", message: "视频接口与能力模板不匹配", path: ["credentials"] })
      return
    }
    const issues = validateVideoRequestPolicy({
      capabilities: resolveVideoModelCapabilities({
        source: "byok",
        model: value.model,
        capabilityProfile: value.credentials.capabilityProfile,
      }),
      duration: value.duration,
      referenceMode: value.reference_mode,
      referenceImageCount: value.reference_image_urls?.length ?? 0,
      referenceVideoCount: value.reference_videos?.length ?? 0,
      referenceAudioCount: value.reference_audios?.length ?? 0,
      hasFirstFrame: value.first_image_url !== undefined,
      hasLastFrame: value.last_image_url !== undefined,
    })
    for (const issue of issues) {
      context.addIssue({ code: "custom", message: issue.message, path: [issue.path] })
    }
  })

// 纯本地模式的无状态代理：创建视频任务后直接返回，不写任何数据库/磁盘
export async function POST(request: Request) {
  const parsed = createSchema.safeParse(await request.json().catch(() => null))
  if (!parsed.success) return badRequest(parsed.error?.issues[0]?.message ?? "视频参数不合法")

  const { credentials, ...params } = parsed.data
  try {
    const result = await generateVideo({
      model: params.model,
      prompt: params.prompt,
      duration: params.duration as (typeof VIDEO_DURATIONS)[number],
      aspect_ratio: params.aspect_ratio,
      generate_audio: params.generate_audio,
      resolution: params.resolution,
      ...(params.reference_mode ? { reference_mode: params.reference_mode } : {}),
      ...(params.reference_image_urls ? { reference_image_urls: params.reference_image_urls } : {}),
      ...(params.first_image_url ? { first_image_url: params.first_image_url } : {}),
      ...(params.last_image_url ? { last_image_url: params.last_image_url } : {}),
      ...(params.reference_videos ? { reference_videos: params.reference_videos } : {}),
      ...(params.reference_audios ? { reference_audios: params.reference_audios } : {}),
      ...(params.negative_prompt ? { negative_prompt: params.negative_prompt } : {}),
      ...(params.seed !== undefined ? { seed: params.seed } : {}),
      credentials,
    })
    return Response.json(result)
  } catch (error) {
    return Response.json(
      { error: error instanceof Error ? error.message : "视频任务创建失败" },
      { status: 502 }
    )
  }
}
