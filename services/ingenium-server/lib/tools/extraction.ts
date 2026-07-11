/**
 * MCP tool handler for the LLM-based observation extraction engine.
 * Triggers extraction runs via the Ingenium API.
 */
import { api } from "../client.js";

/** Trigger the extraction engine */
export async function extractionRun(project: string) {
  const res = await api.post("/extraction/run", {}, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}
