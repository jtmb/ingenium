import test from "node:test";
import assert from "node:assert/strict";
import { parseSkillUpload, runSkillUpload, runSkillSave, verifySkillUpload, verifySkillSave,
  skillSavePayload, skillResourcePath, skillWriteFailure, skillWriteBlocked } from "../src/app/components/customize-v2/skill-write-outcomes.mjs";

const markdown = "---\nname: release-checks\ndescription: Verify release\n---\n# Release body\n";
const skill = { id: "id-1", project_id: "uuid-project", name: "release-checks", description: "Verify release",
  content: "# Original", tags: null, always_apply: 0, file_tree: JSON.stringify({ "references/check.md": "# Reference" }) };

test("parser failures never submit an API write", async () => {
  let writes = 0;
  const result = await runSkillUpload("Missing frontmatter", "project", { create: async () => { writes++; }, refresh: async () => true });
  assert.equal(result.status, "validation-error");
  assert.equal(writes, 0);
  assert.equal(parseSkillUpload("---\nname: ../escape\ndescription: Unsafe\n---\nBody"), null);
  assert.deepEqual(parseSkillUpload(markdown), { name: "release-checks", description: "Verify release", content: "# Release body" });
});

test("denied upload preserves the first failure and remains distinct from Markdown validation", async () => {
  const failure = Object.assign(new Error("Project access denied"), { status: 403, code: "FORBIDDEN" });
  let refreshes = 0;
  const result = await runSkillUpload(markdown, "project", { create: async () => { throw failure; }, refresh: async () => { refreshes++; return true; } });
  assert.equal(result.status, "refused");
  assert.equal(result.failure.original, failure);
  assert.match(result.message, /Project access denied/);
  assert.equal(refreshes, 0);
  assert.equal(skillWriteBlocked(result), false);
});

test("unknown create is sent once, remains blocked on failed lookup, and verifies without replay", async () => {
  let creates = 0;
  const failure = new TypeError("Connection lost");
  const result = await runSkillUpload(markdown, "exact-project", { create: async (_value, project) => {
    assert.equal(project, "exact-project"); creates++; throw failure;
  }, refresh: async () => true });
  assert.equal(result.status, "unknown");
  assert.equal(skillWriteBlocked(result), true);
  const missing = await verifySkillUpload(result, { read: async () => { throw Object.assign(new Error("Not found"), { status: 404 }); }, refresh: async () => true });
  assert.equal(skillWriteBlocked(missing), true);
  const verified = await verifySkillUpload(missing, { read: async (name, project) => {
    assert.equal(name, "release-checks"); assert.equal(project, "exact-project");
    return { ...skill, content: "# Release body" };
  }, refresh: async () => true });
  assert.equal(verified.status, "verified");
  assert.equal(verified.writeConfirmed, false);
  assert.equal(verified.failure.original, failure);
  assert.equal(creates, 1);
});

test("confirmed create with failed refresh stays confirmed and blocks another upload", async () => {
  let creates = 0;
  const result = await runSkillUpload(markdown, "project", { create: async () => { creates++; return skill; }, refresh: async () => false });
  assert.equal(result.status, "saved-refresh-failed");
  assert.equal(result.writeConfirmed, true);
  assert.equal(skillWriteBlocked(result), true);
  const verified = await verifySkillUpload(result, { read: async () => ({ ...skill, content: "# Release body" }), refresh: async () => true });
  assert.equal(verified.status, "verified");
  assert.equal(creates, 1);
});

test("readback conflict never authorizes a replay or claims uploaded success", async () => {
  const original = await runSkillUpload(markdown, "project", { create: async () => { throw new Error("lost"); }, refresh: async () => true });
  const result = await verifySkillUpload(original, { read: async () => ({ ...skill, content: "# Another writer" }), refresh: async () => true });
  assert.equal(result.status, "conflict");
  assert.equal(skillWriteBlocked(result), true);
});

test("save refusal retains exact draft and avoids readback or retries", async () => {
  let writes = 0; let reads = 0;
  const draft = "# Draft  \n\n";
  const failure = Object.assign(new Error("Read-only project"), { status: 403 });
  const result = await runSkillSave(skill, "SKILL.md", draft, "project", { write: async (_name, payload, project) => {
    writes++; assert.equal(project, "project"); assert.equal(payload.content, draft); throw failure;
  }, read: async () => { reads++; return skill; } });
  assert.equal(result.status, "refused");
  assert.equal(result.attempt.text, draft);
  assert.equal(result.failure.original, failure);
  assert.equal(writes, 1); assert.equal(reads, 0);
});

test("accepted save with failed readback retains draft until explicit read-only verification", async () => {
  let writes = 0; let reads = 0;
  const draft = "# Draft";
  const result = await runSkillSave(skill, "SKILL.md", draft, "project", { write: async () => { writes++; }, read: async () => { reads++; throw new Error("readback failed"); } });
  assert.equal(result.status, "saved-refresh-failed");
  assert.equal(result.writeConfirmed, true);
  assert.equal(result.attempt.text, draft);
  const verified = await verifySkillSave(result, { read: async () => { reads++; return { ...skill, content: draft }; } });
  assert.equal(verified.status, "verified");
  assert.equal(writes, 1); assert.equal(reads, 2);
});

test("reference edits preserve the body and other files and verify the selected reference", async () => {
  const draft = "# Edited reference\n";
  const payload = skillSavePayload(skill, "references/check.md", draft);
  assert.equal(payload.content, "# Original");
  assert.equal(JSON.parse(payload.extra.files)["references/check.md"], draft);
  const result = await runSkillSave(skill, "references/check.md", draft, "project", {
    write: async () => undefined,
    read: async () => ({ ...skill, file_tree: payload.extra.files }),
  });
  assert.equal(result.status, "verified");
  assert.equal(result.attempt.path, "references/check.md");
  let writes = 0;
  const invalid = await runSkillSave(skill, "references/missing.md", draft, "project", { write: async () => { writes++; }, read: async () => skill });
  assert.equal(invalid.status, "validation-error");
  assert.equal(writes, 0);
});

test("wrong resource or namespace cannot verify an unknown save", async () => {
  const result = await runSkillSave(skill, "SKILL.md", "# Draft", "project", { write: async () => { throw new Error("lost"); }, read: async () => skill });
  const wrong = await verifySkillSave(result, { read: async () => ({ ...skill, project_id: "another-project", content: "# Draft" }) });
  assert.equal(wrong.status, "conflict");
  assert.equal(skillWriteBlocked(wrong), true);
});

test("resource URLs remain in the exact project and proven pre-handler cancellation is a refusal", () => {
  assert.equal(skillResourcePath("name?project=other", "a & b"), "/skills/name%3Fproject%3Dother?project=a%20%26%20b");
  assert.throws(() => skillResourcePath("name", ""), /authorized project/);
  assert.equal(skillWriteFailure(Object.assign(new Error("Authentication confirmation was cancelled."), { name: "AbortError" })).outcome, "refused");
  assert.equal(skillWriteFailure(Object.assign(new Error("fetch aborted"), { name: "AbortError" })).outcome, "unknown");
});
