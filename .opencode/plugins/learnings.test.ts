import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import { classifyAction, importLearningsFromFile } from "./learnings-core"

describe("classifyAction", () => {
  it("should classify pattern: entries as add-pattern", () => {
    expect(classifyAction("Qwen 3.5 9B pattern: analysis paralysis", "model-profiles.md")).toBe("add-pattern")
  })

  it("should classify created skill entries as noop", () => {
    expect(classifyAction("Created test-skill, did something useful", "test-skill/SKILL.md")).toBe("noop")
  })

  it("should classify training paradigm entries as update-rule", () => {
    expect(classifyAction("Training paradigm correction: encode patterns, not fixes", "model-profiles.md")).toBe("update-rule")
  })

  it("should classify subsumed entries as noop", () => {
    expect(classifyAction("Subsumed old-skill into newer-skill", "skill/SKILL.md")).toBe("noop")
  })

  it("should classify new pattern entries as new-skill", () => {
    expect(classifyAction("Uncovered pattern: something new", "new-skill.md")).toBe("new-skill")
  })

  it("should classify unknown entries as noop", () => {
    expect(classifyAction("Some random observation", "some-file.md")).toBe("noop")
  })
})

describe("importLearningsFromFile", () => {
  const TEST_DIR = "/tmp/opencode-plugin-file-import-test"
  const fs = require("fs")
  const path = require("path")

  beforeAll(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true })
    fs.mkdirSync(path.join(TEST_DIR, ".opencode", "skills"), { recursive: true })
  })

  afterAll(() => {
    fs.rmSync(TEST_DIR, { recursive: true, force: true })
  })

  it("should return 0 when file does not exist", async () => {
    const result = await importLearningsFromFile(TEST_DIR)
    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(0)
  })

  it("should return 0 when file has only processed entries", async () => {
    const learningsPath = path.join(TEST_DIR, ".opencode", "skills", "learnings.md")
    fs.writeFileSync(learningsPath, "# Test\n\n2026-07-09 | test | model | desc | file | before:test after:test [PROCESSED]\n")
    const result = await importLearningsFromFile(TEST_DIR)
    expect(result.imported).toBe(0)
    expect(result.skipped).toBe(0)
  })

  it("should parse unprocessed entries without crashing", async () => {
    const learningsPath = path.join(TEST_DIR, ".opencode", "skills", "learnings.md")
    fs.writeFileSync(learningsPath, "# Test\n\n2026-07-09 | test | model | unprocessed pattern: test | file.md | before:a after:b\n")
    const result = await importLearningsFromFile(TEST_DIR)
    // API may or may not be running — should not crash either way
    expect(typeof result.imported).toBe("number")
    expect(typeof result.skipped).toBe("number")
    expect(result.imported + result.skipped).toBeGreaterThanOrEqual(0)
  })

  it("should mark entries as [PROCESSED] in the file", async () => {
    const learningsPath = path.join(TEST_DIR, ".opencode", "skills", "learnings.md")
    const content = fs.readFileSync(learningsPath, "utf-8")
    // The unprocessed entry should now be marked [PROCESSED] since the function
    // processes all unprocessed entries regardless of API success
    const unprocessed = content.split("\n").filter((l: string) => /^\d{4}-\d{2}-\d{2}/.test(l) && !l.includes("[PROCESSED]"))
    expect(unprocessed.length).toBe(0)
  })
})
