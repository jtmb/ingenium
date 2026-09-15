import { afterEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, projects, resetDbForTest, usage } from "ingenium-core";

const mockListSessions = vi.fn();
const mockGetMessages = vi.fn();
vi.mock("../lib/opencode-client.js", () => ({
  isOpenCodeError: (value: unknown) => typeof value === "object" && value !== null && "error" in value,
  opencodeClient: {
    listSessions: (...args: unknown[]) => mockListSessions(...args),
    getMessages: (...args: unknown[]) => mockGetMessages(...args),
  },
}));

import {
  getOpenCodeUsageSourceInstance,
  syncUsageFromOpenCode,
  usageEventFromOpenCodeStepFinish,
} from "../lib/usage-sync.js";

let directory = "";
const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;

function assistantEnvelope(sessionId: string) {
  return {
    info: {
      id: "msg-safe",
      sessionID: sessionId,
      role: "assistant",
      time: { created: Date.parse("2026-03-01T00:00:00.000Z"), completed: Date.parse("2026-03-01T00:00:01.000Z") },
      agent: "assistant-agent",
      model: { providerID: "Provider/Exact-ID", modelID: "Model/Exact-ID" },
      cost: 1.5,
      tokens: { total: 21, input: 13, output: 8, reasoning: 5, cache: { read: 4, write: 2 } },
      finish: "stop",
    },
    parts: [
      { id: "reasoning-secret", sessionID: sessionId, messageID: "msg-safe", type: "reasoning", text: "do not persist reasoning" },
      { id: "tool-secret", sessionID: sessionId, messageID: "msg-safe", type: "tool", text: "do not persist tool payload" },
      {
        id: "part-safe", sessionID: sessionId, messageID: "msg-safe", type: "step-finish",
        time: { start: Date.parse("2026-03-01T00:00:00.000Z"), end: Date.parse("2026-03-01T00:00:01.000Z") },
        tokens: { total: 21, input: 13, output: 8, reasoning: 5, cache: { read: 4, write: 2 } },
        cost: 1.5,
        reason: "stop",
      },
    ],
  };
}

afterEach(() => {
  vi.clearAllMocks();
  resetDbForTest();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = "";
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
});

describe("metadata-only OpenCode usage ingestion", () => {
  it("reads only assistant step-finish metadata and never reflects text, reasoning, or tool payloads", () => {
    const session = {
      id: "ses-safe",
      projectID: "oc-mapped-project",
      time: { created: Date.parse("2026-03-01T00:00:00.000Z"), updated: Date.parse("2026-03-01T00:00:02.000Z") },
      model: { id: "session-model", providerID: "session-provider" },
    } as any;
    const envelope = assistantEnvelope(session.id);
    const event = usageEventFromOpenCodeStepFinish(
      getOpenCodeUsageSourceInstance(),
      session,
      envelope as any,
      envelope.parts[2] as any,
      1,
      "project-id",
    );
    expect(event).toMatchObject({
      providerId: "Provider/Exact-ID",
      modelId: "Model/Exact-ID",
      agentId: "assistant-agent",
      totalTokens: 21,
      reasoningTokens: 5,
      cacheReadTokens: 4,
      costAmount: 1.5,
      costStatus: "known",
      status: "success",
    });
    expect(JSON.stringify(event)).not.toContain("do not persist");
    expect(JSON.stringify(event)).not.toContain("reasoning-secret");
    expect(JSON.stringify(event)).not.toContain("tool-secret");
  });

  it("uses only assistant step-finish metadata for raw identity, agent attribution, and multiple-finish values", () => {
    const session = {
      id: "ses-multi",
      projectID: "oc-mapped-project",
      time: { created: Date.parse("2026-03-01T00:00:00.000Z"), updated: Date.parse("2026-03-01T00:00:02.000Z") },
      agent: "session-agent-must-not-be-used",
      model: { id: "session-model", providerID: "session-provider" },
    } as any;
    const envelope = assistantEnvelope(session.id);
    envelope.info.agent = undefined;
    envelope.info.model = { providerID: "Provider/Raw-ID", modelID: "model:beta" };
    delete (envelope.parts[2] as Record<string, unknown>).tokens;
    delete (envelope.parts[2] as Record<string, unknown>).cost;
    envelope.parts.push({
      id: "part-second", sessionID: session.id, messageID: "msg-safe", type: "step-finish",
      time: { start: Date.parse("2026-03-01T00:00:01.000Z"), end: Date.parse("2026-03-01T00:00:02.000Z") },
      tokens: { total: 8, input: 3, output: 5, reasoning: 2, cache: { read: 0, write: 1 } },
      cost: 0.2,
      reason: "stop",
    });

    const first = usageEventFromOpenCodeStepFinish(
      getOpenCodeUsageSourceInstance(), session, envelope as any, envelope.parts[2] as any, 2, "project-id",
    );
    const second = usageEventFromOpenCodeStepFinish(
      getOpenCodeUsageSourceInstance(), session, envelope as any, envelope.parts[3] as any, 2, "project-id",
    );
    expect(first).toMatchObject({
      providerId: "Provider/Raw-ID",
      modelId: "model:beta",
      agentId: null,
      totalTokens: null,
      reasoningTokens: null,
      costAmount: null,
      costStatus: "partial",
    });
    expect(second).toMatchObject({
      providerId: "Provider/Raw-ID",
      modelId: "model:beta",
      agentId: null,
      totalTokens: 8,
      reasoningTokens: 2,
      cacheReadTokens: 0,
      cacheWriteTokens: 1,
      costAmount: 0.2,
      costStatus: "known",
    });
    expect(JSON.stringify([first, second])).not.toContain("do not persist reasoning");
  });

  it("upserts mapped sessions, advances a composite cursor, and quarantines an unmapped OpenCode project", async () => {
    directory = mkdtempSync(join(tmpdir(), "ingenium-usage-sync-"));
    process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
    resetDbForTest();
    const destination = projects.createProject("usage-sync-destination");
    const global = projects.createProject("global-default", true);
    const sourceInstance = getOpenCodeUsageSourceInstance();
    usage.mapOpenCodeProject(sourceInstance, "oc-mapped-project", destination.id);

    const mappedSession = {
      id: "ses-safe",
      projectID: "oc-mapped-project",
      time: { created: Date.parse("2026-03-01T00:00:00.000Z"), updated: Date.parse("2026-03-01T00:00:02.000Z") },
      agent: "session-agent-must-not-be-used",
      model: { id: "session-model", providerID: "session-provider" },
    };
    const unmappedSession = {
      id: "ses-unmapped",
      projectID: "oc-unmapped-project",
      time: { created: Date.parse("2026-03-01T00:00:00.000Z"), updated: Date.parse("2026-03-01T00:00:03.000Z") },
      model: { id: "session-model", providerID: "session-provider" },
    };
    mockListSessions.mockResolvedValue([mappedSession, unmappedSession]);
    mockGetMessages.mockResolvedValue([assistantEnvelope(mappedSession.id)]);

    const synced = await syncUsageFromOpenCode();
    expect(synced).toMatchObject({ sessionsScanned: 2, sessionsQuarantined: 1, unavailable: false });
    expect(synced.projects).toMatchObject([{ projectId: destination.id, sessionsProcessed: 1, eventsUpserted: 1 }]);
    expect(usage.getOpenCodeProjectMapping(sourceInstance, "oc-unmapped-project")).toMatchObject({
      status: "quarantined",
      ingeniumProjectId: null,
    });
    expect(usage.getOpenCodeProjectMapping(sourceInstance, "oc-unmapped-project")?.ingeniumProjectId).not.toBe(global.id);
    expect(usage.getUsageSyncState(sourceInstance, destination.id)).toMatchObject({
      cursorSessionId: mappedSession.id,
      cursorPartId: "part-safe",
      lastErrorCode: null,
    });
    const persisted = getDb().prepare("SELECT * FROM usage_events").get() as Record<string, unknown>;
    expect(persisted).toMatchObject({
      project_id: destination.id,
      source_part_id: "part-safe",
      agent_id: "assistant-agent",
      reasoning_tokens: 5,
    });
    expect(JSON.stringify(persisted)).not.toContain("do not persist");

    const replayed = await syncUsageFromOpenCode();
    expect(replayed.projects).toMatchObject([{ projectId: destination.id, eventsUpserted: 1 }]);
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM usage_events").get()).toEqual({ count: 1 });
  });
});
