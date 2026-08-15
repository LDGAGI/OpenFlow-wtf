/**
 * 图片模型家族在界面中聚合为模型与分辨率选择。
 */

export const IMAGE_MODEL_FAMILIES = [
  { key: "nano-banana2", label: "Nano Banana 2" },
  { key: "nano-banana-pro", label: "Nano Banana Pro" },
] as const

export type ImageModelFamilyKey = (typeof IMAGE_MODEL_FAMILIES)[number]["key"]

export const IMAGE_FAMILY_RESOLUTIONS = ["1K", "2K", "4K"] as const
export type ImageFamilyResolution = (typeof IMAGE_FAMILY_RESOLUTIONS)[number]

const SKU_PATTERN = /^(nano-banana2|nano-banana-pro)-(1k|2k|4k)$/
const UPSTREAM_FIXED_RESOLUTION_PATTERN = /banana.*-(1k|2k|4k)$/i

/** 家族全部 SKU（按家族 × 分辨率展开） */
export const IMAGE_FAMILY_SKUS = IMAGE_MODEL_FAMILIES.flatMap((family) =>
  IMAGE_FAMILY_RESOLUTIONS.map(
    (resolution) => `${family.key}-${resolution.toLowerCase()}` as const
  )
)

/** 命中家族 SKU 时返回家族 key，否则 null */
export function imageModelFamilyKey(model: string): ImageModelFamilyKey | null {
  const match = SKU_PATTERN.exec(model)
  return (match?.[1] as ImageModelFamilyKey | undefined) ?? null
}

/** 命中家族 SKU 时返回分辨率档位（"1K" | "2K" | "4K"），否则 null */
export function imageModelResolution(model: string): ImageFamilyResolution | null {
  const skuMatch = SKU_PATTERN.exec(model)
  if (skuMatch) return skuMatch[2].toUpperCase() as ImageFamilyResolution

  // BYOK 的真实模型 ID 可能带供应商前缀，如 adobe-firefly-nano-banana-pro-2k。
  const upstreamMatch = UPSTREAM_FIXED_RESOLUTION_PATTERN.exec(model)
  return upstreamMatch ? (upstreamMatch[1].toUpperCase() as ImageFamilyResolution) : null
}

/** 家族 + 分辨率 → 上游 SKU */
export function familySku(
  familyKey: ImageModelFamilyKey,
  resolution: ImageFamilyResolution
) {
  return `${familyKey}-${resolution.toLowerCase()}`
}

/** 展示名：家族 SKU → "Nano Banana 2 · 2K"，其余模型原样返回 */
export function imageModelLabel(model: string): string {
  const familyKey = imageModelFamilyKey(model)
  if (!familyKey) return model
  const family = IMAGE_MODEL_FAMILIES.find((item) => item.key === familyKey)
  const resolution = imageModelResolution(model)
  return resolution ? `${family?.label ?? familyKey} · ${resolution}` : model
}
