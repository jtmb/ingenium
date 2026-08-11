import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Buffer } from "node:buffer";
import { getDb, resetDbForTest } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";
import { getObservations, storeObservation } from "../lib/tools/observations.js";
import { getTraits, upsertTrait } from "../lib/tools/personality.js";
import { approveProposal, listProposals, MAX_PROPOSAL_REQUEST_BYTES } from "../lib/tools/skill-governance.js";
import { archiveSkill, createSkill, getSkill, restoreSkill } from "../lib/tools/skills.js";
import { getSynthesisStatus, runSynthesis, type SynthesisFaultPoint } from "../lib/tools/synthesis.js";
import type { LLMTextExecutor } from "../lib/tools/synthesis-llm.js";

let directory: string;
let databasePath: string;

function readBatch(projectId: string): { stage: string; last_error_code: string | null; last_error_message: string | null } {
  return getDb(databasePath).prepare(
    `SELECT stage, last_error_code, last_error_message
     FROM synthesis_batches
     WHERE project_id = ?
     ORDER BY created_at, id
     LIMIT 1`,
  ).get(projectId) as { stage: string; last_error_code: string | null; last_error_message: string | null };
}

function proposalPayload(name: string): object {
  return {
    skills_to_create: [{
      name,
      description: `Durable ${name} proposal`,
      content: "# Durable synthesis proposal\n",
      tags: "durable,test",
    }],
    skills_to_update: [],
    personality_traits: [],
    insights: ["durable batch"],
    summary: "proposal generated",
  };
}

function executorFor(consolidation: object, proposal: object): LLMTextExecutor {
  return vi.fn(async ({ system }) => ({
    ok: true,
    content: JSON.stringify(system.includes("personality model consolidator") ? consolidation : proposal),
  }));
}

function faultAt(point: SynthesisFaultPoint) {
  return (candidate: SynthesisFaultPoint) => {
    if (candidate === point) throw new Error(`injected ${point}`);
  };
}

beforeEach(() => {
  resetDbForTest();
  directory = mkdtempSync(join(tmpdir(), "ingenium-synthesis-batches-"));
  mkdirSync(join(directory, ".ingenium"));
  databasePath = join(directory, ".ingenium", "data.db");
  process.env.INGENIUM_CORE_DB_PATH = databasePath;
});

afterEach(() => {
  resetDbForTest();
  rmSync(directory, { recursive: true, force: true });
});

describe("crash-resumable synthesis batches", () => {
  it("resumes after a trait-stage crash without duplicate confidence or proposals", async () => {
    const project = createProject("synthesis-resume-traits");
    const trait = upsertTrait(project.id, "code_preference", "User prefers resumable processing", undefined, 0.2);
    const observation = storeObservation(project.id, "preference", "User requires durable synthesis", 8);
    const executor = executorFor(
      { create: [], confirm: [{ trait_id: trait.id, observation_id: observation.id }], ignore_count: 0 },
      proposalPayload("resume-traits"),
    );

    await expect(runSynthesis(project.id, undefined, {
      llmExecutor: executor,
      faultInjector: faultAt("after_traits_applied"),
    })).rejects.toThrow("injected after_traits_applied");

    expect(readBatch(project.id)).toMatchObject({ stage: "traits_applied" });
    expect(getObservations(project.id).find((item) => item.id === observation.id)?.status).toBe("pending");
    expect(getTraits(project.id).find((item) => item.id === trait.id)?.confidence).toBeCloseTo(0.35, 6);
    expect(listProposals(project.id)).toHaveLength(0);

    resetDbForTest();
    const resumed = await runSynthesis(project.id, undefined, { llmExecutor: executor });
    expect(resumed.observations_processed).toBe(1);
    expect(getObservations(project.id).find((item) => item.id === observation.id)?.status).toBe("processed");
    expect(getTraits(project.id).find((item) => item.id === trait.id)?.confidence).toBeCloseTo(0.35, 6);
    expect(listProposals(project.id).filter((proposal) => proposal.target_name === "resume-traits")).toHaveLength(1);

    const callsAfterResume = (executor as ReturnType<typeof vi.fn>).mock.calls.length;
    await runSynthesis(project.id, undefined, { llmExecutor: executor });
    expect((executor as ReturnType<typeof vi.fn>).mock.calls).toHaveLength(callsAfterResume);
    expect(getTraits(project.id).find((item) => item.id === trait.id)?.confidence).toBeCloseTo(0.35, 6);
    expect(listProposals(project.id).filter((proposal) => proposal.target_name === "resume-traits")).toHaveLength(1);
  });

  it.each<SynthesisFaultPoint>(["after_proposals_applied", "before_acknowledgment"])(
    "keeps observations pending after %s and resumes without a duplicate proposal",
    async (point) => {
      const project = createProject(`synthesis-${point}`);
      const observation = storeObservation(project.id, "workflow", `User tests ${point}`, 8);
      const proposalName = `resume-${point.replaceAll("_", "-")}`;
      const executor = executorFor(
        {
          create: [{
            trait_type: "workflow_pattern",
            trait_value: `User requires ${point}`,
            confidence_hint: 0.12,
            observation_ids: [observation.id],
          }],
          confirm: [],
          ignore_count: 0,
        },
        proposalPayload(proposalName),
      );

      await expect(runSynthesis(project.id, undefined, {
        llmExecutor: executor,
        faultInjector: faultAt(point),
      })).rejects.toThrow(`injected ${point}`);

      expect(readBatch(project.id)).toMatchObject({ stage: "proposals_applied" });
      expect(getObservations(project.id).find((item) => item.id === observation.id)?.status).toBe("pending");
      expect(listProposals(project.id).filter((proposal) => proposal.target_name === proposalName)).toHaveLength(1);

      resetDbForTest();
      const noLlmOnResume: LLMTextExecutor = vi.fn(async () => {
        throw new Error("completed proposal batches must not call the LLM again");
      });
      const resumed = await runSynthesis(project.id, undefined, { llmExecutor: noLlmOnResume });
      expect(resumed.observations_processed).toBe(1);
      expect(noLlmOnResume).not.toHaveBeenCalled();
      expect(getObservations(project.id).find((item) => item.id === observation.id)?.status).toBe("processed");
      expect(listProposals(project.id).filter((proposal) => proposal.target_name === proposalName)).toHaveLength(1);
    },
  );

  it("keeps batches project-scoped while another project completes", async () => {
    const projectA = createProject("synthesis-project-a");
    const projectB = createProject("synthesis-project-b");
    const observationA = storeObservation(projectA.id, "preference", "Project A durable trait", 8);
    const observationB = storeObservation(projectB.id, "preference", "Project B durable trait", 8);
    const executor: LLMTextExecutor = vi.fn(async ({ system, user }) => {
      const observationId = Number(user.match(/\[id:(\d+)\]/)?.[1]);
      if (system.includes("personality model consolidator")) {
        return {
          ok: true,
          content: JSON.stringify({
            create: [{
              trait_type: "code_preference",
              trait_value: `Project trait ${observationId}`,
              confidence_hint: 0.12,
              observation_ids: [observationId],
            }],
            confirm: [],
            ignore_count: 0,
          }),
        };
      }
      return { ok: true, content: JSON.stringify(proposalPayload(`project-${observationId}`)) };
    });

    await expect(runSynthesis(projectA.id, undefined, {
      llmExecutor: executor,
      faultInjector: faultAt("after_traits_applied"),
    })).rejects.toThrow("injected after_traits_applied");
    await runSynthesis(projectB.id, undefined, { llmExecutor: executor });

    expect(getObservations(projectA.id).find((item) => item.id === observationA.id)?.status).toBe("pending");
    expect(getObservations(projectB.id).find((item) => item.id === observationB.id)?.status).toBe("processed");
    expect(readBatch(projectA.id)).toMatchObject({ stage: "traits_applied" });
    expect(readBatch(projectB.id)).toMatchObject({ stage: "complete" });

    await runSynthesis(projectA.id, undefined, { llmExecutor: executor });
    expect(getObservations(projectA.id).find((item) => item.id === observationA.id)?.status).toBe("processed");
    expect(listProposals(projectA.id).every((proposal) => proposal.project_id === projectA.id)).toBe(true);
    expect(listProposals(projectB.id).every((proposal) => proposal.project_id === projectB.id)).toBe(true);
  });

  it("resumes the oldest incomplete batch before selecting newer observations", async () => {
    const project = createProject("synthesis-oldest-batch");
    const first = storeObservation(project.id, "workflow", "Resume the already claimed observation first", 8);
    const executor = executorFor(
      { create: [], confirm: [], ignore_count: 1 },
      proposalPayload("oldest-batch"),
    );

    await expect(runSynthesis(project.id, undefined, {
      llmExecutor: executor,
      faultInjector: faultAt("after_traits_applied"),
    })).rejects.toThrow("injected after_traits_applied");

    const later = storeObservation(project.id, "workflow", "Do not leapfrog this newer observation", 8);
    resetDbForTest();

    const resumed = await runSynthesis(project.id, undefined, { llmExecutor: executor });
    expect(resumed.observations_processed).toBe(1);
    expect(getObservations(project.id).find((item) => item.id === first.id)?.status).toBe("processed");
    expect(getObservations(project.id).find((item) => item.id === later.id)?.status).toBe("pending");
  });

  it("requires a persisted proposal plan before entering the proposal stage", async () => {
    const project = createProject("synthesis-proposal-plan-guard");
    storeObservation(project.id, "workflow", "Proposal intent must be durable", 8);
    const executor = executorFor(
      { create: [], confirm: [], ignore_count: 1 },
      proposalPayload("proposal-plan-guard"),
    );

    await expect(runSynthesis(project.id, undefined, {
      llmExecutor: executor,
      faultInjector: faultAt("after_traits_applied"),
    })).rejects.toThrow("injected after_traits_applied");

    const now = new Date().toISOString();
    expect(() => getDb(databasePath).prepare(
      `UPDATE synthesis_batches
       SET stage = 'proposals_applied', proposals_applied_at = ?, updated_at = ?, revision = revision + 1
       WHERE project_id = ?`,
    ).run(now, now, project.id)).toThrow(/CHECK constraint failed/);
    expect(readBatch(project.id)).toMatchObject({ stage: "traits_applied" });
  });

  it("uses batch ownership to reject a concurrent worker after a lock race", async () => {
    const project = createProject("synthesis-owner-cas");
    storeObservation(project.id, "workflow", "One worker must own the batch", 8);
    let releaseConsolidation!: () => void;
    let markConsolidationStarted!: () => void;
    const consolidationStarted = new Promise<void>((resolve) => { markConsolidationStarted = resolve; });
    const executor: LLMTextExecutor = vi.fn(async ({ system }) => {
      if (system.includes("personality model consolidator")) {
        markConsolidationStarted();
        await new Promise<void>((resolve) => { releaseConsolidation = resolve; });
        return { ok: true, content: JSON.stringify({ create: [], confirm: [], ignore_count: 1 }) };
      }
      return { ok: true, content: JSON.stringify(proposalPayload("owner-cas")) };
    });

    const first = runSynthesis(project.id, undefined, { llmExecutor: executor, ownerToken: "worker-one" });
    await consolidationStarted;
    const second = await runSynthesis(project.id, undefined, { llmExecutor: executor, ownerToken: "worker-two" });

    expect(second.summary).toContain("owned by another worker");
    expect(executor).toHaveBeenCalledTimes(1);
    releaseConsolidation();
    await first;
  });

  it("records a bounded LLM error without acknowledging the batch", async () => {
    const project = createProject("synthesis-llm-failure");
    const observation = storeObservation(project.id, "error", "Provider is temporarily unavailable", 8);
    const unavailable: LLMTextExecutor = vi.fn(async () => ({ ok: false, content: "", error: "provider unavailable" }));

    const result = await runSynthesis(project.id, undefined, { llmExecutor: unavailable });
    const batch = readBatch(project.id);
    expect(result.errors).toHaveLength(1);
    expect(batch.stage).toBe("created");
    expect(batch.last_error_code).toBe("TRAIT_LLM_UNAVAILABLE");
    expect(Buffer.byteLength(batch.last_error_message ?? "", "utf8")).toBeLessThanOrEqual(1024);
    expect(getObservations(project.id).find((item) => item.id === observation.id)?.status).toBe("pending");
  });

  it("resumes a plan after its retained create proposal is safely applied", async () => {
    const project = createProject("synthesis-resume-applied-create");
    const observation = storeObservation(project.id, "workflow", "Resume through an applied create proposal", 8);
    const blockedTarget = createSkill(project.id, "synthesis-archived-update", "Archived target", "# Archived target");
    archiveSkill(project.id, blockedTarget.name);
    const retainedTarget = "synthesis-retained-create";
    const executor = executorFor(
      { create: [], confirm: [], ignore_count: 1 },
      {
        skills_to_create: [{
          name: retainedTarget,
          description: "A create proposal retained through resume",
          content: "# Retained create proposal\n",
        }],
        skills_to_update: [{
          name: blockedTarget.name,
          patch: "Add a resumed rule",
          patch_type: "add-rule",
        }],
        insights: [],
        summary: "Create before archived update",
      },
    );

    const first = await runSynthesis(project.id, undefined, { llmExecutor: executor });
    const retainedProposal = listProposals(project.id).find((proposal) => proposal.target_name === retainedTarget);
    const failedBatch = readBatch(project.id);

    expect(first.errors).toHaveLength(1);
    expect(retainedProposal).toMatchObject({ proposal_type: "create", status: "pending" });
    expect(failedBatch).toMatchObject({
      stage: "traits_applied",
      last_error_code: "TARGET_ARCHIVED",
      last_error_message: "Proposal application failed; the synthesis batch remains pending.",
    });
    expect(getSynthesisStatus(project.id).incompleteBatch).toMatchObject({
      stage: "traits_applied",
      hasStoredProposalPlan: true,
      errorCount: 1,
      lastErrorCode: "TARGET_ARCHIVED",
      leaseState: "available",
    });

    expect(approveProposal(project.id, retainedProposal!.id, "reviewer")).toMatchObject({ status: "applied" });
    expect(getSkill(project.id, retainedTarget)).toBeDefined();
    restoreSkill(project.id, blockedTarget.name);
    resetDbForTest();

    const noLlmOnResume: LLMTextExecutor = vi.fn(async () => {
      throw new Error("stored proposal plan must resume without an LLM call");
    });
    const resumed = await runSynthesis(project.id, undefined, { llmExecutor: noLlmOnResume });

    expect(resumed.observations_processed).toBe(1);
    expect(noLlmOnResume).not.toHaveBeenCalled();
    expect(getObservations(project.id).find((item) => item.id === observation.id)?.status).toBe("processed");
    expect(readBatch(project.id)).toMatchObject({ stage: "complete" });
    expect(listProposals(project.id).filter((proposal) => proposal.target_name === retainedTarget)).toEqual([
      expect.objectContaining({ id: retainedProposal!.id, status: "applied" }),
    ]);
  });

  it("updates a skill with a large unchanged file tree without exceeding proposal limits", async () => {
    const project = createProject("synthesis-large-update-file-tree");
    const targetName = "large-update-file-tree";
    const originalFileTree = JSON.stringify({
      "references/large.md": "x".repeat(MAX_PROPOSAL_REQUEST_BYTES),
    });
    createSkill(project.id, targetName, "Large file tree", "# Existing skill", undefined, undefined, undefined, originalFileTree);
    const observation = storeObservation(project.id, "workflow", "Keep unchanged references intact", 8);
    const executor = executorFor(
      { create: [], confirm: [], ignore_count: 1 },
      {
        skills_to_create: [],
        skills_to_update: [{ name: targetName, patch: "## New rule", patch_type: "add-rule" }],
        insights: [],
        summary: "Update only the main skill content",
      },
    );

    const result = await runSynthesis(project.id, undefined, { llmExecutor: executor });
    const proposal = listProposals(project.id).find((candidate) => candidate.target_name === targetName);

    expect(result.observations_processed).toBe(1);
    expect(getObservations(project.id).find((item) => item.id === observation.id)?.status).toBe("processed");
    expect(proposal).toMatchObject({ proposal_type: "update", status: "pending" });
    expect(JSON.parse(proposal!.proposed_state)).not.toHaveProperty("file_tree");

    expect(approveProposal(project.id, proposal!.id, "reviewer")).toMatchObject({ status: "applied" });
    expect(getSkill(project.id, targetName)).toMatchObject({
      content: "# Existing skill\n\n## New rule",
      file_tree: originalFileTree,
    });
  });

  it("merges reference files into a large existing file tree during update approval", async () => {
    const project = createProject("synthesis-large-update-file-tree-patch");
    const targetName = "large-update-file-tree-patch";
    const originalFileTree = JSON.stringify({
      "references/large.md": "x".repeat(MAX_PROPOSAL_REQUEST_BYTES),
    });
    createSkill(project.id, targetName, "Large file tree", "# Existing skill", undefined, undefined, undefined, originalFileTree);
    const observation = storeObservation(project.id, "workflow", "Add one reference without replacing existing references", 8);
    const executor = executorFor(
      { create: [], confirm: [], ignore_count: 1 },
      {
        skills_to_create: [],
        skills_to_update: [{
          name: targetName,
          patch: "## New rule",
          patch_type: "add-rule",
          reference_files: [{ path: "references/new.md", content: "# New reference" }],
        }],
        insights: [],
        summary: "Update skill content and one reference",
      },
    );

    const result = await runSynthesis(project.id, undefined, { llmExecutor: executor });
    const proposal = listProposals(project.id).find((candidate) => candidate.target_name === targetName);

    expect(result.observations_processed).toBe(1);
    expect(getObservations(project.id).find((item) => item.id === observation.id)?.status).toBe("processed");
    expect(JSON.parse(proposal!.proposed_state)).toMatchObject({
      file_tree_patch: JSON.stringify({ "references/new.md": "# New reference" }),
    });
    expect(JSON.parse(proposal!.proposed_state)).not.toHaveProperty("file_tree");

    expect(approveProposal(project.id, proposal!.id, "reviewer")).toMatchObject({ status: "applied" });
    expect(JSON.parse(getSkill(project.id, targetName)!.file_tree!)).toMatchObject({
      "references/large.md": "x".repeat(MAX_PROPOSAL_REQUEST_BYTES),
      "references/new.md": "# New reference",
    });
  });

  it("keeps Unicode proposal failures within the durable error byte limit", async () => {
    const project = createProject("synthesis-unicode-error");
    const observation = storeObservation(project.id, "workflow", "Exercise bounded Unicode errors", 8);
    const missingSkillName = "€".repeat(400);
    const executor = executorFor(
      { create: [], confirm: [], ignore_count: 1 },
      {
        skills_to_create: [],
        skills_to_update: [{ name: missingSkillName, patch: "Add a rule", patch_type: "add-rule" }],
        insights: [],
        summary: "invalid update target",
      },
    );

    const result = await runSynthesis(project.id, undefined, { llmExecutor: executor });
    const batch = readBatch(project.id);

    expect(result.errors).toHaveLength(1);
    expect(batch.stage).toBe("traits_applied");
    expect(batch.last_error_code).toBe("PROPOSAL_APPLY_FAILED");
    expect(batch.last_error_message).toBe("Proposal application failed; the synthesis batch remains pending.");
    expect(Buffer.byteLength(batch.last_error_message ?? "", "utf8")).toBeLessThanOrEqual(1024);
    expect(batch.last_error_message).not.toContain(missingSkillName);
    expect(getSynthesisStatus(project.id).incompleteBatch?.lastErrorCode).toBe("PROPOSAL_APPLY_FAILED");
    expect(getObservations(project.id).find((item) => item.id === observation.id)?.status).toBe("pending");
  });

  it("rejects a partial migration 089 schema", () => {
    createProject("synthesis-migration-guard");
    const db = getDb(databasePath);
    db.exec(`
      DROP TABLE synthesis_batch_observations;
      DROP TABLE synthesis_batches;
      CREATE TABLE synthesis_batches (id TEXT);
    `);

    resetDbForTest();
    expect(() => getDb(databasePath)).toThrow("Migration 089 is in a PARTIAL state");
  });
});
