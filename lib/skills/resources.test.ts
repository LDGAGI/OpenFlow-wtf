import assert from "node:assert/strict"
import test from "node:test"

import { isSafeSkillPath, isReadableSkillFile, readSkillTextFile } from "./resources"

test("Skill 资源路径只允许安全的相对路径", () => {
  assert.equal(isSafeSkillPath("references/method.md"), true)
  assert.equal(isSafeSkillPath("../secrets.txt"), false)
  assert.equal(isSafeSkillPath("/etc/passwd"), false)
  assert.equal(isSafeSkillPath("C:\\secret.txt"), false)
})

test("Skill 资源只读取受支持的文本类型", () => {
  assert.equal(isReadableSkillFile({ path: "guide.json", type: "application/json", size: 10 }), true)
  assert.equal(isReadableSkillFile({ path: "scripts/run.ts", type: "text/typescript", size: 10 }), false)
})

test("读取 Skill 文件返回内容并拒绝缺失文件", async () => {
  const skill = {
    files: [{ path: "references/guide.md", type: "text/markdown", size: 5, content: new Blob(["hello"]) }],
  }
  const result = await readSkillTextFile(skill, "references/guide.md")
  assert.deepEqual(result, { path: "references/guide.md", content: "hello", bytes: 5 })
  await assert.rejects(() => readSkillTextFile(skill, "references/missing.md"), /不存在/)
})
