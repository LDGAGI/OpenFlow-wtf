import assert from "node:assert/strict"
import test from "node:test"

import { parseImageResponse } from "./image-response"

test("parses an HTTP image URL", () => {
  assert.deepEqual(
    parseImageResponse({ id: "image-1", data: [{ url: "https://example.com/image.png" }] }),
    { dispatch: "completed", remoteUrl: "https://example.com/image.png", providerResponseId: "image-1" }
  )
})

test("normalizes b64_json into a data URL", () => {
  const base64 = "aGVsbG8gd29ybGQgaGVsbG8gd29ybGQgaGVsbG8="
  assert.deepEqual(
    parseImageResponse({ data: [{ b64_json: base64 }] }),
    { dispatch: "completed", remoteUrl: `data:image/png;base64,${base64}`, providerResponseId: undefined }
  )
})

test("parses image_url, top-level images and relative URLs", () => {
  assert.equal(
    parseImageResponse({ data: [{ image_url: "https://example.com/a.png" }] }).remoteUrl,
    "https://example.com/a.png"
  )
  assert.equal(
    parseImageResponse({ images: ["/generated/a.png"] }, "https://provider.example/v1").remoteUrl,
    "https://provider.example/generated/a.png"
  )
})

test("rejects a successful response without image output", () => {
  assert.throws(
    () => parseImageResponse({ data: [{}] }),
    /未返回可保存的 URL 或图片数据/
  )
})
