import test from "node:test";
import assert from "node:assert/strict";
import { installationLabel, projectCatalog, scopedHref, visibleEntries } from "../src/app/components/customize-v2/catalog.mjs";

test("catalog reflects persisted disabled and archived states without conflating installation", () => {
  const rows = projectCatalog("launch", [{ id: "p", name: "Mail helper", enabled: false }],
    [{ id: "s", name: "Release checks", enabled: 1, archived_at: "2026-10-29" }]);
  assert.equal(installationLabel(rows[0]), "Installed · disabled");
  assert.equal(installationLabel(rows[1]), "Archived");
  assert.equal(installationLabel({ ...rows[0], installed: false }), "Available");
  assert.equal(rows.every((row) => row.scope === "launch"), true);
});

test("search filters kind, names, descriptions and project without mutating source", () => {
  const rows = projectCatalog("launch", [{ id: "p", name: "Mail", enabled: true }],
    [{ id: "s", name: "Release checks", description: "Verify artifacts", enabled: 1 }]);
  assert.equal(visibleEntries(rows, "skill", "VERIFY")[0].id, "s");
  assert.equal(visibleEntries(rows, "plugin", "release").length, 0);
  assert.equal(visibleEntries(rows, "skill", "launch").length, 1);
  assert.equal(rows.length, 2);
});

test("empty results remain truthful and projectless resource reads are rejected", () => {
  assert.deepEqual(projectCatalog("launch", [], []), []);
  assert.throws(() => projectCatalog("", [], []), /authorized project/);
});

test("all internal links preserve the exact project and existing query", () => {
  assert.equal(scopedHref("/customize/skills?view=archive", "a/b & c"), "/customize/skills?view=archive&project=a%2Fb+%26+c");
  assert.throws(() => scopedHref("https://external.invalid", "launch"), /internal route/);
  assert.throws(() => scopedHref("//external.invalid", "launch"), /internal route/);
  assert.throws(() => scopedHref("/skills", ""), /authorized project/);
});
test("archive/restore delegates exact encoded scope once and preserves authoritative state", async () => {
  const { createSkillLifecycle } = await import("../src/app/components/customize-v2/skill-lifecycle.mjs");
  const calls = [];
  let archived = false;
  const adapter = createSkillLifecycle(async (path, options) => {
    calls.push([path, options?.method ?? "GET"]);
    if (options?.method === "POST") { archived = path.includes("/archive?"); return { data: {} }; }
    return { data: path.startsWith("/skills/archived") ? (archived ? [{ name: "release/checks" }] : []) : (archived ? [] : [{ name: "release/checks" }]) };
  });
  assert.equal((await adapter.change("a & b", "release/checks", "archive")).outcome, "succeeded");
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "/skills/release%2Fchecks/archive?project=a%20%26%20b");
  assert.equal((await adapter.list("a & b")).archived.length, 1);
  assert.equal((await adapter.change("a & b", "release/checks", "restore")).outcome, "succeeded");
  assert.equal((await adapter.list("a & b")).active.length, 1);
});

test("archive errors preserve unknown outcomes and explicit refusals without replay", async () => {
  const { createSkillLifecycle } = await import("../src/app/components/customize-v2/skill-lifecycle.mjs");
  let count = 0;
  const unknown = createSkillLifecycle(async () => { count++; throw new Error("connection lost"); });
  assert.equal((await unknown.change("launch", "release", "archive")).outcome, "unknown");
  assert.equal(count, 1);
  const denied = createSkillLifecycle(async () => { count++; throw { status: 403 }; });
  assert.equal((await denied.change("launch", "release", "restore")).outcome, "refused");
  assert.equal(count, 2);
  await assert.rejects(denied.change("", "release", "archive"), /authorized project/);
  await assert.rejects(denied.change("launch", "release", "delete"), /Invalid skill action/);
  assert.equal(count, 2);
});

test("list read failures propagate rather than pretending there are no archived skills", async () => {
  const { createSkillLifecycle } = await import("../src/app/components/customize-v2/skill-lifecycle.mjs");
  const error = new Error("access denied");
  const lifecycle = createSkillLifecycle(async () => { throw error; });
  await assert.rejects(lifecycle.list("launch"), (value) => value === error);
});

test("installation scope uses only one active explicitly flagged API identity", async () => {
  const { resolveInstallationScope } = await import("../src/app/components/customize-v2/catalog.mjs");
  assert.equal(resolveInstallationScope([{ id: "named-only", name: "global-default" }]), null);
  assert.equal(resolveInstallationScope([{ id: "old", name: "old-installation", is_global: true, archived_at: "2026-10-29" }]), null);
  assert.deepEqual(resolveInstallationScope([
    { id: "p", name: "release", is_global: false },
    { id: "installation", name: "renamed-installation", is_global: 1 },
  ]), { id: "installation", kind: "installation", label: "System", apiProject: "renamed-installation" });
  assert.throws(() => resolveInstallationScope([
    { id: "one", name: "first", is_global: true },
    { id: "two", name: "second", is_global: true },
  ]), /ambiguous/);
});

test("installation catalog reads preserve the mapped namespace without changing it", async () => {
  const { readCatalogScope } = await import("../src/app/components/customize-v2/catalog.mjs");
  const reads = [];
  const source = { id: "installation", kind: "installation", label: "System", apiProject: "renamed-installation" };
  const client = { skills: { async list(project) {
    reads.push(project);
    return { data: [{ id: "orchestration", project_id: "installation", name: "phased-checkout-orchestration", enabled: 1 }] };
  } } };
  const rows = await readCatalogScope(client, source, "skill");
  assert.equal(rows[0].installed, true);
  assert.equal(rows[0].apiProject, "renamed-installation");
  assert.equal(rows[0].scope, "System");
  assert.deepEqual(reads, ["renamed-installation"]);
});

test("revoked, mismatched or absent catalog scope never falls back to another project", async () => {
  const { readCatalogScope } = await import("../src/app/components/customize-v2/catalog.mjs");
  const source = { id: "installation", kind: "installation", label: "System", apiProject: "explicit-installation" };
  let reads = 0;
  const failure = new Error("permission revoked");
  const denied = { plugins: { async list() { reads++; throw failure; } } };
  await assert.rejects(readCatalogScope(denied, source, "plugin"), (error) => error === failure);
  assert.equal(reads, 1);
  await assert.rejects(readCatalogScope(denied, null, "plugin"), /explicit authorized/);
  assert.equal(reads, 1);
  const crossed = { plugins: { async list() { reads++; return { data: [{ id: "secret", project_id: "another-project", name: "private", enabled: true }] }; } } };
  await assert.rejects(readCatalogScope(crossed, source, "plugin"), /does not match/);
  assert.equal(reads, 2);
});
test("real catalog page reader preserves installed membership and exact scope through pagination", async () => {
  const { createCatalogPageReader } = await import("../src/app/components/customize-v2/catalog-reader.mjs");
  const binding = { projectId: "project-a", apiProject: "a & b", visibility: "public", scopeIdentity: "operator-public-v1", label: "Public" };
  const requests = [];
  const read = createCatalogPageReader(async (path) => {
    requests.push(path);
    const offset = Number(new URL("https://fixture.invalid" + path).searchParams.get("offset"));
    return { scope: { kind: "project", projectId: "project-a" }, scopes: ["project", "public"], data: [
      { id: "catalog-" + offset, kind: "plugin", name: "Package " + offset, description: "Actual registry description", category: "Development", visibility: "public",
        installed: offset === 0, enabled: false, archived: false, revision: offset === 0 ? 2 : null, actions: [] },
    ], pagination: { offset, limit: 1, total: 2, hasMore: offset === 0 } };
  }, binding);
  const rows = await read("plugin");
  assert.equal(rows.length, 2);
  assert.equal(rows[0].installed, true);
  assert.equal(rows[0].apiProject, "a & b");
  assert.equal(rows[1].installed, false);
  assert.equal(rows[1].apiProject, undefined);
  assert.equal(requests.length, 2);
  assert.equal(new URL("https://fixture.invalid" + requests[1]).searchParams.get("project"), "a & b");
});

test("catalog page reader rejects crossed scopes, invalid state and changing snapshots", async () => {
  const { createCatalogPageReader } = await import("../src/app/components/customize-v2/catalog-reader.mjs");
  const binding = { projectId: "project-a", apiProject: "exact-source", visibility: "public", scopeIdentity: "catalog", label: "Public" };
  const record = { id: "one", kind: "skill", name: "One", description: "", category: "Local", visibility: "public", installed: false, enabled: false, archived: false, revision: null, actions: [] };
  const response = { scope: { kind: "project", projectId: "project-a" }, scopes: ["public"], data: [record], pagination: { offset: 0, limit: 1, total: 1, hasMore: false } };
  await assert.rejects(createCatalogPageReader(async () => ({ ...response, scope: { kind: "project", projectId: "other" } }), binding)("skill"), /authorized scope/);
  await assert.rejects(createCatalogPageReader(async () => ({ ...response, data: [{ ...record, enabled: true }] }), binding)("skill"), /Invalid or duplicated/);
  let count = 0;
  await assert.rejects(createCatalogPageReader(async () => {
    count++;
    return { ...response, data: [{ ...record, id: String(count) }], pagination: { offset: count - 1, limit: 1, total: count === 1 ? 2 : 3, hasMore: true } };
  }, binding)("skill"), /changed during/);
  assert.equal(count, 2);
});

test("catalog denial preserves the first failure and performs no hidden fallback or retry", async () => {
  const { createCatalogPageReader } = await import("../src/app/components/customize-v2/catalog-reader.mjs");
  let reads = 0;
  const failure = new Error("Original denied request");
  const read = createCatalogPageReader(async () => { reads++; throw failure; }, {
    projectId: "project-a", apiProject: "exact-source", visibility: "personal", scopeIdentity: "actor-a", label: "Personal",
  });
  await assert.rejects(read("plugin"), (error) => error === failure);
  assert.equal(reads, 1);
  assert.throws(() => createCatalogPageReader(() => {}, { projectId: "project-a", visibility: "public" }), /explicit catalog scope/);
});
test("catalog sections use real source categories and preserve records without mutation", async () => {
  const { groupCatalogEntries } = await import("../src/app/components/customize-v2/catalog.mjs");
  const entries = [
    { id: "one", category: "Research" }, { id: "two", category: "Development" }, { id: "three", category: "Research" },
  ];
  const before = JSON.stringify(entries);
  assert.deepEqual(groupCatalogEntries(entries).map((group) => [group.category, group.entries.map((entry) => entry.id)]),
    [["Research", ["one", "three"]], ["Development", ["two"]]]);
  assert.equal(JSON.stringify(entries), before);
});
test("view ownership keys distinguish null from real project names and preserve actor scope", async () => {
  const { customizeViewIdentity } = await import("../src/app/components/customize-v2/catalog.mjs");
  assert.notEqual(customizeViewIdentity(null, "plugin"), customizeViewIdentity("projectless", "plugin"));
  assert.notEqual(customizeViewIdentity(null, "skill", [{ id: "personal", scopeIdentity: "actor-a" }]),
    customizeViewIdentity(null, "skill", [{ id: "personal", scopeIdentity: "actor-b" }]));
  assert.notEqual(customizeViewIdentity("A", "skill"), customizeViewIdentity("a", "skill"));
  assert.throws(() => customizeViewIdentity("", "plugin"), /explicit null/);
});
test("full project catalog reader keeps disabled membership without retargeting a captured scope", async () => {
  const { createCatalogPageReader } = await import("../src/app/components/customize-v2/catalog-reader.mjs");
  const binding = { projectId: "project-a", apiProject: "original-scope", visibility: "project", scopeIdentity: "project-a", label: "Original" };
  const requests = [];
  const read = createCatalogPageReader(async (path) => {
    requests.push(path);
    return { scope: { kind: "project", projectId: "project-a" }, scopes: ["project"], data: [
      { id: "disabled", kind: "skill", name: "Disabled", description: "", category: "Local", visibility: "project", installed: true, enabled: false, archived: false, revision: 3, actions: [] },
    ], pagination: { offset: 0, limit: 100, total: 1, hasMore: false } };
  }, binding);
  binding.apiProject = "another-scope";
  binding.projectId = "another-id";
  const rows = await read("skill");
  assert.equal(rows[0].installed, true);
  assert.equal(installationLabel(rows[0]), "Installed · disabled");
  assert.equal(rows[0].apiProject, "original-scope");
  assert.equal(new URL("https://fixture.invalid" + requests[0]).searchParams.get("project"), "original-scope");
});
test("catalog display selectors cannot silently substitute unrelated scope semantics", async () => {
  const { createCatalogPageReader } = await import("../src/app/components/customize-v2/catalog-reader.mjs");
  assert.throws(() => createCatalogPageReader(() => {}, {
    projectId: "a", apiProject: "a", visibility: "personal", selectorId: "project", scopeIdentity: "actor-a", label: "Project",
  }), /selector does not match/);
  assert.doesNotThrow(() => createCatalogPageReader(() => {}, {
    projectId: "installation", apiProject: "explicit-installation", visibility: "project", selectorId: "system", scopeIdentity: "installation", label: "System",
  }));
});
