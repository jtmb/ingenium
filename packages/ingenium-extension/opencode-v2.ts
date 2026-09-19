import type { PluginInput } from "@opencode-ai/plugin";
import { createOpencodeClient as createV2Client } from "@opencode-ai/sdk/v2";
import type { SessionMessage, SessionV2Info } from "@opencode-ai/sdk/v2";

/**
 * OpenCode 1.18.31 exposes lifecycle and native-tool hooks only through the
 * root plugin contract. Its v2 SDK is the supported client surface for
 * session reads; keeping this boundary explicit avoids claiming strict-v2
 * plugin support that upstream does not provide yet.
 */
type OpenCodeSdkClient = ReturnType<typeof createV2Client>;
export type OpenCodeV2Client = OpenCodeSdkClient["v2"];

type ClientWithV2 = PluginInput["client"] & { v2?: OpenCodeV2Client };

export function v2Client(input: Pick<PluginInput, "client" | "worktree"> & { serverUrl?: URL }): OpenCodeV2Client {
  const client = (input.client as ClientWithV2).v2;
  if (client) return client;
  if (!input.serverUrl) throw new Error("OPENCODE_V2_CLIENT_UNAVAILABLE");
  return createV2Client({ baseUrl: input.serverUrl.toString().replace(/\/$/, ""), directory: input.worktree }).v2;
}

export interface LegacySessionMessage {
  info: Record<string, unknown>;
  parts: Array<Record<string, unknown>>;
}

function record(value: unknown): Record<string, unknown> | undefined {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? value as Record<string, unknown>
    : undefined;
}

function validSessionId(value: unknown): value is string {
  return typeof value === "string" && /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/.test(value);
}

function isSessionInfo(value: unknown): value is SessionV2Info {
  const info = record(value);
  const location = record(info?.location);
  return typeof info?.id === "string" && typeof location?.directory === "string";
}

function visibleFlags(message: SessionMessage): Record<string, boolean> {
  const metadata = record(message.metadata);
  return Object.fromEntries(["hidden", "synthetic", "ignored"]
    .filter((key) => typeof metadata?.[key] === "boolean")
    .map((key) => [key, metadata![key] as boolean]));
}

export function eventSessionId(event: unknown): string | undefined {
  const value = record(event);
  const properties = record(value?.properties);
  const direct = properties?.sessionID;
  if (validSessionId(direct)) return direct;
  const info = record(properties?.info);
  return validSessionId(info?.id) ? info.id : undefined;
}

export async function getV2SessionInfo(client: OpenCodeV2Client, sessionID: string): Promise<SessionV2Info> {
  const response = await client.session.get({ sessionID });
  const session = record(record(response?.data)?.data);
  if (!isSessionInfo(session) || session.id !== sessionID) {
    throw new Error("OPENCODE_V2_SESSION_UNAVAILABLE");
  }
  return session;
}

export async function resolveSessionDirectory(
  input: Pick<PluginInput, "client" | "worktree"> & { serverUrl?: URL },
  sessionID: string | undefined,
  fallback: string,
): Promise<string> {
  if (!sessionID) return fallback;
  try {
    return (await getV2SessionInfo(v2Client(input), sessionID)).location.directory;
  } catch {
    return fallback;
  }
}

export async function readV2Messages(
  client: OpenCodeV2Client,
  sessionID: string,
  options: { maxPages?: number; order?: "asc" | "desc" } = {},
): Promise<SessionMessage[]> {
  const messages: SessionMessage[] = [];
  const cursors = new Set<string>();
  let cursor: string | undefined;
  let pageNumber = 0;

  for (;;) {
    const response = await client.session.messages(cursor === undefined
      ? { sessionID, limit: 100, order: options.order ?? "asc" }
      : { sessionID, limit: 100, cursor });
    const payload = record(response?.data);
    const page = payload?.data;
    if (!Array.isArray(page) || page.length > 100) throw new Error("OPENCODE_V2_MESSAGES_UNAVAILABLE");
    messages.push(...page as SessionMessage[]);
    pageNumber += 1;
    if (options.maxPages !== undefined && pageNumber >= options.maxPages) return messages;

    const next = record(payload?.cursor)?.next;
    if (next === undefined || next === null) return messages;
    if (typeof next !== "string" || next.length === 0) throw new Error("OPENCODE_V2_CURSOR_FAILED");
    if (cursors.has(next)) throw new Error("OPENCODE_V2_CURSOR_FAILED");
    if (page.length === 0) return messages;
    cursors.add(next);
    cursor = next;
  }
}

export function legacySessionInfo(info: SessionV2Info, sessionID: string, worktree: string): Record<string, unknown> {
  if (info.id !== sessionID || info.location.directory !== worktree) throw new Error("CONTEXT_SESSION_MISMATCH");
  return { id: sessionID, directory: worktree };
}

export function legacySessionMessage(message: SessionMessage, sessionID: string): LegacySessionMessage {
  const base = { id: message.id, sessionID };
  if (message.type === "user") {
    return { info: { ...base, ...visibleFlags(message), role: "user", time: message.time }, parts: [{ type: "text", text: message.text }] };
  }
  if (message.type === "assistant") {
    return {
      info: {
        ...base,
        ...visibleFlags(message),
        role: "assistant",
        time: message.time,
        agent: message.agent,
        providerID: message.model.providerID,
        modelID: message.model.id,
        ...(message.tokens === undefined ? {} : { tokens: message.tokens }),
        ...(message.cost === undefined ? {} : { cost: message.cost }),
        ...(message.error === undefined ? {} : { error: message.error }),
      },
      parts: message.content
        .filter((part) => part.type === "text")
        .map((part) => ({ type: "text", text: part.text })),
    };
  }
  return { info: { ...base, role: "system" }, parts: [] };
}
