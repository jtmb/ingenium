import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, resetDbForTest } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";
import { coordinationWorktreeId, registerCoordinationSession } from "../lib/tools/coordination.js";
import { getUsageSummary, ingestExternalUsage, upsertUsageEvent } from "../lib/tools/usage.js";
import { explicitMcpAuthorizationPolicy } from "../lib/tools/mcp-authorization-policy.js";
import * as observations from "../lib/tools/observations.js";

const worktreeId = coordinationWorktreeId("workspace-usage", "a".repeat(64));
const input = { worktree: "/home/brajam/repos/ingenium", sessionId: "ses-usage", messageId: "msg-usage",
  role: "assistant", completedAt: "2026-09-10T10:00:00.000Z", providerId: "openai", modelId: "model",
  agentId: "engineer", inputTokens: 10, outputTokens: 0, reasoningTokens: 2, cacheReadTokens: 0 };
const range = { from: "2026-09-10T00:00:00.000Z", to: "2026-09-11T00:00:00.000Z" };
let directory: string;
let projectId: string;
beforeEach(() => {
  resetDbForTest();
  directory = mkdtempSync(join(tmpdir(), "ingenium-external-usage-"));
  vi.stubEnv("INGENIUM_CORE_DB_PATH", join(directory, "test.db"));
  projectId = createProject("ingenium-usage").id;
  registerCoordinationSession(projectId, { worktreeId, sessionId: input.sessionId, incarnation: 1,
    ownershipToken: "A".repeat(32), ttlMs: 60_000, idempotencyKey: "register-usage" });
});
afterEach(() => { resetDbForTest(); rmSync(directory, { recursive: true, force: true }); vi.restoreAllMocks(); vi.unstubAllEnvs(); });

describe("external usage ledger", () => {
  it("requires launcher-bound project usage write authorization", () => {
    expect(explicitMcpAuthorizationPolicy("ingenium_usage_ingest", "Usage")).toEqual({
      action: "usage.write", resource: "usage", permission: "write", target: "project",
      scopes: ["usage:write"], launcherBinding: "required",
    });
  });
  it("does not misclassify a storage failure as a foreign binding or retain a partial event", () => {
    vi.spyOn(observations, "requireExternalObservationSession").mockImplementation(() => { throw new Error("storage unavailable"); });
    expect(() => ingestExternalUsage(projectId, worktreeId, input)).toThrow("storage unavailable");
    expect(getUsageSummary(projectId, range).totals.requests).toBe(0);
  });
  it("persists one immutable contribution across replay and DB restart with unknown cost and zero output", () => {
    const first = ingestExternalUsage(projectId, worktreeId, input);
    expect(first.created).toBe(true);
    expect(ingestExternalUsage(projectId, worktreeId, input)).toEqual({ ...first, created: false });
    resetDbForTest();
    expect(ingestExternalUsage(projectId, worktreeId, input)).toEqual({ ...first, created: false });
    expect(getUsageSummary(projectId, range).totals).toMatchObject({ requests: 1,
      tokens: { total: { value: null, availability: "unavailable" }, output: { value: 0, availability: "known" } },
      cache: { read: { value: 0, availability: "known" }, write: { value: null, availability: "unavailable" } },
      cost: { value: null, availability: "unavailable" } });
    expect(() => ingestExternalUsage(projectId, worktreeId, { ...input, inputTokens: 99 })).toThrow("SOURCE_CONFLICT");
    expect(getUsageSummary(projectId, range).totals.tokens.input.value).toBe(10);
    expect(JSON.stringify(getDb().prepare("SELECT * FROM usage_events").all())).not.toContain(input.worktree);
  });

  it("rejects foreign bindings, non-assistant/unfinished payloads, extras, unsafe identifiers and invalid numbers", () => {
    expect(() => ingestExternalUsage(createProject("foreign").id, worktreeId, input)).toThrow("BINDING_REJECTED");
    expect(() => ingestExternalUsage(projectId, coordinationWorktreeId("foreign", "a".repeat(64)), input)).toThrow("BINDING_REJECTED");
    expect(() => ingestExternalUsage(projectId, worktreeId, { ...input, sessionId: "foreign" })).toThrow("BINDING_REJECTED");
    for (const override of [{ role: "user" }, { role: "tool" }, { completedAt: undefined }, { text: "secret-canary" },
      { reasoning: "secret-canary" }, { modelId: "sk-secret-canary" }, { inputTokens: -1 }, { outputTokens: 0.1 }, { costAmount: Infinity }]) {
      expect(() => ingestExternalUsage(projectId, worktreeId, { ...input, ...override })).toThrow("INVALID_USAGE_INPUT");
    }
    expect(getUsageSummary(projectId, range).totals.requests).toBe(0);
  });

  it("preserves API-local mutable step sync independently of immutable external message usage", () => {
    const external = ingestExternalUsage(projectId, worktreeId, { ...input, costAmount: 0 });
    const local = { ...external.event, sourceInstance: "http://opencode.test", sourcePartId: "part-local", costAmount: 1 };
    upsertUsageEvent(local);
    upsertUsageEvent({ ...local, costAmount: 2 });
    expect(ingestExternalUsage(projectId, worktreeId, { ...input, costAmount: 0 }).created).toBe(false);
    expect(getUsageSummary(projectId, range).totals).toMatchObject({ requests: 2, cost: { value: 2, availability: "known" } });
  });
});
