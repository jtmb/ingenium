import test from "node:test";
import assert from "node:assert/strict";
import { decodeNativeCatalog, filterNativeEntries, hostedGovernanceMatches, nativeCatalogPath, nativeOwnerKey } from "./nativeCatalog.ts";
const scope = {serviceInstanceId: "service-a", projectId: "project-a", projectRevision: 7};
const plugin = (extra = {}) => ({id: "review-tools", selected_sha256: "a".repeat(64), enabled: false, removed: false,
  versions: [{sha256: "a".repeat(64), manifest: {id: "review-tools", version: "1.2.3", license: "MIT"}}],
  activation: "registered; engine restart and real inventory observation required", ...extra});
const registry = (packages = [plugin()]) => ({service_instance_id: scope.serviceInstanceId, project_id: scope.projectId,
  project_revision: scope.projectRevision, revision: 3, restart_required: true, engine_stopped: true, packages});
const source = (extra = {}) => ({id: "release", name: "Release", description: "Real project source",
  path: ".agents/skills/release/SKILL.md", content: "# Source", editable: true, reason: null, ...extra});
const workspace = (skills = [source()]) => ({service_instance_id: scope.serviceInstanceId, project_id: scope.projectId,
  project_revision: scope.projectRevision, revision: "revision", supported: true, reason: null, skills});
test("native paths retain exact project revision without synthetic global ownership", () => {
  const params = new URL("https://fixture.invalid" + nativeCatalogPath("skill", {...scope, projectId: "id/?x"})).searchParams;
  assert.equal(params.get("project_id"), "id/?x"); assert.equal(params.get("project_revision"), "7");
  assert.throws(() => nativeCatalogPath("skill", {...scope, projectId: ""}), /exact native/);
});
test("disabled stays registered; removed retains versions without claiming activation", () => {
  const disabled = decodeNativeCatalog("plugin", registry(), scope).entries[0];
  assert.equal(disabled.present, true); assert.equal(disabled.enabled, false); assert.equal(disabled.state, "Registered · disabled");
  assert.match(disabled.activation, /inventory observation required/);
  const removed = decodeNativeCatalog("plugin", registry([plugin({removed: true})]), scope).entries[0];
  assert.equal(removed.present, false); assert.match(removed.state, /versions retained/);
});
test("project source presence and read-only reasons never imply enabled or engine loaded", () => {
  const row = decodeNativeCatalog("skill", workspace([source({editable: false, reason: "Duplicate source ID"})]), scope).entries[0];
  assert.equal(row.present, true); assert.equal(row.enabled, null); assert.match(row.state, /read-only/);
  assert.equal(row.reason, "Duplicate source ID"); assert.match(row.activation, /not reported/);
});
test("cross-service cross-project and stale revision snapshots fail closed", () => {
  for (const value of [{...registry(), service_instance_id: "other"}, {...registry(), project_id: "other"}, {...registry(), project_revision: 8}]) {
    assert.throws(() => decodeNativeCatalog("plugin", value, scope), /current service/);
  }
});
test("inconsistent selected registration cannot be displayed as installed", () => {
  assert.throws(() => decodeNativeCatalog("plugin", registry([plugin({selected_sha256: "b".repeat(64)})]), scope), /selected plugin version/);
  assert.throws(() => decodeNativeCatalog("plugin", registry([plugin(), plugin()]), scope), /duplicate/);
});
test("alternate skill sources remain distinct while duplicate physical sources are rejected", () => {
  const value = workspace([source(), source({path: ".opencode/skills/release/SKILL.md", editable: false})]);
  assert.equal(decodeNativeCatalog("skill", value, scope).entries.length, 2);
  assert.throws(() => decodeNativeCatalog("skill", workspace([source(), source()]), scope), /duplicate/);
});
test("unsupported snapshots remain unavailable and malformed replies are not empty success", () => {
  const result = decodeNativeCatalog("skill", {...workspace([]), supported: false, reason: "WSL not qualified"}, scope);
  assert.equal(result.supported, false); assert.equal(result.reason, "WSL not qualified");
  assert.throws(() => decodeNativeCatalog("skill", {...workspace(), skills: undefined}, scope), /incomplete/);
});
test("filtering and owner keys preserve original records and actual service boundaries", () => {
  const rows = decodeNativeCatalog("plugin", registry(), scope).entries, original = JSON.stringify(rows);
  assert.equal(filterNativeEntries(rows, "REVIEW").length, 1); assert.equal(filterNativeEntries(rows, "missing").length, 0);
  assert.equal(JSON.stringify(rows), original);
  assert.notEqual(nativeOwnerKey(scope, {kind: "windows"}), nativeOwnerKey({...scope, serviceInstanceId: "b"}, {kind: "windows"}));
});

test("hosted composition admits explicit null only with actual actor installation and current native service", () => {
  const binding = {serviceInstanceId: "service-a", projectId: null, projectRevision: null, actorId: "actor",
    installationId: "installation", hostedProjectId: null};
  assert.equal(hostedGovernanceMatches(binding, "service-a", null, true), true);
  assert.equal(hostedGovernanceMatches({...binding, projectId: "global-default"}, "service-a", null, true), false);
  assert.equal(hostedGovernanceMatches(binding, "service-b", null, true), false);
  assert.equal(hostedGovernanceMatches({...binding, actorId: ""}, "service-a", null, true), false);
  assert.equal(hostedGovernanceMatches(binding, "service-a", null, false), false);
});
