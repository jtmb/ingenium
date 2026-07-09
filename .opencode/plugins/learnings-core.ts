export interface LearningsEntry {
  id: number
  date: string
  benchmark: string
  model: string
  description: string
  file: string
  shaRange: string
}

export type ActionType = "new-skill" | "add-pattern" | "update-rule" | "new-reference" | "noop"

export interface ActionResult {
  entry: string
  action: ActionType
  files: string[]
  notes: string
}

export interface ProcessResult {
  processed: number
  actions: ActionResult[]
  indexesUpdated: boolean
}

/** Get API base URL from env or default */
function apiBase(): string {
  return process.env.INGENIUM_API_URL ?? "http://localhost:4097/api/v1"
}

/** Default project name — the plugin always uses the current workspace project */
const DEFAULT_PROJECT = "gh-llm-bootstrap"

/** Fetch a JSON response from the Ingenium API */
async function apiFetch(path: string, options?: RequestInit): Promise<any> {
  const url = `${apiBase()}${path}`
  const res = await fetch(url, {
    headers: { "Content-Type": "application/json" },
    ...options,
  })
  if (!res.ok) {
    const text = await res.text()
    throw new Error(`API ${res.status} for ${url}: ${text}`)
  }
  return res.json()
}

/** Fetch unprocessed learnings from the Ingenium API */
async function fetchUnprocessedLearnings(project: string): Promise<LearningsEntry[]> {
  const result = await apiFetch(`/learnings?project=${project}&status=pending&limit=50`)
  const entries = result.data ?? []
  return entries
    .filter((e: any) => {
      // Parse the pipe-delimited content to extract structured fields
      const parts = (e.content || "").split(" | ")
      return parts.length >= 4 // At minimum: date | context | model | description
    })
    .map((e: any) => {
      const parts = e.content.split(" | ")
      return {
        id: e.id,
        date: parts[0]?.trim() || "",
        benchmark: parts[1]?.trim() || "",
        model: parts[2]?.trim() || "",
        description: parts[3]?.trim() || "",
        file: parts[4]?.trim() || "",
        shaRange: parts[5]?.trim() || "",
      } as LearningsEntry
    })
}

/** Mark a learning entry as processed via the API */
async function markProcessed(entry: LearningsEntry): Promise<void> {
  await apiFetch(`/learnings/${entry.id}?project=${DEFAULT_PROJECT}`, {
    method: "PATCH",
    body: JSON.stringify({ status: "processed" }),
  })
}

/**
 * Import unprocessed entries from learnings.md into the DB via API.
 * This handles the "API was down, agent saved locally" fallback.
 * Returns { imported: number, skipped: number }
 */
export async function importLearningsFromFile(worktree: string): Promise<{ imported: number; skipped: number }> {
  const pathModule = require("path")
  const fs = require("fs")

  const learningsPath = pathModule.join(worktree, ".opencode", "skills", "learnings.md")
  if (!fs.existsSync(learningsPath)) return { imported: 0, skipped: 0 }

  const content = fs.readFileSync(learningsPath, "utf-8")

  // Parse unprocessed entries (date-prefixed lines without [PROCESSED])
  const lines = content.split("\n")
  const unprocessed: string[] = []
  const lineIndices: number[] = []

  lines.forEach((line: string, i: number) => {
    if (/^\d{4}-\d{2}-\d{2}/.test(line) && !line.includes("[PROCESSED]")) {
      unprocessed.push(line)
      lineIndices.push(i)
    }
  })

  if (unprocessed.length === 0) return { imported: 0, skipped: 0 }

  let imported = 0
  let skipped = 0

  for (const entry of unprocessed) {
    try {
      const res = await apiFetch("/learnings?project=" + DEFAULT_PROJECT, {
        method: "POST",
        body: JSON.stringify({
          entry_type: "learning",
          content: entry,
          priority: 5,
          tags: "imported-from-file",
        }),
      })
      if (res?.data?.id) imported++
      else skipped++
    } catch {
      // API still down — skip for now
      skipped++
    }
  }

  // Mark imported entries as [PROCESSED] in the file
  if (imported > 0) {
    const updatedLines = lines.map((line: string, i: number) => {
      if (lineIndices.includes(i) && !line.includes("[PROCESSED]")) {
        return line + " [PROCESSED]"
      }
      return line
    })
    fs.writeFileSync(learningsPath, updatedLines.join("\n"), "utf-8")
  }

  return { imported, skipped }
}

/**
 * Try to find and read a skill file from the workspace.
 * Tries .opencode/skills/<file> first, then just <file>.
 */
function resolveSkillFile(worktree: string, file: string): string | null {
  const fs = require("fs")
  const path = require("path")
  
  const candidates = [
    path.join(worktree, ".opencode", "skills", file),
    path.join(worktree, ".opencode", "skills", "local-models", "references", path.basename(file)),
  ]
  
  // If file starts with a skill name, try that skill dir
  if (!file.startsWith("skills/") && !file.includes("/")) {
    candidates.unshift(path.join(worktree, ".opencode", "skills", file, "SKILL.md"))
  }
  
  for (const candidate of candidates) {
    const resolved = path.resolve(candidate)
    if (fs.existsSync(resolved)) return resolved
  }
  return null
}

/** Classify what action to take based on entry description + file */
export function classifyAction(description: string, file: string): ActionType {
  const d = description.toLowerCase()

  // Skills that were already created (content already exists)
  if (d.includes("created") && d.includes("skill")) return "noop"
  if (d.includes("subsumed") || d.includes("merged into")) return "noop"
  if (d.includes("split") && d.includes("into")) return "noop"
  if (d.includes("restructur")) return "noop"
  if (d.includes("moved") && d.includes("into")) return "noop"
  if (d.includes("already") && (d.includes("reflected") || d.includes("done"))) return "noop"

  // New skill discovery
  if (d.includes("new pattern") || d.includes("uncovered pattern")) return "new-skill"

  // Behavioral pattern addition
  if (d.includes("pattern:")) return "add-pattern"

  // Training paradigm / rule changes
  if (d.includes("training paradigm") || d.includes("added rule") || d.includes("loop detection")) return "update-rule"

  return "noop"
}

/** Read a skill file's content */
function readFile(path: string): string | null {
  try {
    const fs = require("fs")
    return fs.readFileSync(path, "utf-8")
  } catch {
    return null
  }
}

/** Write a skill file */
function writeFile(path: string, content: string): void {
  const fs = require("fs")
  fs.writeFileSync(path, content, "utf-8")
}

/** Append to a skill file */
function appendFile(path: string, content: string): void {
  const fs = require("fs")
  fs.appendFileSync(path, content, "utf-8")
}

/** Update the SKILL-INDEX.md directory count */
function updateSkillIndex(worktree: string): boolean {
  const fs = require("fs")
  const path = require("path")
  
  const indexPath = path.join(worktree, ".opencode", "SKILL-INDEX.md")
  if (!fs.existsSync(indexPath)) return false

  const skillsDir = path.join(worktree, ".opencode", "skills")
  let existingDirs: string[]
  try {
    existingDirs = fs.readdirSync(skillsDir).filter((d: string) => {
      try { return fs.statSync(path.join(skillsDir, d)).isDirectory() } catch { return false }
    })
  } catch { return false }

  const content = fs.readFileSync(indexPath, "utf-8")
  const lines = content.split("\n")

  // Update total count on line 3
  if (lines.length > 2) {
    lines[2] = lines[2].replace(/\*\*\d+ skills\*\*/, `**${existingDirs.length} skills**`)
  }

  fs.writeFileSync(indexPath, lines.join("\n"), "utf-8")
  return true
}

/** Execute a single entry's action */
function executeAction(worktree: string, entry: LearningsEntry, action: ActionType): ActionResult {
  const result: ActionResult = { entry: entry.description, action, files: [], notes: "" }

  switch (action) {
    case "add-pattern": {
      const targetPath = resolveSkillFile(worktree, entry.file)
      if (!targetPath) {
        result.notes = `Target file not found: ${entry.file}`
        break
      }
      const content = readFile(targetPath)
      if (!content) {
        result.notes = `Could not read: ${targetPath}`
        break
      }
      
      const bullet = `\n- **${entry.description.replace(/(^Qwen .+?)(?: —|\.)/, "$1 —").trim()}**`
      // Look for existing pattern list section
      const sectionMarkers = ["**🔴 Model-Aware Hints", "## 🔴 Model-Aware Hints", "Model-Aware Hints", "### Model-Aware Hints", "## 🔴 HARD RULEs"]
      let inserted = false
      for (const marker of sectionMarkers) {
        const idx = content.indexOf(marker)
        if (idx !== -1) {
          // Find the end of this section — next heading of any level (##, ###, ####)
          const nextSection = content.indexOf("\n##", idx + 10)
          const insertPoint = nextSection !== -1 ? nextSection : content.length
          const updated = content.slice(0, insertPoint) + bullet + content.slice(insertPoint)
          writeFile(targetPath, updated)
          result.files.push(targetPath)
          result.notes = `Pattern added to ${entry.file}`
          inserted = true
          break
        }
      }
      if (!inserted) {
        // Append to end of file
        appendFile(targetPath, `\n${bullet}\n`)
        result.files.push(targetPath)
        result.notes = `Pattern appended to ${entry.file} (no pattern section found)`
      }
      break
    }
    case "update-rule": {
      const targetPath = resolveSkillFile(worktree, entry.file)
      if (!targetPath) {
        result.notes = `Target file not found: ${entry.file}`
        break
      }
      const content = readFile(targetPath)
      if (!content) {
        result.notes = `Could not read: ${targetPath}`
        break
      }
      
      const rule = `\n### 🔴 ${entry.description.split("—")[0]?.trim() || entry.description}`
      // Place after existing HARD RULEs section
      const hardRuleIdx = content.indexOf("## 🔴 HARD RULEs")
      if (hardRuleIdx !== -1) {
        const nextSection = content.indexOf("\n##", hardRuleIdx + 20)
        const insertPoint = nextSection !== -1 ? nextSection : content.length
        const updated = content.slice(0, insertPoint) + rule + content.slice(insertPoint)
        writeFile(targetPath, updated)
        result.files.push(targetPath)
        result.notes = `Rule added to ${entry.file}`
      } else {
        appendFile(targetPath, `\n${rule}\n`)
        result.files.push(targetPath)
        result.notes = `Rule appended to ${entry.file}`
      }
      break
    }
    case "new-skill":
    case "new-reference":
      result.notes = `Skipped — content already exists in workspace: ${entry.file}`
      break
    case "noop":
      result.notes = `Already reflected — no change needed`
      break
  }
  return result
}

/** Main processing function — reads unprocessed learnings from API, processes them */
export async function processAll(worktree: string): Promise<ProcessResult> {
  const entries = await fetchUnprocessedLearnings(DEFAULT_PROJECT)
  if (entries.length === 0) return { processed: 0, actions: [], indexesUpdated: false }

  const actions: ActionResult[] = []
  let newSkillsCreated = false

  for (const entry of entries) {
    const action = classifyAction(entry.description, entry.file)
    const result = executeAction(worktree, entry, action)
    actions.push(result)

    if (result.files.length > 0) newSkillsCreated = true

    // Mark as processed in the DB
    try {
      await markProcessed(entry)
    } catch (err: any) {
      result.notes += ` (failed to mark processed: ${err.message})`
    }
  }

  let indexesUpdated = false
  if (newSkillsCreated) {
    indexesUpdated = updateSkillIndex(worktree)
  }

  return { processed: entries.length, actions, indexesUpdated }
}
