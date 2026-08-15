import assert from "node:assert/strict"
import test from "node:test"

import { getNanoBananaImageStatus } from "./nano-banana"
import { generateImage, generateVideo } from "./registry"
import type { StandardImageGenerationRequest } from "./types"

const imageRequest: StandardImageGenerationRequest = {
  model: "image-prod-v42",
  prompt: "hello",
  n: 1,
  size: "1024x1024",
  quality: "medium",
  background: "opaque",
  output_format: "png",
  moderation: "auto",
  stream: false,
}

test("an arbitrary image model ID uses the explicitly selected OpenAI image adapter", async () => {
  const originalFetch = globalThis.fetch
  let requestedUrl = ""
  let requestedBody: Record<string, unknown> = {}
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input)
    requestedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return Response.json({ data: [{ url: "https://example.com/generated.png" }] })
  }
  try {
    const result = await generateImage({
      ...imageRequest,
      credentials: {
        baseUrl: "https://provider.example/v1",
        apiKey: "secret",
        adapter: "openai-image",
        capabilityProfile: "gpt-image-2",
      },
    })
    assert.equal(requestedUrl, "https://provider.example/v1/images/generations")
    assert.equal(requestedBody.model, "image-prod-v42")
    assert.equal(result.dispatch, "completed")
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("an arbitrary image model ID uses the explicitly selected async image adapter", async () => {
  const originalFetch = globalThis.fetch
  let requestedBody: Record<string, unknown> = {}
  globalThis.fetch = async (_input, init) => {
    requestedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return Response.json({ task_id: "task-custom", status: "queued" })
  }
  try {
    const result = await generateImage({
      ...imageRequest,
      resolution: "2K",
      credentials: {
        baseUrl: "https://provider.example/v1",
        apiKey: "secret",
        adapter: "async-image",
        capabilityProfile: "nano-banana-2",
      },
    })
    assert.equal(requestedBody.model, "image-prod-v42")
    assert.equal(requestedBody.image_size, "2K")
    assert.deepEqual(result, {
      dispatch: "async",
      providerTaskId: "task-custom",
      providerOperation: "image_generation",
      status: "queued",
    })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("an arbitrary video model ID uses the existing async video adapter", async () => {
  const originalFetch = globalThis.fetch
  let requestedUrl = ""
  let requestedBody: Record<string, unknown> = {}
  globalThis.fetch = async (input, init) => {
    requestedUrl = String(input)
    requestedBody = JSON.parse(String(init?.body)) as Record<string, unknown>
    return Response.json({ data: { task_id: "video-task", status: "queued" } })
  }
  try {
    const result = await generateVideo({
      model: "video-custom-001",
      prompt: "hello",
      duration: 5,
      aspect_ratio: "16:9",
      generate_audio: true,
      resolution: "720p",
      credentials: {
        baseUrl: "https://provider.example/v1",
        apiKey: "secret",
        adapter: "async-video",
        capabilityProfile: "seedance-2.0",
      },
    })
    assert.equal(requestedUrl, "https://provider.example/v1/videos")
    assert.equal(requestedBody.model, "video-custom-001")
    assert.deepEqual(result, { providerTaskId: "video-task", status: "queued" })
  } finally {
    globalThis.fetch = originalFetch
  }
})

test("Nano Banana edit polling selects the edit status path", async () => {
  const originalFetch = globalThis.fetch
  let requestedUrl = ""
  globalThis.fetch = async (input) => {
    requestedUrl = String(input)
    return Response.json({ id: "task-1", status: "running" })
  }
  try {
    const result = await getNanoBananaImageStatus("task-1", "image_edit", {
      baseUrl: "https://provider.example/v1",
      apiKey: "secret",
      adapter: "async-image",
      capabilityProfile: "nano-banana-2",
      paths: { imageEditStatus: "/custom/edits/{taskId}" },
    })
    assert.equal(requestedUrl, "https://provider.example/v1/custom/edits/task-1")
    assert.equal(result.providerOperation, "image_edit")
  } finally {
    globalThis.fetch = originalFetch
  }
})
