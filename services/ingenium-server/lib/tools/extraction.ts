/**
 * MCP tool handler for the LLM-based observation extraction engine.
 * 🔴 DB ISOLATION: MCP tool wrapper — proxies to API via HTTP, no direct DB access.
 * Triggers extraction runs that read OpenCode messages and detect observation candidates.
 */
import { api } from "../client.js";
import { textResult } from "./result.js";
import { z } from "zod";
import { redactContextText } from "@ingenium/extension/context-upload-codec";

const externalId = z.string().regex(/^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/)
  .refine((value) => redactContextText(value) === value);
export const externalExtractionSchema = z.object({
  worktree: z.string().min(1).max(1024),
  sessionId: externalId,
  message: z.object({ id: externalId, role: z.literal("user"), text: z.string().min(1).max(6000) }).strict().optional(),
}).strict();

/** Trigger the extraction engine */
export async function extractionRun(project: string, external?: z.infer<typeof externalExtractionSchema>, launcherProject?: string | null) {
  if (external !== undefined && (!launcherProject || launcherProject !== project)) throw new Error("EXTERNAL_OBSERVATION_BINDING_REJECTED");
  const input = external === undefined ? undefined : externalExtractionSchema.parse(external);
  if (input?.message) input.message.text = redactContextText(input.message.text);
  const res = await api.post("/extraction/run", input ? { external: input } : {}, { project });
  return textResult(res.data);
}
