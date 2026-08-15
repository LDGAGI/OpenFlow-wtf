import assert from "node:assert/strict"
import test from "node:test"

import { buildGptImageEditForm, buildStandardImageRequest } from "./gpt-image"
import { buildNanoBananaEditForm, buildNanoBananaRequest } from "./nano-banana"
import { buildVideoModelRequest } from "./video-models"
import type { StandardImageEditRequest } from "./types"

const editRequest: StandardImageEditRequest = {
  model: "private-gpt-image-id",
  prompt: "hello",
  n: 1,
  size: "1024x1024",
  quality: "high",
  background: "opaque",
  output_format: "png",
  moderation: "auto",
  stream: false,
  reference_images: ["data:image/png;base64,aGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8="],
}

const loadedImage = { blob: new Blob(["image"], { type: "image/png" }), fileName: "reference.png" }

test("GPT Image 2 request keeps its complete supported parameter set", () => {
  assert.deepEqual(buildStandardImageRequest({
    model: "private-gpt-image-id",
    prompt: "hello",
    size: "1536x864",
    quality: "high",
    background: "transparent",
    output_format: "webp",
    output_compression: 82,
  }), {
    model: "private-gpt-image-id",
    prompt: "hello",
    n: 1,
    size: "1536x864",
    quality: "high",
    background: "transparent",
    output_format: "webp",
    output_compression: 82,
    moderation: "auto",
    stream: false,
  })
})

test("Nano Banana request converts size and reference parameters", () => {
  assert.deepEqual(buildNanoBananaRequest({
    model: "private-banana-id",
    prompt: "hello",
    size: "768x1024",
    resolution: "4K",
    aspect_ratio: "21:9",
  }), {
    model: "private-banana-id",
    prompt: "hello",
    n: 1,
    aspect_ratio: "21:9",
    image_size: "4K",
    async: true,
  })
})

test("Nano Banana fixed SKU overrides a stale client resolution", () => {
  const body = buildNanoBananaRequest({
    model: "nano-banana-pro-2k",
    prompt: "hello",
    size: "1024x1024",
    resolution: "1K",
  })
  assert.equal(body.image_size, "2K")

  const form = buildNanoBananaEditForm(
    { ...editRequest, model: "nano-banana2-4k", resolution: "1K" },
    [loadedImage],
    "1K"
  )
  assert.equal(form.get("image_size"), "4K")

  const prefixed = buildNanoBananaRequest({
    model: "adobe-firefly-nano-banana-pro-2k",
    prompt: "hello",
    size: "1024x1024",
    resolution: "1K",
  })
  assert.equal(prefixed.image_size, "2K")
})

test("GPT Image edit uses multipart files and does not force URL responses", () => {
  const single = buildGptImageEditForm(editRequest, [loadedImage])
  assert.equal(single.get("image") instanceof Blob, true)
  assert.equal(single.getAll("image[]").length, 0)
  assert.equal(single.get("input_fidelity"), "high")
  assert.equal(single.has("response_format"), false)

  const multiple = buildGptImageEditForm(editRequest, [loadedImage, loadedImage])
  assert.equal(multiple.getAll("image[]").length, 2)
  assert.equal(multiple.has("image"), false)
})

test("Nano Banana edit uses its multipart async protocol", () => {
  const form = buildNanoBananaEditForm(
    { ...editRequest, model: "nano-banana2-1k", aspect_ratio: "1:1", resolution: "1K" },
    [loadedImage],
    "1K"
  )
  assert.equal(form.get("model"), "nano-banana2-1k")
  assert.equal(form.get("aspect_ratio"), "1:1")
  assert.equal(form.get("image_size"), "1K")
  assert.equal(form.get("async"), "true")
  assert.equal(form.get("image") instanceof Blob, true)
})

test("MiniMax H3 uses its canonical capabilities and strips unsupported parameters", () => {
  const body = buildVideoModelRequest({
    model: "private-minimax-id",
    prompt: "hello",
    duration: 5,
    aspect_ratio: "16:9",
    generate_audio: true,
    resolution: "720p",
    reference_mode: "media",
    reference_image_urls: ["https://example.com/image.png"],
    reference_videos: ["https://example.com/video.mp4"],
    reference_audios: ["https://example.com/audio.mp3"],
    negative_prompt: "bad",
    seed: 42,
    credentials: { baseUrl: "https://provider.example/v1", apiKey: "secret", adapter: "async-video", capabilityProfile: "minimax-h3" },
  })
  assert.equal(body.model, "private-minimax-id")
  assert.equal("resolution" in body, false)
  assert.equal("reference_videos" in body, false)
  assert.deepEqual(body.reference_image_urls, ["https://example.com/image.png"])
  assert.deepEqual(body.reference_audios, ["https://example.com/audio.mp3"])
  assert.equal("credentials" in body, false)
})
