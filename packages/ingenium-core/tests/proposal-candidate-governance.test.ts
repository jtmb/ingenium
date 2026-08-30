import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, resetDbForTest } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";
import { createSkill } from "../lib/tools/skills.js";
import {
  deriveCandidateGroupKey,
  ensureProposalCandidate,
  getProposal,
  listProposals,
  MAX_PROPOSAL_EVIDENCE_ITEMS,
  MAX_PROPOSAL_JSON_DEPTH,
  MAX_PROPOSAL_MERGED_REFERENCES,
  MAX_PROPOSAL_OBSERVATION_IDS,
  MAX_PROPOSAL_REQUEST_BYTES,
  MAX_RECONCILIATION_RAW_BYTES,
  MAX_RECONCILIATION_WORK_UNITS,
  reconcileOpenProposalCandidates,
  submitProposal,
} from "../lib/tools/skill-governance.js";
import { storeObservation } from "../lib/tools/observations.js";

let tempDir: string;
let projectA: string;
let projectB: string;

function proposedState(content: string, description = "candidate description"): string {
  return JSON.stringify({ description, content, file_tree: JSON.stringify({ "reference.md": "reference" }) });
}

function openCandidates(projectId: string, candidateGroupKey: string) {
  return listProposals(projectId).filter((proposal) => (
    proposal.candidate_group_key === candidateGroupKey
    && (proposal.status === "draft" || proposal.status === "pending")
  ));
}

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-proposal-candidates-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "test.db");
  process.env.INGENIUM_HOME = tempDir;
  resetDbForTest();
  projectA = createProject("candidate-project-a").id;
  projectB = createProject("candidate-project-b").id;
});

afterAll(() => {
  resetDbForTest();
  rmSync(tempDir, { recursive: true, force: true });
});

describe("proposal candidate defaults", () => {
  it("reuses equivalent create, update, merge, and archive candidates", () => {
    const updateSkill = createSkill(projectA, "candidate-update", "update", "# update");
    const archiveSkill = createSkill(projectA, "candidate-archive", "archive", "# archive");
    const mergeSource = createSkill(projectA, "candidate-merge-source", "source", "# source");
    const mergeTarget = createSkill(projectA, "candidate-merge-target", "target", "# target");
    const cases = [
      { type: "create" as const, target: "candidate-create", state: proposedState("# create"), options: {} },
      { type: "update" as const, target: updateSkill.name, state: proposedState("# update candidate"), options: {} },
      {
        type: "merge" as const,
        target: mergeTarget.name,
        state: proposedState("# merged candidate"),
        options: { sourceProjectId: projectA, sourceName: mergeSource.name },
      },
      { type: "archive" as const, target: archiveSkill.name, state: JSON.stringify({}), options: {} },
    ];

    for (const candidateCase of cases) {
      const first = ensureProposalCandidate(projectA, candidateCase.type, candidateCase.target, candidateCase.state, candidateCase.options);
      submitProposal(projectA, first.proposal.id);
      const repeated = ensureProposalCandidate(projectA, candidateCase.type, candidateCase.target, candidateCase.state, candidateCase.options);

      expect(repeated.disposition).toBe("reused");
      expect(repeated.proposal.id).toBe(first.proposal.id);
      expect(openCandidates(projectA, first.proposal.candidate_group_key!).map((proposal) => proposal.id)).toEqual([first.proposal.id]);
    }
  });

  it("treats reordered proposal JSON and evidence references as equivalent", () => {
    const firstObservation = storeObservation(projectA, "preference", "First candidate observation");
    const secondObservation = storeObservation(projectA, "preference", "Second candidate observation");
    const first = ensureProposalCandidate(
      projectA,
      "create",
      "canonical-json-candidate",
      JSON.stringify({
        description: "canonical",
        content: "# canonical",
        tags: "one,two",
        file_tree: JSON.stringify({ "b.md": "B", "a.md": "A" }),
      }),
      {
        evidenceJson: JSON.stringify([{ model: "test", observation_ids: [secondObservation.id, firstObservation.id] }]),
        observationIds: JSON.stringify([secondObservation.id, firstObservation.id]),
      },
    );
    submitProposal(projectA, first.proposal.id);

    const repeated = ensureProposalCandidate(
      projectA,
      "create",
      "canonical-json-candidate",
      JSON.stringify({
        file_tree: JSON.stringify({ "a.md": "A", "b.md": "B" }),
        content: "# canonical",
        tags: "one,two",
        description: "canonical",
      }),
      {
        evidenceJson: JSON.stringify([{ observation_ids: [firstObservation.id, secondObservation.id], model: "test" }]),
        observationIds: JSON.stringify([firstObservation.id, secondObservation.id]),
      },
    );

    expect(repeated.disposition).toBe("reused");
    expect(repeated.proposal.id).toBe(first.proposal.id);
    expect(JSON.parse(repeated.proposal.evidence_json)).toHaveLength(1);
    expect(new Set(JSON.parse(repeated.proposal.observation_ids))).toEqual(new Set([firstObservation.id, secondObservation.id]));
  });

  it("replaces an equivalent open candidate with malformed stored evidence", () => {
    const observation = storeObservation(projectA, "preference", "Candidate reference repair");
    const first = ensureProposalCandidate(
      projectA,
      "create",
      "malformed-evidence-candidate",
      proposedState("# malformed evidence"),
      {
        evidenceJson: JSON.stringify([{ source: "test" }]),
        observationIds: JSON.stringify([observation.id]),
      },
    );
    submitProposal(projectA, first.proposal.id);
    getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      "UPDATE skill_proposals SET evidence_json = ? WHERE id = ?",
    ).run("{", first.proposal.id);

    const replacement = ensureProposalCandidate(
      projectA,
      "create",
      "malformed-evidence-candidate",
      proposedState("# malformed evidence"),
      {
        evidenceJson: JSON.stringify([{ source: "test" }]),
        observationIds: JSON.stringify([observation.id]),
      },
    );

    const candidates = listProposals(projectA)
      .filter((proposal) => proposal.target_name === "malformed-evidence-candidate");
    expect(replacement.disposition).toBe("replaced");
    expect(openCandidates(projectA, replacement.proposal.candidate_group_key!)).toEqual([
      expect.objectContaining({ id: replacement.proposal.id, status: "draft" }),
    ]);
    expect(candidates).toEqual(expect.arrayContaining([
      expect.objectContaining({
        id: first.proposal.id,
        status: "stale",
        reviewer: "system",
        review_reason: "Superseded because its stored proposal references are invalid",
      }),
    ]));
  });

  it("uses project-scoped canonical keys and ignores explicit custom keys", () => {
    const first = ensureProposalCandidate(projectA, "create", "shared-candidate", proposedState("# shared"));
    const second = ensureProposalCandidate(projectB, "create", "shared-candidate", proposedState("# shared"));
    const custom = ensureProposalCandidate(
      projectA,
      "create",
      "custom-candidate",
      proposedState("# custom"),
      { candidateGroupKey: "caller-visible-group" },
    );
    const customRetry = ensureProposalCandidate(
      projectA,
      "create",
      "custom-candidate",
      proposedState("# custom"),
      { candidateGroupKey: "other-caller-visible-group" },
    );

    expect(first.proposal.candidate_group_key).not.toBe(second.proposal.candidate_group_key);
    expect(first.proposal.candidate_group_key).toBe(deriveCandidateGroupKey(projectA, "create", "shared-candidate"));
    expect(second.proposal.candidate_group_key).toBe(deriveCandidateGroupKey(projectB, "create", "shared-candidate"));
    expect(custom.proposal.candidate_group_key).toBe(deriveCandidateGroupKey(projectA, "create", "custom-candidate"));
    expect(customRetry.proposal.id).toBe(custom.proposal.id);
  });

  it("stales and replaces a materially changed open candidate without losing history", () => {
    const originalObservation = storeObservation(projectA, "preference", "Original candidate observation");
    const replacementObservation = storeObservation(projectA, "preference", "Replacement candidate observation");
    const original = ensureProposalCandidate(
      projectA,
      "create",
      "materially-changed-candidate",
      proposedState("# original", "original"),
      { evidenceJson: JSON.stringify([{ reference: "old" }]), observationIds: JSON.stringify([originalObservation.id]) },
    );
    submitProposal(projectA, original.proposal.id);

    const replacement = ensureProposalCandidate(
      projectA,
      "create",
      "materially-changed-candidate",
      proposedState("# replacement", "replacement"),
      { evidenceJson: JSON.stringify([{ reference: "new" }]), observationIds: JSON.stringify([replacementObservation.id]) },
    );

    const superseded = getProposal(projectA, original.proposal.id)!;
    expect(replacement.disposition).toBe("replaced");
    expect(replacement.proposal.status).toBe("draft");
    expect(superseded.status).toBe("stale");
    expect(superseded.reviewer).toBe("system");
    expect(superseded.review_reason).toContain("materially newer candidate");
    expect(JSON.parse(superseded.evidence_json)).toEqual([{ reference: "old" }]);
    expect(JSON.parse(superseded.observation_ids)).toEqual([originalObservation.id]);
    expect(openCandidates(projectA, original.proposal.candidate_group_key!)).toHaveLength(1);
  });

  it("keeps one open candidate when concurrent equivalent cycles race", async () => {
    const candidates = await Promise.all(
      Array.from({ length: 16 }, () => Promise.resolve().then(() => ensureProposalCandidate(
        projectA,
        "create",
        "concurrent-candidate",
        proposedState("# concurrent"),
        { evidenceJson: JSON.stringify([{ source: "concurrent" }]) },
      ))),
    );

    const ids = new Set(candidates.map((candidate) => candidate.proposal.id));
    expect(ids.size).toBe(1);
    const candidateGroupKey = candidates[0]!.proposal.candidate_group_key!;
    expect(openCandidates(projectA, candidateGroupKey)).toHaveLength(1);
  });

  it("rejects unbounded candidate payloads before creating a proposal", () => {
    const evidenceOverLimit = JSON.stringify(
      Array.from({ length: MAX_PROPOSAL_EVIDENCE_ITEMS + 1 }, (_, index) => ({ index })),
    );
    expect(() => ensureProposalCandidate(
      projectA,
      "create",
      "too-many-evidence-references",
      proposedState("# bounded"),
      { evidenceJson: evidenceOverLimit },
    )).toThrow(/evidence_json/);

    const observationOverLimit = JSON.stringify(
      Array.from({ length: MAX_PROPOSAL_OBSERVATION_IDS + 1 }, (_, index) => index + 1),
    );
    expect(() => ensureProposalCandidate(
      projectA,
      "create",
      "too-many-observation-references",
      proposedState("# bounded"),
      { observationIds: observationOverLimit },
    )).toThrow(/observation_ids/);

    let nested: unknown = "end";
    for (let index = 0; index <= MAX_PROPOSAL_JSON_DEPTH; index++) nested = { nested };
    expect(() => ensureProposalCandidate(
      projectA,
      "create",
      "too-deep-candidate",
      JSON.stringify({ description: "deep", content: "# deep", nested }),
    )).toThrow(/depth/);

    expect(() => ensureProposalCandidate(
      projectA,
      "create",
      "too-large-candidate",
      JSON.stringify({ description: "large", content: "x".repeat(MAX_PROPOSAL_REQUEST_BYTES) }),
    )).toThrow(/limit/);

    expect(listProposals(projectA).some((proposal) => proposal.target_name === "too-large-candidate")).toBe(false);
  });

  it("rejects merged references beyond the persistent limit without replacing the candidate", () => {
    const firstEvidence = Array.from(
      { length: MAX_PROPOSAL_EVIDENCE_ITEMS },
      (_, index) => ({ reference: index }),
    );
    const secondEvidence = Array.from(
      { length: MAX_PROPOSAL_EVIDENCE_ITEMS },
      (_, index) => ({ reference: index + MAX_PROPOSAL_EVIDENCE_ITEMS }),
    );
    const first = ensureProposalCandidate(
      projectA,
      "create",
      "merged-reference-limit",
      proposedState("# merged references"),
      { evidenceJson: JSON.stringify(firstEvidence) },
    );
    const second = ensureProposalCandidate(
      projectA,
      "create",
      "merged-reference-limit",
      proposedState("# merged references"),
      { evidenceJson: JSON.stringify(secondEvidence) },
    );

    expect(second.proposal.id).toBe(first.proposal.id);
    expect(JSON.parse(second.proposal.evidence_json)).toHaveLength(MAX_PROPOSAL_MERGED_REFERENCES);
    expect(() => ensureProposalCandidate(
      projectA,
      "create",
      "merged-reference-limit",
      proposedState("# merged references"),
      { evidenceJson: JSON.stringify([{ reference: MAX_PROPOSAL_MERGED_REFERENCES }]) },
    )).toThrow(/Merged evidence references/);
    expect(getProposal(projectA, first.proposal.id)?.status).toBe("draft");
  });

  it("rejects foreign observation IDs before attaching them to a proposal", () => {
    const localObservation = storeObservation(projectA, "preference", "Local proposal evidence");
    const foreignObservation = storeObservation(projectB, "preference", "Foreign proposal evidence");

    expect(() => ensureProposalCandidate(
      projectA,
      "create",
      "foreign-observation-candidate",
      proposedState("# foreign observation"),
      { observationIds: JSON.stringify([foreignObservation.id]) },
    )).toThrow(/proposal project/);
    expect(listProposals(projectA).some((proposal) => proposal.target_name === "foreign-observation-candidate")).toBe(false);

    const local = ensureProposalCandidate(
      projectA,
      "create",
      "local-observation-candidate",
      proposedState("# local observation"),
      { observationIds: JSON.stringify([localObservation.id]) },
    );
    expect(JSON.parse(local.proposal.observation_ids)).toEqual([localObservation.id]);
  });
});

describe("legacy open proposal reconciliation", () => {
  it("collapses a 31-style backlog once, retains history, and merges equivalent references", () => {
    const target = createSkill(projectA, "legacy-backlog-target", "legacy", "# legacy");
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const state = proposedState("# proposed backlog", "backlog");
    const observationIds = Array.from(
      { length: 31 },
      (_, index) => storeObservation(projectA, "preference", `Legacy proposal observation ${index}`).id,
    );
    for (let index = 0; index < 31; index++) {
      const timestamp = new Date(Date.UTC(2026, 0, 1, 0, index, 0)).toISOString();
      db.prepare(
        "INSERT INTO skill_proposals (id,project_id,status,proposal_type,target_skill_id,target_name,expected_revision,proposed_state,evidence_json,observation_ids,quality_score,novelty_score,contradiction_flag,candidate_group_key,always_apply,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        `legacy-backlog-${index}`,
        projectA,
        "pending",
        "update",
        target.id,
        target.name,
        index === 30 ? target.revision + 1 : target.revision,
        state,
        JSON.stringify([{ source: "legacy", reference: index }]),
        JSON.stringify([observationIds[index]]),
        0.5,
        0.3,
        0,
        null,
        0,
        timestamp,
        timestamp,
      );
    }

    const first = reconcileOpenProposalCandidates();
    const reconciled = listProposals(projectA).filter((proposal) => proposal.target_name === target.name && proposal.proposal_type === "update");
    const survivor = reconciled.find((proposal) => proposal.status === "pending")!;

    expect(first.groupsProcessed).toBe(1);
    expect(first.keysAssigned).toBe(1);
    expect(first.staleProposals).toBe(30);
    expect(reconciled).toHaveLength(31);
    expect(survivor.id).toBe("legacy-backlog-29");
    expect(survivor.candidate_group_key).toBe(deriveCandidateGroupKey(projectA, "update", target.name));
    expect(JSON.parse(survivor.evidence_json)).toHaveLength(30);
    expect(JSON.parse(survivor.observation_ids)).toHaveLength(30);
    expect(reconciled.filter((proposal) => proposal.status === "stale")).toHaveLength(30);
    expect(getProposal(projectA, "legacy-backlog-30")?.evidence_json).toBe(JSON.stringify([{ source: "legacy", reference: 30 }]));
    expect(reconciled.filter((proposal) => proposal.status === "applied" || proposal.status === "rejected")).toHaveLength(0);
    expect(reconciled.filter((proposal) => proposal.status === "stale").every((proposal) => (
      proposal.reviewer === "system" && proposal.review_reason === "Superseded during proposal candidate reconciliation"
    ))).toBe(true);

    const beforeSecondPass = reconciled.map((proposal) => ({
      id: proposal.id,
      status: proposal.status,
      candidateGroupKey: proposal.candidate_group_key,
      evidence: proposal.evidence_json,
      observations: proposal.observation_ids,
    }));
    const second = reconcileOpenProposalCandidates();
    const afterSecondPass = listProposals(projectA)
      .filter((proposal) => proposal.target_name === target.name && proposal.proposal_type === "update")
      .map((proposal) => ({
        id: proposal.id,
        status: proposal.status,
        candidateGroupKey: proposal.candidate_group_key,
        evidence: proposal.evidence_json,
        observations: proposal.observation_ids,
      }));

    expect(second).toMatchObject({ groupsProcessed: 0, keysAssigned: 0, staleProposals: 0 });
    expect(afterSecondPass).toEqual(beforeSecondPass);
  });

  it("reconciles legacy caller-selected keys into one canonical candidate", () => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const state = proposedState("# legacy caller key", "legacy caller key");
    const firstTimestamp = new Date(Date.UTC(2026, 0, 2, 0, 0, 0)).toISOString();
    const secondTimestamp = new Date(Date.UTC(2026, 0, 2, 0, 1, 0)).toISOString();
    const insert = db.prepare(
      "INSERT INTO skill_proposals (id,project_id,status,proposal_type,target_name,proposed_state,evidence_json,observation_ids,quality_score,novelty_score,contradiction_flag,candidate_group_key,always_apply,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    insert.run(
      "legacy-caller-key-first",
      projectA,
      "draft",
      "create",
      "legacy-caller-key-target",
      state,
      JSON.stringify([{ reference: "first" }]),
      "[]",
      0,
      0,
      0,
      "caller-selected-first",
      0,
      firstTimestamp,
      firstTimestamp,
    );
    insert.run(
      "legacy-caller-key-second",
      projectA,
      "draft",
      "create",
      "legacy-caller-key-target",
      state,
      JSON.stringify([{ reference: "second" }]),
      "[]",
      0,
      0,
      0,
      "caller-selected-second",
      0,
      secondTimestamp,
      secondTimestamp,
    );

    const result = reconcileOpenProposalCandidates();
    const candidates = listProposals(projectA).filter((proposal) => proposal.target_name === "legacy-caller-key-target");
    const survivor = candidates.find((proposal) => proposal.status === "draft")!;

    expect(result).toMatchObject({ groupsProcessed: 1, keysAssigned: 1, staleProposals: 1 });
    expect(survivor.candidate_group_key).toBe(deriveCandidateGroupKey(projectA, "create", "legacy-caller-key-target"));
    expect(JSON.parse(survivor.evidence_json)).toHaveLength(2);
    expect(candidates.find((proposal) => proposal.id === "legacy-caller-key-first")?.status).toBe("stale");
  });

  it("defers reconciliation work beyond its fixed budget", () => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const now = new Date().toISOString();
    const insert = db.prepare(
      "INSERT INTO skill_proposals (id,project_id,status,proposal_type,target_name,proposed_state,evidence_json,observation_ids,quality_score,novelty_score,contradiction_flag,candidate_group_key,always_apply,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    );
    for (let index = 0; index <= MAX_RECONCILIATION_WORK_UNITS; index++) {
      insert.run(
        `work-limited-${index}`,
        projectA,
        "draft",
        "create",
        `work-limited-target-${index}`,
        proposedState("# work limited"),
        "[]",
        "[]",
        0,
        0,
        0,
        null,
        0,
        now,
        now,
      );
    }

    const result = reconcileOpenProposalCandidates();

    expect(result.workUnits).toBe(MAX_RECONCILIATION_WORK_UNITS);
    expect(result.deferredCandidates).toBeGreaterThan(0);
    expect(result.deferredGroups).toBeGreaterThan(0);
    expect(result.truncated).toBe(true);
    db.prepare("UPDATE skill_proposals SET status='stale' WHERE target_name LIKE 'work-limited-target-%'")
      .run();
  });

  it("defers oversized legacy payloads without reading their content", () => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    const now = new Date().toISOString();
    db.prepare(
      "INSERT INTO skill_proposals (id,project_id,status,proposal_type,target_name,proposed_state,evidence_json,observation_ids,quality_score,novelty_score,contradiction_flag,candidate_group_key,always_apply,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?,?,?)",
    ).run(
      "oversized-legacy-payload",
      projectA,
      "draft",
      "create",
      "oversized-legacy-target",
      JSON.stringify({ description: "oversized", content: "x".repeat(MAX_RECONCILIATION_RAW_BYTES) }),
      "[]",
      "[]",
      0,
      0,
      0,
      null,
      0,
      now,
      now,
    );

    const result = reconcileOpenProposalCandidates();

    expect(result).toMatchObject({ truncated: true, deferredGroups: 1, deferredCandidates: 1, rawBytesProcessed: 0 });
    expect(getProposal(projectA, "oversized-legacy-payload")?.candidate_group_key).toBeNull();
    expect(getProposal(projectA, "oversized-legacy-payload")?.status).toBe("draft");
  });
});
