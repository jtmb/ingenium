import { afterEach, describe, expect, it, vi } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getDb, resetDbForTest } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";
import {
  acknowledgeUsageAttentionItem,
  getUsageAttentionItem,
  listUsageAttentionItems,
  mapOpenCodeProject,
  reconcileUsageAttention,
  replaceUsageAdvisoryThresholds,
  saveUsageSyncState,
  upsertUsageEvent,
} from "../lib/tools/usage.js";

let directory = "";
const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;

function setup() {
  directory = mkdtempSync(join(tmpdir(), "ingenium-usage-attention-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  resetDbForTest();
  return { db: getDb(process.env.INGENIUM_CORE_DB_PATH), project: createProject("usage-attention") };
}

function replace(projectId: string, expectedRevision = 1, values: Partial<{
  requestCount: number | null;
  totalTokens: number | null;
  reportedCostAmount: number | null;
  cacheReadTokens: number | null;
  cacheWriteTokens: number | null;
}> = {}) {
  return replaceUsageAdvisoryThresholds(projectId, {
    expectedRevision,
    requestCount: null,
    totalTokens: null,
    reportedCostAmount: null,
    cacheReadTokens: null,
    cacheWriteTokens: null,
    ...values,
  });
}

function event(projectId: string, partId: string, overrides: Record<string, unknown> = {}) {
  return upsertUsageEvent({
    projectId,
    sourceInstance: "https://opencode.test",
    sourcePartId: partId,
    sourceSessionId: "session",
    sourceMessageId: `message-${partId}`,
    sourceProjectId: "source-project",
    providerId: "provider",
    modelId: "model",
    agentId: "agent",
    status: "success",
    occurredAt: "2026-07-01T00:00:00.000Z",
    totalTokens: 10,
    inputTokens: 5,
    outputTokens: 5,
    reasoningTokens: 0,
    cacheReadTokens: 2,
    cacheWriteTokens: 1,
    costAmount: 0.1,
    costStatus: "known",
    ...overrides,
  });
}

function eventTransitions(db: Database.Database) {
  return db.prepare("SELECT transition FROM usage_attention_events ORDER BY rowid ASC").all() as Array<{ transition: string }>;
}

function migrationFilesThrough(version: number): string[] {
  const migrations = resolve(import.meta.dirname ?? __dirname, "../data/migrations");
  return readdirSync(migrations)
    .filter((file) => /^\d{3}_.*\.sql$/.test(file) && Number(file.slice(0, 3)) <= version)
    .sort();
}

afterEach(() => {
  vi.useRealTimers();
  resetDbForTest();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = "";
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
});

describe("USAGE-101 attention migration", () => {
  it("installs on fresh and upgrade databases, rejects partial upgrades, and guards direct SQL", () => {
    const { db, project } = setup();
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'usage_attention_items'").get()).toBeTruthy();
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'usage_attention_events'").get()).toBeTruthy();

    replace(project.id, 1, { requestCount: 0 });
    const reconciled = reconcileUsageAttention(project.id, { syncIntervalMs: 1_000 });
    const item = reconciled.items.find((candidate) => candidate.metric === "request_count")!;
    const clone = db.prepare(
      `INSERT INTO usage_attention_items (
        id, project_id, condition, metric, status, evaluation_state, severity, message_code,
        observed, threshold, availability, freshness, range_from, range_to, threshold_revision,
        opened_at, acknowledged_at, resolved_at, reopened_at, reopen_count, last_evaluated_at,
        revision, created_at, updated_at
      ) SELECT ?, ?, ?, metric, status, evaluation_state, severity, message_code,
        observed, threshold, availability, freshness, range_from, range_to, threshold_revision,
        opened_at, acknowledged_at, resolved_at, reopened_at, reopen_count, last_evaluated_at,
        revision, created_at, updated_at
      FROM usage_attention_items WHERE id = ?`,
    );
    expect(() => clone.run("00000000-0000-4000-8000-000000000001", "missing-project", item.condition, item.id)).toThrow(/FOREIGN KEY/);
    expect(() => clone.run("00000000-0000-4000-8000-000000000002", project.id, "usage.advisory:v1:all-history:not-a-metric", item.id)).toThrow(/CHECK/);
    expect(() => db.prepare("UPDATE usage_attention_items SET id = ?, revision = revision + 1 WHERE id = ?").run("00000000-0000-4000-8000-000000000003", item.id)).toThrow(/immutable/);
    const eventId = db.prepare("SELECT id FROM usage_attention_events WHERE item_id = ?").get(item.id) as { id: string };
    expect(() => db.prepare("UPDATE usage_attention_events SET created_at = ? WHERE id = ?").run("2026-07-02T00:00:00.000Z", eventId.id)).toThrow(/immutable/);
    expect(() => db.prepare("DELETE FROM usage_attention_events WHERE id = ?").run(eventId.id)).toThrow(/immutable/);

    resetDbForTest();
    rmSync(directory, { recursive: true, force: true });
    directory = mkdtempSync(join(tmpdir(), "ingenium-usage-attention-upgrade-"));
    const path = join(directory, "data.db");
    const legacy = new Database(path);
    const migrations = resolve(import.meta.dirname ?? __dirname, "../data/migrations");
    for (const file of migrationFilesThrough(78)) legacy.exec(readFileSync(join(migrations, file), "utf8"));
    legacy.close();
    process.env.INGENIUM_CORE_DB_PATH = path;
    expect(() => getDb(path)).not.toThrow();

    resetDbForTest();
    const partial = new Database(path);
    partial.exec("DROP TABLE usage_attention_events; DROP TABLE usage_attention_items; CREATE TABLE usage_attention_items (id TEXT);");
    partial.close();
    expect(() => getDb(path)).toThrow(/Migration 079 is in a PARTIAL state/);
  });
});

describe("USAGE-101 attention lifecycle", () => {
  it("covers disabled, below, equal known-zero, above, and unknown without duplicate transitions", () => {
    const { db, project } = setup();
    expect(reconcileUsageAttention(project.id, { syncIntervalMs: 1_000 }).items).toEqual([]);

    let thresholds = replace(project.id, 1, { requestCount: 1, totalTokens: 10 });
    expect(reconcileUsageAttention(project.id, { syncIntervalMs: 1_000 }).items).toHaveLength(1);
    let items = listUsageAttentionItems(project.id, { includeResolved: true }).data;
    expect(items).toHaveLength(1);
    expect(items[0]).toMatchObject({ metric: "total_tokens", status: "active", evaluationState: "unknown", severity: "info" });

    thresholds = replace(project.id, thresholds.revision, { requestCount: 0, totalTokens: 10 });
    const knownZero = reconcileUsageAttention(project.id, { syncIntervalMs: 1_000 });
    expect(knownZero.items.find((item) => item.metric === "request_count")).toMatchObject({
      status: "active", evaluationState: "equal", severity: "warning", observed: 0,
    });
    event(project.id, "above");
    const above = reconcileUsageAttention(project.id, { syncIntervalMs: 1_000 });
    expect(above.items.find((item) => item.metric === "request_count")).toMatchObject({
      status: "active", evaluationState: "above", severity: "critical",
    });
    const eventCount = eventTransitions(db).length;
    reconcileUsageAttention(project.id, { syncIntervalMs: 1_000 });
    expect(eventTransitions(db)).toHaveLength(eventCount);
    expect(eventTransitions(db).map((row) => row.transition)).toEqual(expect.arrayContaining(["opened", "changed"]));
  });

  it("acknowledges with CAS, preserves unchanged/resolve acknowledgement, and clears it on material change and reopen", () => {
    const { db, project } = setup();
    let thresholds = replace(project.id, 1, { requestCount: 0 });
    const opened = reconcileUsageAttention(project.id, { syncIntervalMs: 1_000 }).items[0]!;
    const acknowledged = acknowledgeUsageAttentionItem(project.id, opened.id, opened.revision);
    expect(acknowledged.acknowledgedAt).not.toBeNull();
    expect(acknowledgeUsageAttentionItem(project.id, opened.id, opened.revision)).toEqual(acknowledged);
    expect(acknowledgeUsageAttentionItem(project.id, opened.id, acknowledged.revision)).toEqual(acknowledged);

    const unchanged = reconcileUsageAttention(project.id, { syncIntervalMs: 1_000 }).items[0]!;
    expect(unchanged.acknowledgedAt).toBe(acknowledged.acknowledgedAt);
    thresholds = replace(project.id, thresholds.revision, { requestCount: 1 });
    const resolved = reconcileUsageAttention(project.id, { syncIntervalMs: 1_000 }).items[0]!;
    expect(resolved).toMatchObject({ status: "resolved", evaluationState: "below", acknowledgedAt: acknowledged.acknowledgedAt });
    thresholds = replace(project.id, thresholds.revision, { requestCount: 0 });
    const reopened = reconcileUsageAttention(project.id, { syncIntervalMs: 1_000 }).items[0]!;
    expect(reopened).toMatchObject({ status: "active", evaluationState: "equal", acknowledgedAt: null, reopenCount: 1 });
    expect(eventTransitions(db).map((row) => row.transition)).toEqual(["opened", "ack", "resolved", "reopened"]);
    expect(() => acknowledgeUsageAttentionItem(project.id, reopened.id, 1)).toThrow(expect.objectContaining({
      code: "USAGE_ATTENTION_REVISION_CONFLICT",
    }));
  });

  it("uses source-backed freshness conservatively and never mutates source telemetry, thresholds, mappings, or sync state", () => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-07-01T00:00:00.000Z"));
    const { db, project } = setup();
    replace(project.id, 1, { requestCount: 0 });
    const unknown = reconcileUsageAttention(project.id, { syncIntervalMs: 1_000 }).items[0]!;
    expect(unknown.freshness).toBe("unknown");

    mapOpenCodeProject("https://one.test", "source-one", project.id);
    saveUsageSyncState({
      sourceInstance: "https://one.test", projectId: project.id,
      cursorUpdatedAt: null, cursorSessionId: null, cursorPartId: null,
      lastSyncStartedAt: "2026-07-01T00:00:00.000Z", lastSyncCompletedAt: "2026-07-01T00:00:00.000Z",
      lastSuccessfulSyncAt: "2026-07-01T00:00:00.000Z", lastErrorCode: null,
    });
    const sourceRowsBefore = {
      events: db.prepare("SELECT * FROM usage_events").all(),
      thresholds: db.prepare("SELECT * FROM usage_advisory_thresholds").all(),
      mappings: db.prepare("SELECT * FROM usage_project_mappings").all(),
      sync: db.prepare("SELECT * FROM usage_sync_state").all(),
    };
    expect(reconcileUsageAttention(project.id, { syncIntervalMs: 1_000 }).items[0]!.freshness).toBe("fresh");
    expect({
      events: db.prepare("SELECT * FROM usage_events").all(),
      thresholds: db.prepare("SELECT * FROM usage_advisory_thresholds").all(),
      mappings: db.prepare("SELECT * FROM usage_project_mappings").all(),
      sync: db.prepare("SELECT * FROM usage_sync_state").all(),
    }).toEqual(sourceRowsBefore);

    mapOpenCodeProject("https://two.test", "source-two", project.id);
    expect(reconcileUsageAttention(project.id, { syncIntervalMs: 1_000 }).items[0]!.freshness).toBe("unknown");
    saveUsageSyncState({
      sourceInstance: "https://two.test", projectId: project.id,
      cursorUpdatedAt: null, cursorSessionId: null, cursorPartId: null,
      lastSyncStartedAt: "2026-07-01T00:00:00.000Z", lastSyncCompletedAt: "2026-07-01T00:00:00.000Z",
      lastSuccessfulSyncAt: "2026-07-01T00:00:00.000Z", lastErrorCode: null,
    });
    vi.setSystemTime(new Date("2026-07-01T00:00:02.001Z"));
    expect(reconcileUsageAttention(project.id, { syncIntervalMs: 1_000 }).items[0]!.freshness).toBe("stale");
    expect(reconcileUsageAttention(project.id, { syncIntervalMs: 0 }).items[0]!.freshness).toBe("disabled");
  });

  it("deduplicates sequential concurrent calls and remains restart-safe", () => {
    const { db, project } = setup();
    replace(project.id, 1, { requestCount: 0 });
    const [first, second] = [
      reconcileUsageAttention(project.id, { syncIntervalMs: 1_000 }),
      reconcileUsageAttention(project.id, { syncIntervalMs: 1_000 }),
    ];
    expect(first.transitions).toHaveLength(1);
    expect(second.transitions).toHaveLength(0);
    resetDbForTest();
    const restarted = getDb(process.env.INGENIUM_CORE_DB_PATH);
    expect(reconcileUsageAttention(project.id, { syncIntervalMs: 1_000 }).transitions).toEqual([]);
    expect(restarted.prepare("SELECT COUNT(*) AS count FROM usage_attention_events").get()).toEqual({ count: 1 });
    expect(getUsageAttentionItem(project.id, first.items[0]!.id)).not.toBeNull();
  });
});
