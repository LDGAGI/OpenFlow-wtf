import assert from "node:assert/strict"
import test from "node:test"

import { parseProviderSettingsJson } from "./provider-settings"

test("v2 media settings migrate profile into adapter and capability profile", () => {
  const settings = parseProviderSettingsJson("image", JSON.stringify({
    version: 2,
    activeConnectionId: "connection-1",
    connections: [{
      version: 2,
      id: "connection-1",
      kind: "image",
      name: "Image API",
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      models: [{ id: "image-prod-v42", profile: "gpt-image-2" }],
      activeModelId: "image-prod-v42",
      confirmed: true,
    }],
  }))

  assert.equal(settings?.connections?.[0]?.version, 3)
  assert.deepEqual(settings?.connections?.[0]?.models[0], {
    id: "image-prod-v42",
    adapter: "openai-image",
    capabilityProfile: "gpt-image-2",
  })
})

test("v3 settings preserve an arbitrary model ID and explicit protocol", () => {
  const settings = parseProviderSettingsJson("video", JSON.stringify({
    version: 3,
    activeConnectionId: "connection-1",
    connections: [{
      version: 3,
      id: "connection-1",
      kind: "video",
      name: "Video API",
      baseUrl: "https://provider.example/v1",
      apiKey: "test-key",
      models: [{
        id: "video-custom-001",
        adapter: "async-video",
        capabilityProfile: "minimax-h3",
      }],
      activeModelId: "video-custom-001",
      confirmed: true,
    }],
  }))

  assert.deepEqual(settings?.connections?.[0]?.models[0], {
    id: "video-custom-001",
    adapter: "async-video",
    capabilityProfile: "minimax-h3",
  })
})
