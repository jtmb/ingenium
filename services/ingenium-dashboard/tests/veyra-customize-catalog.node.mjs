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
