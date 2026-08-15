import assert from "node:assert/strict"
import test from "node:test"

import { extractProviderModelIds } from "./provider-model-discovery"

test("extracts OpenAI-style model data", () => {
  assert.deepEqual(extractProviderModelIds({ data: [{ id: "seedance-private" }, { id: "gpt-private" }] }), ["seedance-private", "gpt-private"])
})

test("extracts models, items and string arrays", () => {
  assert.deepEqual(extractProviderModelIds({ models: [{ name: "models/gemini-image" }, { model_id: "video-h3" }] }), ["models/gemini-image", "video-h3"])
  assert.deepEqual(extractProviderModelIds({ result: { items: ["model-a", "model-b"] } }), ["model-a", "model-b"])
})

test("ignores unrelated response fields and removes duplicates", () => {
  assert.deepEqual(extractProviderModelIds({ message: "ok", data: [{ id: "model-a" }, { id: "model-a" }] }), ["model-a"])
})
