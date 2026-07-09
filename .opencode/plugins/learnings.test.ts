import { describe, it, expect } from "bun:test"
import { classifyAction } from "./learnings-core"

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
