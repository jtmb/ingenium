import test from "node:test";
import assert from "node:assert/strict";
import { createCustomizeService } from "../lib/customize-v2/catalog-service.ts";

const context = { actorId: "user-1", projectId: "project-a" };
function fixture(overrides = {}) {
  const calls = [];
  const records = new Map([
    ["project-a", [{ id: "skill-1", kind: "skill", name: "Release checks", enabled: 0, revision: 2, actions: ["activate", "archive", "restore"] }]],
    ["project-b", [{ id: "skill-2", kind: "skill", name: "Private research", enabled: 1 }]],
  ]);
  const receipts = new Map();
  const authority = {
    authorize: (ctx) => ctx.actorId === "user-1" && ctx.projectId === "project-a",
    scopes: () => ["project", "public"],
    installed: (ctx, kind) => records.get(ctx.projectId).filter((row) => row.kind === kind),
    discover: () => [{ id: "skill-new", kind: "skill", name: "Available skill", actions: ["install"] }],
    resource: (ctx, kind, id) => records.get(ctx.projectId).find((row) => row.kind === kind && row.id === id),
    async mutate(ctx, command) {
      calls.push(command);
      if (receipts.has(command.operationId)) return receipts.get(command.operationId);
      const row = records.get(ctx.projectId).find((entry) => entry.id === command.id);
      if (command.expectedRevision !== row.revision) return { operationId: command.operationId, outcome: "failed" };
      if (command.action === "activate") row.enabled = 1;
      if (command.action === "archive") row.archived = true;
      if (command.action === "restore") row.archived = false;
      row.revision++;
      const receipt = { operationId: command.operationId, outcome: "succeeded" };
      receipts.set(command.operationId, receipt);
      return receipt;
    },
    ...overrides,
  };
  return { service: createCustomizeService(authority), authority, records, calls };
}

test("persisted membership and enabled state are independent; responses redact source/credentials", async () => {
  const { service } = fixture();
  const result = await service.list(context, { kind: "skill" });
  assert.equal(result.data[0].installed, true);
  assert.equal(result.data[0].enabled, false);
  assert.deepEqual(result.scope, { kind: "project", projectId: "project-a" });
  assert.equal("source_content" in result.data[0], false);
  assert.equal("content" in result.data[0], false);
});

test("discovery never marks an uninstalled manifest installed", async () => {
  const { service } = fixture();
  const result = await service.list(context, { kind: "skill", visibility: "public" });
  assert.equal(result.data[0].installed, false);
  assert.equal(result.data[0].enabled, false);
});

test("missing identity and cross-project access fail before data reads", async () => {
  let reads = 0;
  const { service } = fixture({ installed() { reads++; return []; } });
  await assert.rejects(service.list({ projectId: "project-a" }), { code: "UNAUTHORIZED", status: 401 });
  await assert.rejects(service.list({ ...context, projectId: "project-b" }), { code: "FORBIDDEN", status: 403 });
  assert.equal(reads, 0);
});

test("unsupported scopes and invalid pagination fail explicitly", async () => {
  const { service } = fixture();
  await assert.rejects(service.list(context, { visibility: "personal" }), { code: "SCOPE_UNAVAILABLE", status: 409 });
  for (const options of [{ limit: 101 }, { offset: -1 }, { limit: 1.5 }, { kind: "secret" }]) {
    await assert.rejects(service.list(context, options), { code: "VALIDATION_ERROR" });
  }
  const page = await service.list(context, { kind: "skill", limit: 1, offset: 1 });
  assert.equal(page.data.length, 0);
  assert.equal(page.pagination.total, 1);
  assert.equal(page.pagination.hasMore, false);
});

test("activation, archive and restore survive a new service instance through owner reads", async () => {
  const { service, authority } = fixture();
  const command = { kind: "skill", id: "skill-1", action: "activate", operationId: "op-1", expectedRevision: 2 };
  assert.equal((await service.mutate(context, command)).outcome, "succeeded");
  // Idempotency belongs to the authoritative owner, not a second gateway store.
  assert.equal((await service.mutate(context, command)).outcome, "succeeded");
  let reloaded = await createCustomizeService(authority).list(context, { kind: "skill" });
  assert.equal(reloaded.data[0].revision, 3);
  assert.equal(reloaded.data[0].enabled, true);
  await service.mutate(context, { ...command, action: "archive", operationId: "op-2", expectedRevision: 3 });
  reloaded = await createCustomizeService(authority).list(context, { kind: "skill" });
  assert.equal(reloaded.data[0].archived, true);
  await service.mutate(context, { ...command, action: "restore", operationId: "op-3", expectedRevision: 4 });
  assert.equal((await service.list(context, { kind: "skill" })).data[0].archived, false);
});

test("forbidden mutation, stale revision, unsupported action and missing resource do not report success", async () => {
  const { service, calls } = fixture();
  const command = { kind: "skill", id: "skill-1", action: "activate", operationId: "op-1", expectedRevision: 1 };
  await assert.rejects(service.mutate({ ...context, projectId: "project-b" }, command), { code: "FORBIDDEN" });
  await assert.rejects(service.mutate(context, { ...command, id: "unknown" }), { code: "NOT_FOUND" });
  await assert.rejects(service.mutate(context, { ...command, action: "remove" }), { code: "ACTION_UNAVAILABLE" });
  assert.equal(calls.length, 0);
  assert.equal((await service.mutate(context, command)).outcome, "failed");
});

test("unknown mutation outcomes and transport failures never retry", async () => {
  let writes = 0;
  const { service } = fixture({ async mutate() { writes++; return null; } });
  await assert.rejects(service.mutate(context, { kind: "skill", id: "skill-1", action: "activate", operationId: "op-1" }), { code: "OUTCOME_UNKNOWN" });
  assert.equal(writes, 1);
  const failure = new Error("first transport failure");
  const broken = fixture({ async mutate() { writes++; throw failure; } }).service;
  await assert.rejects(broken.mutate(context, { kind: "skill", id: "skill-1", action: "activate", operationId: "op-2" }), (error) => error === failure);
  assert.equal(writes, 2);
});

test("catalog provider failures remain failures, never empty successful catalogs", async () => {
  const failure = new Error("catalog unavailable");
  const { service } = fixture({ discover() { throw failure; } });
  await assert.rejects(service.list(context, { visibility: "public" }), (error) => error === failure);
});
test("authorization receives the exact resource kind rather than a generic project read", async () => {
  const decisions = [];
  const { service } = fixture({ authorize(ctx, action, kind) { decisions.push([ctx.projectId, action, kind]); return kind === "skill"; } });
  await service.list(context, { kind: "skill" });
  await assert.rejects(service.list(context, { kind: "plugin" }), { code: "FORBIDDEN" });
  assert.deepEqual(decisions, [["project-a", "read", "skill"], ["project-a", "read", "skill"], ["project-a", "activate", "skill"], ["project-a", "archive", "skill"], ["project-a", "restore", "skill"], ["project-a", "read", "plugin"]]);
});

test("discovery rechecks the exact requested catalog scope", async () => {
  const calls = [];
  const { service } = fixture({ authorize(ctx, action, kind, visibility) {
    calls.push([ctx.projectId, action, kind, visibility]);
    return visibility === "project";
  } });
  await assert.rejects(service.list(context, { kind: "skill", visibility: "public" }), { code: "FORBIDDEN" });
  assert.deepEqual(calls, [["project-a", "read", "skill", "public"]]);
});

test("read-only users never receive actionable install/activation affordances", async () => {
  const { service, calls } = fixture({ authorize: (_ctx, action) => action === "read" });
  const list = await service.list(context, { kind: "skill" });
  assert.deepEqual(list.data[0].actions, []);
  await assert.rejects(service.mutate(context, { kind: "skill", id: "skill-1", action: "activate", operationId: "denied" }), { code: "FORBIDDEN" });
  assert.equal(calls.length, 0);
});
test("resource-specific read and activation denials hide records and remove actions", async () => {
  const entries = [
    { id: "skill-1", kind: "skill", name: "Allowed", enabled: 1, actions: ["activate"] },
    { id: "skill-2", kind: "skill", name: "Read only", enabled: 1, actions: ["activate"] },
    { id: "private", kind: "skill", name: "Hidden", enabled: 1, actions: ["activate"] },
  ];
  const { service, calls } = fixture({
    installed: () => entries,
    authorize: (_ctx, action, _kind, _visibility, resourceId) => action === "read"
      ? resourceId !== "private"
      : resourceId === "skill-1",
  });
  const result = await service.list(context, { kind: "skill" });
  assert.equal(result.pagination.total, 2);
  assert.deepEqual(result.data.map((entry) => [entry.id, entry.actions]), [["skill-1", ["activate"]], ["skill-2", []]]);
  await assert.rejects(service.mutate(context, { kind: "skill", id: "skill-2", action: "activate", operationId: "denied" }), { code: "FORBIDDEN" });
  assert.equal(calls.length, 0);
});

test("inconsistent or duplicate catalog identity fails instead of mislabelling installed state", async () => {
  const wrong = fixture({ discover: () => [{ id: "one", kind: "plugin", name: "Wrong kind" }] }).service;
  await assert.rejects(wrong.list(context, { kind: "skill", visibility: "public" }), { code: "INVALID_CATALOG" });
  const duplicate = fixture({ installed: () => [
    { id: "same", kind: "skill", name: "First" }, { id: "same", kind: "skill", name: "Second" },
  ] }).service;
  await assert.rejects(duplicate.list(context, { kind: "skill" }), { code: "INVALID_CATALOG" });
});
