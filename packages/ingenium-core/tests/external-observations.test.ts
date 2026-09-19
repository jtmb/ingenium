import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createHash } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, resetDbForTest } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";
import { extractExternalObservation } from "../lib/tools/extraction.js";
import { getObservations, deleteObservation } from "../lib/tools/observations.js";
import { setSetting } from "../lib/tools/settings.js";
import { runSynthesis } from "../lib/tools/synthesis.js";
import { listProposals } from "../lib/tools/skill-governance.js";

const worktreeId = `worktree-${"a".repeat(64)}`;
const nativeValidation = { nativeOpenCode: true } as const;
const input = { worktree: "/home/brajam/repos/ingenium", sessionId: "ses-external",
  message: { id: "msg-user", role: "user", text: "I prefer concise replies in all future sessions. Bearer secret-canary" } };
let directory: string;
let projectId: string;
const executor = vi.fn(async () => ({ ok: true as const, content: JSON.stringify({ rules: [
  { type: "preference", content: "User prefers concise replies. Bearer output-canary", importance: 7 },
  { type: "preference", content: "User prefers concise replies in future sessions.", importance: 7 },
] }) }));

beforeEach(() => {
  resetDbForTest();
  directory = mkdtempSync(join(tmpdir(), "ingenium-external-observations-"));
  vi.stubEnv("INGENIUM_CORE_DB_PATH", join(directory, "test.db"));
  projectId = createProject("ingenium-external").id;
  executor.mockClear();
});

afterEach(() => {
  resetDbForTest();
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllEnvs();
});

describe("external observation provenance and durable dedupe", () => {
  it("accepts an API-verified native binding without consulting coordination sessions", async () => {
    const nativeProject = createProject("ingenium-native-observation").id;
    const result = await extractExternalObservation(nativeProject, worktreeId, input, executor, nativeValidation);

    expect(result).toMatchObject({ enabled: true, created: true });
    expect(getObservations(nativeProject)).toHaveLength(1);
  });

  it("atomically keeps one attributable observation across concurrent events, restart, and synthesis replay", async () => {
    const results = await Promise.all([extractExternalObservation(projectId, worktreeId, input, executor, nativeValidation),
      extractExternalObservation(projectId, worktreeId, input, executor, nativeValidation)]);
    expect(results.filter((result) => result.created)).toHaveLength(1);
    const [observation] = getObservations(projectId);
    expect(observation.content).toBe("User prefers concise replies. [REDACTED]");
    const source = JSON.parse(observation.context!);
    expect(source).toEqual({ kind: "external-user-message-v1", worktreeId, sessionId: input.sessionId,
      messageId: input.message.id, fingerprint: createHash("sha256")
        .update("I prefer concise replies in all future sessions. [REDACTED]").digest("hex") });
    expect(JSON.stringify(executor.mock.calls)).not.toContain("secret-canary");
    const receipts = getDb().prepare("SELECT value FROM settings WHERE project_id = ? AND key LIKE 'external_observation_receipt_v1:%'").all(projectId);
    expect(receipts).toHaveLength(1);
    expect(JSON.stringify(receipts)).not.toMatch(/secret-canary|output-canary|prefers|prefer/);

    resetDbForTest();
    executor.mockClear();
    expect(await extractExternalObservation(projectId, worktreeId, input, executor, nativeValidation)).toMatchObject({ created: false, observationId: observation.id });
    expect(executor).not.toHaveBeenCalled();

    const synthesisExecutor = vi.fn(async ({ system }: { system: string }) => ({ ok: true as const,
      content: JSON.stringify(system.includes("personality model consolidator")
        ? { create: [], confirm: [], ignore_count: 0 }
        : { skills_to_create: [{ name: "concise-replies", description: "Concise replies", content: "# Concise replies\nKeep responses concise.", tags: "communication" }],
          skills_to_update: [], personality_traits: [], insights: [], summary: "Preference candidate" }),
    }));
    await runSynthesis(projectId, input.sessionId, { llmExecutor: synthesisExecutor });
    resetDbForTest();
    await runSynthesis(projectId, input.sessionId, { llmExecutor: synthesisExecutor });
    const proposals = listProposals(projectId);
    expect(proposals).toHaveLength(1);
    expect(JSON.parse(proposals[0].observation_ids!)).toEqual([observation.id]);
    expect(JSON.parse(proposals[0].evidence_json!)[0].session_ids).toEqual([input.sessionId]);
    expect(getObservations(projectId)).toHaveLength(1);
    expect(getObservations(projectId)[0].status).toBe("processed");
  });

  it("rejects changed source text, unknown/foreign bindings and operational or assistant payloads", async () => {
    await extractExternalObservation(projectId, worktreeId, input, executor, nativeValidation);
    await expect(extractExternalObservation(projectId, worktreeId, { ...input,
      message: { ...input.message, text: "I prefer verbose replies in every future session." } }, executor, nativeValidation)).rejects.toThrow("SOURCE_CONFLICT");
    await expect(extractExternalObservation(projectId, "foreign", input, executor, nativeValidation)).rejects.toThrow("BINDING_REJECTED");
    await expect(extractExternalObservation(projectId, worktreeId, input, executor)).rejects.toThrow("BINDING_REJECTED");
    for (const message of [{ ...input.message, role: "assistant" }, { ...input.message, metadata: "operational" },
      { ...input.message, id: "sk-secret-canary" }]) {
      await expect(extractExternalObservation(projectId, worktreeId, { ...input, message }, executor, nativeValidation)).rejects.toThrow("INVALID");
    }
    expect(getObservations(projectId)).toHaveLength(1);
  });

  it("disabled learning prevents extraction, receipts, and ingestion even if disabled during the LLM call", async () => {
    setSetting(projectId, "automatic_learning_enabled", "false");
    expect(await extractExternalObservation(projectId, worktreeId, input, executor, nativeValidation)).toMatchObject({ enabled: false });
    expect(executor).not.toHaveBeenCalled();
    setSetting(projectId, "automatic_learning_enabled", "true");
    await extractExternalObservation(projectId, worktreeId, input, async () => {
      setSetting(projectId, "automatic_learning_enabled", "false");
      return executor();
    }, nativeValidation);
    expect(getObservations(projectId)).toHaveLength(0);
    expect(getDb().prepare("SELECT key FROM settings WHERE key LIKE 'external_observation_receipt_v1:%'").all()).toHaveLength(0);
  });

  it("does not retain task instructions or failed extraction and does not replay deleted observations", async () => {
    const task = { ...input, message: { ...input.message, text: "Operation: use this task metadata to implement a feature now." } };
    expect(await extractExternalObservation(projectId, worktreeId, task, executor, nativeValidation)).toMatchObject({ created: false });
    expect(executor).not.toHaveBeenCalled();
    const failed = { ...input, message: { ...input.message, id: "msg-failed" } };
    await expect(extractExternalObservation(projectId, worktreeId, failed, async () => ({ ok: false, content: "" }), nativeValidation)).rejects.toThrow("EXTRACTOR_UNAVAILABLE");
    const result = await extractExternalObservation(projectId, worktreeId, failed, executor, nativeValidation);
    expect(result.created).toBe(true);
    deleteObservation(projectId, result.observationId!);
    resetDbForTest();
    expect(await extractExternalObservation(projectId, worktreeId, failed, executor, nativeValidation)).toMatchObject({ created: false });
    expect(getObservations(projectId)).toHaveLength(0);
  });
});
