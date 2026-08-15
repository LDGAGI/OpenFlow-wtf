import type { ModelChannel } from "@/lib/provider-settings"

export type EffectiveChannel = "byok" | "needs-config"

export function resolveEffectiveChannel({
  preferred,
  hasReadyByok,
}: {
  preferred: ModelChannel
  hasReadyByok: boolean
}): EffectiveChannel {
  return hasReadyByok && preferred === "byok" ? "byok" : "needs-config"
}
