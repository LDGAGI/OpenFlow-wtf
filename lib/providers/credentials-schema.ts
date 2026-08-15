import { z } from "zod"

import { MEDIA_ADAPTER_IDS, MODEL_PROFILE_IDS } from "@/lib/provider-models"

const relativePath = z.string().trim().min(1).refine(
  (value) => value.startsWith("/") && !value.startsWith("//") && !value.includes("://"),
  "接口路径必须是以 / 开头的相对路径"
)

export const providerPathsSchema = z.object({
  models: relativePath.optional(),
  imageGenerate: relativePath.optional(),
  imageGenerateStatus: relativePath.optional(),
  imageEdit: relativePath.optional(),
  imageEditStatus: relativePath.optional(),
  imageContent: relativePath.optional(),
  videoCreate: relativePath.optional(),
  videoStatus: relativePath.optional(),
  videoContent: relativePath.optional(),
}).optional()

export const providerCredentialsSchema = z.object({
  baseUrl: z.string().trim().url().refine(
    (value) => value.startsWith("http://") || value.startsWith("https://"),
    "Base URL 必须是 http/https 地址"
  ),
  apiKey: z.string().trim().min(1),
  adapter: z.enum(MEDIA_ADAPTER_IDS),
  capabilityProfile: z.enum(MODEL_PROFILE_IDS),
  paths: providerPathsSchema,
})
