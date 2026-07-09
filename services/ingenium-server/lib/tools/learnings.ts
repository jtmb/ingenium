/**
 * MCP tool handlers for the learnings log.
 * Supports logging new entries and searching existing ones via the API.
 */
import fs from "fs";
import path from "path";
import { api } from "../client.js";

/** Log a new learning entry. Supports optional tags, priority, and session association. */
export async function learningLog(project: string, entryType: string, content: string, tags?: string, priority?: number, sessionId?: string) {
  try {
    const res = await api.post("/learnings", { entry_type: entryType, content, tags, priority, session_id: sessionId }, { project });
    return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
  } catch (err: any) {
    // API unavailable — fallback: save locally for next-session import
    const learningsPath = path.resolve(process.cwd(), ".opencode", "skills", "learnings.md");
    const dir = path.dirname(learningsPath);
    if (!fs.existsSync(dir)) {
      fs.mkdirSync(dir, { recursive: true });
    }
    // Ensure the file has the header
    if (!fs.existsSync(learningsPath)) {
      fs.writeFileSync(learningsPath, "# Skill System Learnings\n\n> Logged discoveries from agents.\n\n", "utf-8");
    }
    const line = `${new Date().toISOString().split("T")[0]} | ${project} | ${entryType} | ${content.replace(/\n/g, " ").trim()} | manual | before:local after:local\n`;
    fs.appendFileSync(learningsPath, line, "utf-8");
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ note: "API unavailable — learning saved locally to .opencode/skills/learnings.md. Will sync on next session start." })
      }]
    };
  }
}

/** Full-text search across learning entries. */
export async function learningSearch(project: string, query: string) {
  const res = await api.get("/learnings/search", { project, q: query });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** List all learning entries for a project. */
export async function learningList(project: string) {
  const res = await api.get(`/learnings?project=${project}`);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Scan recent learnings for skill gaps and auto-create tasks for AI engineers to write missing skills. */
export async function skillFromLearnings(project: string) {
  const res = await api.post(`/learnings/skill-from-learnings?project=${project}`);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}
