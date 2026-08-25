/**
 * MCP tool handler for the LLM-based observation extraction engine.
 * 🔴 DB ISOLATION: MCP tool wrapper — proxies to API via HTTP, no direct DB access.
 * Triggers extraction runs that read OpenCode messages and detect observation candidates.
 */
import { api } from "../client.js";
import { textResult } from "./result.js";

/** Trigger the extraction engine */
export async function extractionRun(project: string) {
  const res = await api.post("/extraction/run", {}, { project });
  return textResult(res.data);
}
