import assert from "node:assert/strict"
import test from "node:test"

import { compileSkillPrompt } from "./runtime"

test("把本地 Skill 指令与用户请求隔离编译", () => {
  const prompt = compileSkillPrompt({
    name: "写作助手",
    instructions: "先分析，再改写。",
  }, "改写这段话")
  assert.match(prompt, /<skill>\n先分析，再改写。\n<\/skill>/)
  assert.match(prompt, /<user_request>\n改写这段话\n<\/user_request>/)
})
