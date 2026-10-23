import { z } from "zod";
import { redactContextText } from "@ingenium/extension/context-upload-codec";
import { api } from "../client.js";
import { textResult } from "./result.js";

const identifier = z.string().min(1).max(128).regex(/^[A-Za-z0-9][A-Za-z0-9._:/-]*$/)
  .refine((value) => redactContextText(value) === value);
const tokens = z.number().int().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional();
export const externalUsageSchema = z.object({
  worktree: z.string().min(1).max(1024),
  sessionId: identifier,
  messageId: identifier,
  role: z.literal("assistant"),
  completedAt: z.string().datetime(),
  providerId: identifier.nullable().optional(),
  modelId: identifier.nullable().optional(),
  agentId: identifier.nullable().optional(),
  totalTokens: tokens,
  inputTokens: tokens,
  outputTokens: tokens,
  reasoningTokens: tokens,
  cacheReadTokens: tokens,
  cacheWriteTokens: tokens,
  costAmount: z.number().finite().nonnegative().max(Number.MAX_SAFE_INTEGER).nullable().optional(),
}).strict();

export async function usageIngest(project: string, event: z.infer<typeof externalUsageSchema>, launcherProject?: string | null) {
  if (!launcherProject || project !== launcherProject) throw new Error("EXTERNAL_USAGE_BINDING_REJECTED");
  const response = await api.post("/usage/external", externalUsageSchema.parse(event), { project });
  return textResult(response.data);
}
