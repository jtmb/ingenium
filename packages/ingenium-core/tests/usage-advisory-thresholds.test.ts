import { afterEach, describe, expect, it } from "vitest";
import Database from "better-sqlite3";
import { mkdtempSync, readdirSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { getDb, resetDbForTest } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";
import {
  USAGE_ADVISORY_THRESHOLD_MAX,
  UsageError,
  evaluateUsageAdvisoryThresholds,
  getUsageAdvisoryThresholds,
  getUsageSummary,
  replaceUsageAdvisoryThresholds,
  upsertUsageEvent,
} from "../lib/tools/usage.js";

let directory = "";
const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;

function setup() {
  directory = mkdtempSync(join(tmpdir(), "ingenium-usage-advisory-"));
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  resetDbForTest();
  return {
    db: getDb(process.env.INGENIUM_CORE_DB_PATH),
    first: createProject("usage-advisory-first"),
    second: createProject("usage-advisory-second"),
  };
}

function event(projectId: string, partId: string, occurredAt: string, overrides: Record<string, unknown> = {}) {
  return upsertUsageEvent({
    projectId,
    sourceInstance: "http://opencode.test:4098",
    sourcePartId: partId,
    sourceSessionId: "ses-usage-advisory",
    sourceMessageId: `msg-${partId}`,
    sourceProjectId: "oc-usage-advisory",
    providerId: "provider-raw",
    modelId: "model-raw",
    agentId: "agent-raw",
    status: "success" as const,
    occurredAt,
    totalTokens: 10,
    inputTokens: 6,
    outputTokens: 4,
    reasoningTokens: 0,
    cacheReadTokens: 2,
    cacheWriteTokens: 3,
    costAmount: 0.4,
    costStatus: "known" as const,
    ...overrides,
  });
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

function migrationFilesThrough(version: number): string[] {
  const migrations = resolve(import.meta.dirname ?? __dirname, "../data/migrations");
  return readdirSync(migrations)
    .filter((file) => /^\d{3}_.*\.sql$/.test(file) && Number(file.slice(0, 3)) <= version)
    .sort();
}

afterEach(() => {
  resetDbForTest();
  if (directory) rmSync(directory, { recursive: true, force: true });
  directory = "";
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
});

describe("usage advisory thresholds", () => {
  it("creates migration 078 on fresh and upgrade databases with non-null project ownership without changing the usage ledger", () => {
    const { db } = setup();
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'usage_advisory_thresholds'").get()).toBeTruthy();
    expect(db.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'usage_events'").get()).toBeTruthy();
    const freshNullProject = db.prepare(
      `INSERT INTO usage_advisory_thresholds (
        project_id, revision, created_at, updated_at
      ) VALUES (NULL, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    );
    expect(() => freshNullProject.run()).toThrow(/NOT NULL/);

    resetDbForTest();
    rmSync(directory, { recursive: true, force: true });
    directory = mkdtempSync(join(tmpdir(), "ingenium-usage-advisory-upgrade-"));
    const databasePath = join(directory, "data.db");
    const legacy = new Database(databasePath);
    const migrationDirectory = resolve(import.meta.dirname ?? __dirname, "../data/migrations");
    for (const file of migrationFilesThrough(77)) {
      legacy.exec(readFileSync(join(migrationDirectory, file), "utf8"));
    }
    legacy.close();

    process.env.INGENIUM_CORE_DB_PATH = databasePath;
    const upgraded = getDb(databasePath);
    expect(upgraded.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'usage_advisory_thresholds'").get()).toBeTruthy();
    expect(upgraded.prepare("SELECT 1 FROM sqlite_master WHERE type = 'table' AND name = 'usage_events'").get()).toBeTruthy();
    const upgradedNullProject = upgraded.prepare(
      `INSERT INTO usage_advisory_thresholds (
        project_id, revision, created_at, updated_at
      ) VALUES (NULL, 1, '2026-01-01T00:00:00.000Z', '2026-01-01T00:00:00.000Z')`,
    );
    expect(() => upgradedNullProject.run()).toThrow(/NOT NULL/);
    expect(upgraded.prepare("PRAGMA foreign_key_check").all()).toEqual([]);
  });

  it("enforces direct-SQL bounds, numeric types, revision, timestamps, uniqueness, and restrictive project ownership", () => {
    const { db, first } = setup();
    const insert = db.prepare(
      `INSERT INTO usage_advisory_thresholds (
        project_id, request_count, total_tokens, reported_cost_amount,
        cache_read_tokens, cache_write_tokens, revision, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    );
    const valid = () => insert.run(first.id, 0, 0, 0, 0, 0, 1, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z");
    expect(valid).not.toThrow();
    expect(() => insert.run(null, 0, 0, 0, 0, 0, 1, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")).toThrow(/NOT NULL/);
    expect(() => insert.run(first.id, 0, 0, 0, 0, 0, 1, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")).toThrow(/UNIQUE/);
    expect(() => insert.run("missing-project", 0, 0, 0, 0, 0, 1, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")).toThrow(/FOREIGN KEY/);
    expect(() => insert.run("negative", -1, 0, 0, 0, 0, 1, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")).toThrow(/CHECK/);
    expect(() => insert.run("fractional", 1.5, 0, 0, 0, 0, 1, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")).toThrow(/CHECK/);
    expect(() => insert.run("text-cost", 0, 0, "not-a-number", 0, 0, 1, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")).toThrow(/CHECK/);
    expect(() => insert.run("infinite", 0, 0, Infinity, 0, 0, 1, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")).toThrow(/CHECK/);
    expect(() => insert.run("unsafe", USAGE_ADVISORY_THRESHOLD_MAX + 1, 0, 0, 0, 0, 1, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")).toThrow(/CHECK/);
    expect(() => insert.run("bad-revision", 0, 0, 0, 0, 0, 0, "2026-01-01T00:00:00.000Z", "2026-01-01T00:00:00.000Z")).toThrow(/CHECK/);
    expect(() => insert.run("bad-utc", 0, 0, 0, 0, 0, 1, "2026-01-01", "2026-01-01")).toThrow(/CHECK/);

    const columns = db.prepare("PRAGMA table_info('usage_advisory_thresholds')").all() as Array<{ name: string }>;
    expect(columns.map((column) => column.name)).not.toEqual(expect.arrayContaining([
      "provider_id", "currency", "price", "window", "secret",
    ]));
  });

  it("returns all-null read-only defaults, accepts zero and safe maxima, and protects each project with revision CAS", () => {
    const { db, first, second } = setup();
    const countBeforeRead = db.prepare("SELECT COUNT(*) AS count FROM usage_advisory_thresholds").get();
    expect(getUsageAdvisoryThresholds(first.id)).toMatchObject({
      requestCount: null,
      totalTokens: null,
      reportedCostAmount: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      revision: 1,
    });
    expect(db.prepare("SELECT COUNT(*) AS count FROM usage_advisory_thresholds").get()).toEqual(countBeforeRead);
    const zero = replace(first.id, 1, {
      requestCount: 0,
      totalTokens: 0,
      reportedCostAmount: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    expect(zero).toMatchObject({ requestCount: 0, reportedCostAmount: 0, revision: 2 });
    expect(() => replace(first.id, 2, { reportedCostAmount: Number.NaN })).toThrow(expect.objectContaining({
      code: "INVALID_USAGE_THRESHOLD_INPUT",
    }));
    const maximum = replace(first.id, 2, {
      requestCount: USAGE_ADVISORY_THRESHOLD_MAX,
      totalTokens: USAGE_ADVISORY_THRESHOLD_MAX,
      reportedCostAmount: USAGE_ADVISORY_THRESHOLD_MAX,
      cacheReadTokens: USAGE_ADVISORY_THRESHOLD_MAX,
      cacheWriteTokens: USAGE_ADVISORY_THRESHOLD_MAX,
    });
    expect(maximum).toMatchObject({ totalTokens: USAGE_ADVISORY_THRESHOLD_MAX, revision: 3 });
    expect(() => replace(first.id, 2)).toThrow(expect.objectContaining({
      code: "USAGE_THRESHOLD_REVISION_CONFLICT",
      currentRevision: 3,
    }));
    expect(replace(second.id, 1, { requestCount: 7 })).toMatchObject({ requestCount: 7, revision: 2 });
    expect(getUsageAdvisoryThresholds(first.id).requestCount).toBe(USAGE_ADVISORY_THRESHOLD_MAX);
  });

  it("reports exact below, equal, and above states against known provider-reported aggregates", () => {
    const { first } = setup();
    replace(first.id, 1, {
      requestCount: 2,
      totalTokens: 10,
      reportedCostAmount: 0.3,
      cacheReadTokens: 3,
      cacheWriteTokens: 2,
    });
    event(first.id, "known", "2026-02-01T12:00:00.000Z");
    const evaluation = evaluateUsageAdvisoryThresholds(first.id, {
      from: "2026-02-01T00:00:00Z",
      to: "2026-02-02T00:00:00Z",
    });
    expect(evaluation.range).toEqual({ from: "2026-02-01T00:00:00.000Z", to: "2026-02-02T00:00:00.000Z" });
    expect(evaluation.metrics).toEqual({
      requestCount: { observed: 1, threshold: 2, availability: "known", state: "below" },
      totalTokens: { observed: 10, threshold: 10, availability: "known", state: "equal" },
      reportedCostAmount: { observed: 0.4, threshold: 0.3, availability: "known", state: "above" },
      cacheReadTokens: { observed: 2, threshold: 3, availability: "known", state: "below" },
      cacheWriteTokens: { observed: 3, threshold: 2, availability: "known", state: "above" },
    });
    expect(getUsageSummary(first.id, {
      from: "2026-02-01T00:00:00.000Z",
      to: "2026-02-02T00:00:00.000Z",
    }).totals.requests).toBe(1);
  });

  it("keeps zero known, partial subtotal, unavailable, disabled, and no-cost-inference states distinct", () => {
    const { first, second } = setup();
    replace(first.id, 1, {
      requestCount: 1,
      totalTokens: 0,
      reportedCostAmount: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
    });
    event(first.id, "zero", "2026-03-01T00:00:00.000Z", {
      totalTokens: 0,
      inputTokens: 0,
      outputTokens: 0,
      reasoningTokens: 0,
      cacheReadTokens: 0,
      cacheWriteTokens: 0,
      costAmount: 0,
      costStatus: "known",
    });
    expect(evaluateUsageAdvisoryThresholds(first.id).metrics).toMatchObject({
      requestCount: { observed: 1, availability: "known", state: "equal" },
      totalTokens: { observed: 0, availability: "known", state: "equal" },
      reportedCostAmount: { observed: 0, availability: "known", state: "equal" },
      cacheReadTokens: { observed: 0, availability: "known", state: "equal" },
      cacheWriteTokens: { observed: 0, availability: "known", state: "equal" },
    });

    const readOnlyCount = getDb().prepare("SELECT COUNT(*) AS count FROM usage_advisory_thresholds").get() as { count: number };
    const disabled = evaluateUsageAdvisoryThresholds(second.id);
    expect(disabled.range).toEqual({ from: null, to: null });
    expect(disabled.metrics.requestCount).toEqual({ observed: 0, threshold: null, availability: "known", state: "disabled" });
    expect(getDb().prepare("SELECT COUNT(*) AS count FROM usage_advisory_thresholds").get()).toEqual(readOnlyCount);

    replace(second.id, 1, {
      requestCount: 0,
      totalTokens: 7,
      reportedCostAmount: 0.8,
      cacheReadTokens: 3,
      cacheWriteTokens: 1,
    });
    event(second.id, "partial-known", "2026-03-01T01:00:00.000Z", {
      totalTokens: 7,
      cacheReadTokens: 3,
      cacheWriteTokens: null,
      costAmount: 0.8,
      costStatus: "known",
    });
    event(second.id, "partial-missing", "2026-03-01T02:00:00.000Z", {
      totalTokens: null,
      inputTokens: null,
      outputTokens: null,
      reasoningTokens: null,
      cacheReadTokens: null,
      cacheWriteTokens: null,
      costAmount: null,
      costStatus: "partial",
    });
    const partial = evaluateUsageAdvisoryThresholds(second.id);
    expect(partial.metrics).toMatchObject({
      totalTokens: { observed: 7, availability: "partial", state: "unknown" },
      reportedCostAmount: { observed: 0.8, availability: "partial", state: "unknown" },
      cacheReadTokens: { observed: 3, availability: "partial", state: "unknown" },
      cacheWriteTokens: { observed: null, availability: "unavailable", state: "unknown" },
    });
  });

  it("uses UTC half-open ranges, rejects inverted ranges, and never infers a cost", () => {
    const { first, second } = setup();
    replace(first.id, 1, { requestCount: 1, reportedCostAmount: 0 });
    event(first.id, "at-from", "2026-04-01T00:00:00.000Z", { costAmount: null, costStatus: "unavailable" });
    event(first.id, "at-to", "2026-04-02T00:00:00.000Z", { costAmount: 99, costStatus: "known" });
    const ranged = evaluateUsageAdvisoryThresholds(first.id, {
      from: "2026-04-01T00:00:00.000Z",
      to: "2026-04-02T00:00:00.000Z",
    });
    expect(ranged.metrics.requestCount).toMatchObject({ observed: 1, availability: "known", state: "equal" });
    expect(ranged.metrics.reportedCostAmount).toEqual({ observed: null, threshold: 0, availability: "unavailable", state: "unknown" });
    expect(() => evaluateUsageAdvisoryThresholds(first.id, {
      from: "2026-04-02T00:00:00.000Z",
      to: "2026-04-02T00:00:00.000Z",
    })).toThrow(UsageError);

    replace(second.id, 1, { requestCount: 0 });
    expect(evaluateUsageAdvisoryThresholds(second.id).metrics.requestCount).toEqual({
      observed: 0,
      threshold: 0,
      availability: "known",
      state: "equal",
    });
  });
});
