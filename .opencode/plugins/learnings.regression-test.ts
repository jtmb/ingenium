import { describe, it, expect, beforeAll, afterAll } from "bun:test"
import fs from "fs"
import path from "path"
import crypto from "crypto"

const ROOT = "/home/brajam/repos/gh-llm-bootstrap"
const TEST_DIR = "/tmp/opencode-plugin-regression"
const SKILLS_DIR = path.join(TEST_DIR, ".opencode/skills")
const LOCAL_MODELS_DIR = path.join(SKILLS_DIR, "local-models/references")

// Real files we copy — never modify originals
const REAL_MODEL_PROFILES = path.join(ROOT, ".opencode/skills/local-models/references/model-profiles.md")

let originalHash: string
let sectionHeader: string

function setup() {
  // Clean and recreate test dir
  fs.rmSync(TEST_DIR, { recursive: true, force: true })
  fs.mkdirSync(LOCAL_MODELS_DIR, { recursive: true })

  // Copy REAL model-profiles.md
  const realContent = fs.readFileSync(REAL_MODEL_PROFILES, "utf-8")
  originalHash = crypto.createHash("sha256").update(realContent).digest("hex")
  sectionHeader = realContent.includes("**🔴 Model-Aware Hints") ? "**🔴 Model-Aware Hints" : "NOT FOUND"
  fs.writeFileSync(path.join(LOCAL_MODELS_DIR, "model-profiles.md"), realContent)
}

function teardown() {
  fs.rmSync(TEST_DIR, { recursive: true, force: true })
}

describe("regression: real model-profiles.md", () => {
  beforeAll(setup)
  afterAll(teardown)

  it("should detect the Model-Aware Hints section header in the real file", () => {
    expect(sectionHeader).not.toBe("NOT FOUND")
  })

  it("should NOT modify the original model-profiles.md file when reading", () => {
    const currentContent = fs.readFileSync(REAL_MODEL_PROFILES, "utf-8")
    const currentHash = crypto.createHash("sha256").update(currentContent).digest("hex")
    expect(currentHash).toBe(originalHash)
  })
})
