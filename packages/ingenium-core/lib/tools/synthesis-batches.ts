import { Buffer } from "node:buffer";
import { randomUUID } from "node:crypto";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import type {
  IncompleteSynthesisBatchStatus,
  Observation,
  PersonalityTrait,
  SynthesisBatchStage,
} from "../schema.js";
import { logger } from "../logger.js";
import * as personality from "./personality.js";
import * as projects from "./projects.js";
import * as skillGovernance from "./skill-governance.js";
import * as skills from "./skills.js";
import * as synthesisLlm from "./synthesis-llm.js";
import type { LLMTextExecutor, SynthesisLLMResult } from "./synthesis-llm.js";
import { getSetting } from "./settings.js";
import { logEvent } from "./pipeline-events.js";

const SYNTHESIS_BATCH_LIMIT = 50;
const SYNTHESIS_BATCH_LEASE_MS = 300_000;
const MAX_PROPOSAL_PLAN_BYTES = 128 * 1024;
const MAX_ERROR_CODE_BYTES = 64;
const MAX_ERROR_MESSAGE_BYTES = 1024;

const PROPOSAL_GOVERNANCE_ERROR_CODES = new Set([
  "DUPLICATE_PROPOSAL",
  "INVALID_FLAG",
  "INVALID_JSON",
  "INVALID_NAME",
  "INVALID_OBSERVATION_IDS",
  "INVALID_PROPOSED_STATE",
  "INVALID_REVISION",
  "INVALID_STATUS_TRANSITION",
  "NAME_MISMATCH",
  "PROPOSAL_NOT_FOUND",
  "REFERENCE_LIMIT",
  "TARGET_ARCHIVED",
  "TARGET_EXISTS",
  "TARGET_NOT_FOUND",
]);

const SYNTHESIS_BATCH_ERROR_CODES = new Set([
  "ACKNOWLEDGMENT_FAILED",
  "PROPOSAL_APPLY_FAILED",
  "PROPOSAL_LLM_UNAVAILABLE",
  "PROPOSAL_PLAN_INVALID",
  "PROPOSAL_PLAN_TOO_LARGE",
  "SYNTHESIS_BATCH_ERROR",
  "TRAIT_APPLY_FAILED",
  "TRAIT_LLM_UNAVAILABLE",
  ...PROPOSAL_GOVERNANCE_ERROR_CODES,
]);

export type SynthesisFaultPoint = "after_traits_applied" | "after_proposals_applied" | "before_acknowledgment";

export interface DurableSynthesisOptions {
  llmExecutor?: LLMTextExecutor;
  ownerToken?: string;
  faultInjector?: (point: SynthesisFaultPoint) => void;
}

export interface DurableSynthesisResult {
  observations_processed: number;
  traits_created: number;
  traits_updated: number;
  skills_created: number;
  observations_skipped: number;
  errors: string[];
  summary: string;
}

interface SynthesisBatchRow {
  id: string;
  project_id: string;
  stage: SynthesisBatchStage;
  observation_count: number;
  owner_token: string | null;
  lease_expires_at: string | null;
  proposal_plan: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
  error_count: number;
  revision: number;
  traits_applied_at: string | null;
  proposals_applied_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
}

interface IncompleteSynthesisBatchStatusRow {
  stage: Exclude<SynthesisBatchStage, "complete">;
  observation_count: number;
  has_stored_proposal_plan: number;
  error_count: number;
  last_error_code: string | null;
  created_at: string;
  updated_at: string;
  is_owned: number;
}

interface ClaimedBatch {
  batch: SynthesisBatchRow;
  observations: Observation[];
}

interface TraitApplication {
  created: number;
  updated: number;
  skipped: number;
}

interface ProposalApplication {
  created: number;
  traitsCreated: number;
  traitsUpdated: number;
  proposals: Array<{ id: string; name: string; type: "create" | "update" }>;
}

class SynthesisBatchOwnershipError extends Error {
  constructor() {
    super("Synthesis batch ownership was lost");
    this.name = "SynthesisBatchOwnershipError";
  }
}

function synthesisDb() {
  return getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
}

function timestamp(): string {
  return new Date().toISOString();
}

function truncateUtf8(value: string, maxBytes: number): string {
  if (Buffer.byteLength(value, "utf8") <= maxBytes) return value;
  let end = 0;
  let size = 0;
  for (const character of value) {
    const characterSize = Buffer.byteLength(character, "utf8");
    if (size + characterSize > maxBytes) break;
    size += characterSize;
    end += character.length;
  }
  return value.slice(0, end);
}

function emptyResult(): DurableSynthesisResult {
  return {
    observations_processed: 0,
    traits_created: 0,
    traits_updated: 0,
    skills_created: 0,
    observations_skipped: 0,
    errors: [],
    summary: "",
  };
}

function boundedBatchErrorCode(code: string): string {
  const bounded = truncateUtf8(code, MAX_ERROR_CODE_BYTES);
  return SYNTHESIS_BATCH_ERROR_CODES.has(bounded) ? bounded : "SYNTHESIS_BATCH_ERROR";
}

function proposalApplicationErrorCode(error: unknown): string {
  if (error instanceof skillGovernance.GovernanceError
    && Buffer.byteLength(error.code, "utf8") <= MAX_ERROR_CODE_BYTES
    && PROPOSAL_GOVERNANCE_ERROR_CODES.has(error.code)) {
    return error.code;
  }
  return "PROPOSAL_APPLY_FAILED";
}

export function getIncompleteSynthesisBatchStatus(
  projectId: string,
): IncompleteSynthesisBatchStatus | null {
  const now = timestamp();
  const batch = synthesisDb().prepare(
    `SELECT stage, observation_count,
       CASE WHEN proposal_plan IS NULL THEN 0 ELSE 1 END AS has_stored_proposal_plan,
       error_count, last_error_code, created_at, updated_at,
       CASE WHEN owner_token IS NOT NULL AND lease_expires_at > ? THEN 1 ELSE 0 END AS is_owned
     FROM synthesis_batches
     WHERE project_id = ? AND stage <> 'complete'
     ORDER BY created_at, id
     LIMIT 1`,
  ).get(now, projectId) as IncompleteSynthesisBatchStatusRow | undefined;
  if (!batch) return null;
  return {
    stage: batch.stage,
    observationCount: batch.observation_count,
    hasStoredProposalPlan: batch.has_stored_proposal_plan === 1,
    errorCount: batch.error_count,
    lastErrorCode: batch.last_error_code === null ? null : boundedBatchErrorCode(batch.last_error_code),
    createdAt: batch.created_at,
    updatedAt: batch.updated_at,
    leaseState: batch.is_owned === 1 ? "owned" : "available",
  };
}

function readClaimedBatch(
  db: ReturnType<typeof synthesisDb>,
  projectId: string,
  batchId: string,
): ClaimedBatch | undefined {
  const batch = db.prepare(
    "SELECT * FROM synthesis_batches WHERE id = ? AND project_id = ?",
  ).get(batchId, projectId) as SynthesisBatchRow | undefined;
  if (!batch) return undefined;
  const observations = db.prepare(
    `SELECT observation.*
     FROM synthesis_batch_observations AS membership
     JOIN observations AS observation
       ON observation.project_id = membership.project_id
      AND observation.id = membership.observation_id
     WHERE membership.batch_id = ? AND membership.project_id = ?
     ORDER BY membership.ordinal`,
  ).all(batchId, projectId) as Observation[];
  return { batch, observations };
}

function claimOrCreateBatch(projectId: string, ownerToken: string): ClaimedBatch | "locked" | null {
  const outcome = execTransaction(() => {
    const db = synthesisDb();
    const now = timestamp();
    const leaseExpiresAt = new Date(Date.now() + SYNTHESIS_BATCH_LEASE_MS).toISOString();
    const existing = db.prepare(
      `SELECT id
       FROM synthesis_batches
       WHERE project_id = ? AND stage <> 'complete'
       ORDER BY created_at, id
       LIMIT 1`,
    ).get(projectId) as { id: string } | undefined;

    if (existing) {
      const claimed = db.prepare(
        `UPDATE synthesis_batches
         SET owner_token = ?, lease_expires_at = ?, updated_at = ?, revision = revision + 1
         WHERE id = ? AND project_id = ? AND stage <> 'complete'
           AND (
             owner_token IS NULL
             OR lease_expires_at IS NULL
             OR lease_expires_at <= ?
             OR owner_token = ?
           )`,
      ).run(ownerToken, leaseExpiresAt, now, existing.id, projectId, now, ownerToken);
      if (claimed.changes !== 1) return { value: "locked" as const, wrote: false };
      const batch = readClaimedBatch(db, projectId, existing.id);
      if (!batch || batch.observations.length !== batch.batch.observation_count) {
        throw new Error("Synthesis batch membership is incomplete");
      }
      return { value: batch, wrote: true };
    }

    const pending = db.prepare(
      `SELECT * FROM observations
       WHERE project_id = ? AND status = 'pending'
       ORDER BY importance DESC, created_at ASC
       LIMIT ?`,
    ).all(projectId, SYNTHESIS_BATCH_LIMIT) as Observation[];
    if (pending.length === 0) return { value: null, wrote: false };

    const batchId = randomUUID();
    db.prepare(
      `INSERT INTO synthesis_batches (
        id, project_id, stage, observation_count, owner_token, lease_expires_at,
        created_at, updated_at
      ) VALUES (?, ?, 'created', ?, ?, ?, ?, ?)`,
    ).run(batchId, projectId, pending.length, ownerToken, leaseExpiresAt, now, now);
    const insertMembership = db.prepare(
      `INSERT INTO synthesis_batch_observations (batch_id, project_id, observation_id, ordinal)
       VALUES (?, ?, ?, ?)`,
    );
    for (const [ordinal, observation] of pending.entries()) {
      insertMembership.run(batchId, projectId, observation.id, ordinal);
    }
    const batch = readClaimedBatch(db, projectId, batchId);
    if (!batch || batch.observations.length !== pending.length) {
      throw new Error("Failed to persist synthesis batch membership");
    }
    return { value: batch, wrote: true };
  });
  if (outcome.wrote) checkpointAfterWrite();
  return outcome.value;
}

function renewBatchLease(projectId: string, batchId: string, ownerToken: string): boolean {
  const renewed = execTransaction(() => {
    const now = timestamp();
    return synthesisDb().prepare(
      `UPDATE synthesis_batches
       SET lease_expires_at = ?, updated_at = ?, revision = revision + 1
       WHERE id = ? AND project_id = ? AND owner_token = ?
         AND lease_expires_at > ? AND stage <> 'complete'`,
    ).run(
      new Date(Date.now() + SYNTHESIS_BATCH_LEASE_MS).toISOString(),
      now,
      batchId,
      projectId,
      ownerToken,
      now,
    ).changes === 1;
  });
  if (renewed) checkpointAfterWrite();
  return renewed;
}

function releaseBatch(projectId: string, batchId: string, ownerToken: string): void {
  const released = execTransaction(() => synthesisDb().prepare(
    `UPDATE synthesis_batches
     SET owner_token = NULL, lease_expires_at = NULL, updated_at = ?, revision = revision + 1
     WHERE id = ? AND project_id = ? AND owner_token = ? AND stage <> 'complete'`,
  ).run(timestamp(), batchId, projectId, ownerToken).changes > 0);
  if (released) checkpointAfterWrite();
}

function recordBatchError(
  projectId: string,
  batchId: string,
  ownerToken: string,
  code: string,
  message: string,
): void {
  const wrote = execTransaction(() => synthesisDb().prepare(
    `UPDATE synthesis_batches
     SET last_error_code = ?, last_error_message = ?,
         error_count = MIN(error_count + 1, 100), updated_at = ?, revision = revision + 1
     WHERE id = ? AND project_id = ? AND owner_token = ? AND stage <> 'complete'`,
  ).run(
    boundedBatchErrorCode(code),
    truncateUtf8(message, MAX_ERROR_MESSAGE_BYTES),
    timestamp(),
    batchId,
    projectId,
    ownerToken,
  ).changes > 0);
  if (wrote) checkpointAfterWrite();
}

function assertOwnedStage(
  db: ReturnType<typeof synthesisDb>,
  projectId: string,
  batchId: string,
  ownerToken: string,
  stage: SynthesisBatchStage,
  now: string,
): void {
  const owned = db.prepare(
    `SELECT 1 FROM synthesis_batches
     WHERE id = ? AND project_id = ? AND owner_token = ? AND lease_expires_at > ? AND stage = ?`,
  ).get(batchId, projectId, ownerToken, now, stage);
  if (!owned) throw new SynthesisBatchOwnershipError();
}

function applyTraitStage(
  projectId: string,
  claimed: ClaimedBatch,
  ownerToken: string,
  consolidation: synthesisLlm.ConsolidationResult,
): TraitApplication {
  const outcome = execTransaction(() => {
    const db = synthesisDb();
    const now = timestamp();
    assertOwnedStage(db, projectId, claimed.batch.id, ownerToken, "created", now);
    const batchObservations = new Map(claimed.observations.map((observation) => [observation.id, observation]));
    const involved = new Set<number>();
    const applied: TraitApplication = { created: 0, updated: 0, skipped: 0 };

    for (const proposed of consolidation.create) {
      const observationIds = [...new Set(proposed.observation_ids)];
      if (observationIds.some((id) => !batchObservations.has(id))) {
        throw new Error("Trait consolidation referenced an observation outside its synthesis batch");
      }
      for (const id of observationIds) involved.add(id);
      const exemplarId = observationIds[0];
      const exemplar = exemplarId === undefined ? undefined : batchObservations.get(exemplarId);
      const existing = db.prepare(
        `SELECT * FROM personality_traits
         WHERE project_id = ? AND trait_type = ? AND trait_value = ?`,
      ).get(projectId, proposed.trait_type, proposed.trait_value) as PersonalityTrait | undefined;

      if (existing) {
        const updates = ["confidence = ?", "updated_at = ?"];
        const values: unknown[] = [Math.min(0.95, existing.confidence + 0.1), now];
        if (exemplarId !== undefined) {
          updates.push("exemplar_observation_id = ?");
          values.push(exemplarId);
        }
        if (exemplar?.content !== undefined) {
          updates.push("exemplar_text = ?");
          values.push(exemplar.content);
        }
        if (!existing.is_active) updates.push("is_active = 1");
        values.push(existing.id);
        db.prepare(`UPDATE personality_traits SET ${updates.join(", ")} WHERE id = ?`).run(...values);
        applied.updated++;
      } else {
        const confidence = Math.min(0.15, Math.max(0.10, proposed.confidence_hint));
        db.prepare(
          `INSERT INTO personality_traits (
            project_id, trait_type, trait_value, display_label, confidence,
            exemplar_observation_id, exemplar_text, source, is_active, metadata, created_at, updated_at
          ) VALUES (?, ?, ?, NULL, ?, ?, ?, 'synthesis', 1, NULL, ?, ?)`,
        ).run(
          projectId,
          proposed.trait_type,
          proposed.trait_value,
          confidence,
          exemplarId ?? null,
          exemplar?.content ?? null,
          now,
          now,
        );
        applied.created++;
      }
    }

    for (const confirmation of consolidation.confirm) {
      if (!batchObservations.has(confirmation.observation_id)) {
        throw new Error("Trait confirmation referenced an observation outside its synthesis batch");
      }
      involved.add(confirmation.observation_id);
      const trait = db.prepare(
        "SELECT * FROM personality_traits WHERE id = ? AND project_id = ? AND is_active = 1",
      ).get(confirmation.trait_id, projectId) as PersonalityTrait | undefined;
      if (!trait) continue;
      db.prepare(
        "UPDATE personality_traits SET confidence = ?, updated_at = ? WHERE id = ?",
      ).run(Math.min(0.95, trait.confidence + 0.15), now, trait.id);
      applied.updated++;
    }

    applied.skipped = Math.max(0, claimed.observations.length - involved.size);
    const advanced = db.prepare(
      `UPDATE synthesis_batches
       SET stage = 'traits_applied', traits_applied_at = ?,
           last_error_code = NULL, last_error_message = NULL,
           updated_at = ?, revision = revision + 1
       WHERE id = ? AND project_id = ? AND owner_token = ?
         AND lease_expires_at > ? AND stage = 'created'`,
    ).run(now, now, claimed.batch.id, projectId, ownerToken, now);
    if (advanced.changes !== 1) throw new SynthesisBatchOwnershipError();
    return applied;
  });
  checkpointAfterWrite();
  return outcome;
}

function parseProposalPlan(raw: string): SynthesisLLMResult | null {
  try {
    const parsed = JSON.parse(raw) as Partial<SynthesisLLMResult>;
    if (!Array.isArray(parsed.skills_to_create)
      || !Array.isArray(parsed.skills_to_update)
      || !Array.isArray(parsed.insights)
      || typeof parsed.summary !== "string") {
      return null;
    }
    return parsed as SynthesisLLMResult;
  } catch {
    return null;
  }
}

function persistProposalPlan(
  projectId: string,
  batchId: string,
  ownerToken: string,
  proposalPlan: string,
): boolean {
  const persisted = execTransaction(() => {
    const now = timestamp();
    return synthesisDb().prepare(
      `UPDATE synthesis_batches
       SET proposal_plan = ?, last_error_code = NULL, last_error_message = NULL,
           updated_at = ?, revision = revision + 1
       WHERE id = ? AND project_id = ? AND owner_token = ?
         AND lease_expires_at > ? AND stage = 'traits_applied' AND proposal_plan IS NULL`,
    ).run(proposalPlan, now, batchId, projectId, ownerToken, now).changes === 1;
  });
  if (persisted) checkpointAfterWrite();
  return persisted;
}

async function generateProposalPlan(
  projectId: string,
  observations: Observation[],
  opts: DurableSynthesisOptions | undefined,
): Promise<SynthesisLLMResult | null> {
  const directConfig = synthesisLlm.getFullLLMSynthesisConfig(projectId);
  const existingSkills = skills.listSkills(projectId).map((skill) => ({
    name: skill.name,
    description: skill.description,
  }));
  const existingTraits = personality.getTraits(projectId).map((trait) => ({
    trait_type: trait.trait_type,
    trait_value: trait.trait_value,
    confidence: trait.confidence,
  }));
  if (directConfig) {
    return synthesisLlm.callSynthesisLLM(
      observations,
      existingSkills,
      existingTraits,
      directConfig.endpoint!,
      directConfig.model,
      directConfig.apiKey,
      undefined,
      directConfig.allowPrivateNetwork === true,
    );
  }
  if (opts?.llmExecutor) {
    return synthesisLlm.callSynthesisLLMWithExecutor(
      observations,
      existingSkills,
      existingTraits,
      opts.llmExecutor,
    );
  }
  return null;
}

function applyPlanTrait(
  projectId: string,
  trait: NonNullable<SynthesisLLMResult["personality_traits"]>[number],
): "created" | "updated" | "unchanged" {
  const outcome = execTransaction(() => {
    const db = synthesisDb();
    const existing = db.prepare(
      `SELECT * FROM personality_traits
       WHERE project_id = ? AND trait_type = ? AND trait_value = ?`,
    ).get(projectId, trait.trait_type, trait.trait_value) as PersonalityTrait | undefined;
    const confidence = Math.min(0.95, Math.max(0.05, trait.confidence));
    if (!existing) {
      const now = timestamp();
      db.prepare(
        `INSERT INTO personality_traits (
          project_id, trait_type, trait_value, display_label, confidence,
          exemplar_observation_id, exemplar_text, source, is_active, metadata, created_at, updated_at
        ) VALUES (?, ?, ?, NULL, ?, NULL, NULL, 'synthesis', 1, NULL, ?, ?)`,
      ).run(projectId, trait.trait_type, trait.trait_value, confidence, now, now);
      return { status: "created" as const, wrote: true };
    }
    const nextConfidence = Math.max(existing.confidence, confidence);
    const active = Boolean(existing.is_active);
    if (nextConfidence === existing.confidence && active) {
      return { status: "unchanged" as const, wrote: false };
    }
    db.prepare(
      "UPDATE personality_traits SET confidence = ?, is_active = 1, updated_at = ? WHERE id = ?",
    ).run(nextConfidence, timestamp(), existing.id);
    return { status: "updated" as const, wrote: true };
  });
  if (outcome.wrote) checkpointAfterWrite();
  return outcome.status;
}

function submitProposalCandidate(projectId: string, candidate: skillGovernance.ProposalCandidateResult): boolean {
  if (candidate.proposal.status === "draft") {
    skillGovernance.submitProposal(projectId, candidate.proposal.id);
  }
  return candidate.disposition !== "reused";
}

function advanceProposalStage(projectId: string, batchId: string, ownerToken: string): void {
  const advanced = execTransaction(() => {
    const now = timestamp();
    return synthesisDb().prepare(
      `UPDATE synthesis_batches
       SET stage = 'proposals_applied', proposals_applied_at = ?,
           last_error_code = NULL, last_error_message = NULL,
           updated_at = ?, revision = revision + 1
       WHERE id = ? AND project_id = ? AND owner_token = ?
         AND lease_expires_at > ? AND stage = 'traits_applied'`,
    ).run(now, now, batchId, projectId, ownerToken, now).changes === 1;
  });
  if (!advanced) throw new SynthesisBatchOwnershipError();
  checkpointAfterWrite();
}

function applyProposalPlan(
  projectId: string,
  claimed: ClaimedBatch,
  ownerToken: string,
  plan: SynthesisLLMResult,
  synthModel: string | undefined,
): ProposalApplication {
  const observationIds = claimed.observations.map((observation) => observation.id);
  const observationIdsJson = JSON.stringify(observationIds);
  const sessionIds = [...new Set(claimed.observations.map((observation) => observation.session_id).filter(Boolean))];
  const applied: ProposalApplication = { created: 0, traitsCreated: 0, traitsUpdated: 0, proposals: [] };

  for (const trait of plan.personality_traits ?? []) {
    const status = applyPlanTrait(projectId, trait);
    if (status === "created") applied.traitsCreated++;
    if (status === "updated") applied.traitsUpdated++;
  }

  for (const skillToCreate of plan.skills_to_create) {
    if (skills.getSkill(projectId, skillToCreate.name)) continue;
    const fileTree = skillToCreate.reference_files && skillToCreate.reference_files.length > 0
      ? JSON.stringify(Object.fromEntries(skillToCreate.reference_files.map((file) => [file.path, file.content])))
      : undefined;
    const proposedState = JSON.stringify({
      content: skillToCreate.content,
      description: skillToCreate.description,
      category: "learning",
      tags: skillToCreate.tags || "auto-generated",
      always_apply: 0,
      file_tree: fileTree || null,
    });
    let candidate: skillGovernance.ProposalCandidateResult;
    try {
      candidate = skillGovernance.ensureProposalCandidate(
        projectId,
        "create",
        skillToCreate.name,
        proposedState,
        {
          evidenceJson: JSON.stringify([{
            trigger: "LLM synthesis",
            observation_ids: observationIds,
            session_ids: sessionIds,
            model: synthModel,
          }]),
          observationIds: observationIdsJson,
          qualityScore: 0.5,
          noveltyScore: 0.3,
          alwaysApply: 0,
        },
      );
    } catch (error) {
      if (error instanceof skillGovernance.GovernanceError
        && error.code === "TARGET_EXISTS"
        && skills.getSkill(projectId, skillToCreate.name)) {
        continue;
      }
      throw error;
    }
    if (!submitProposalCandidate(projectId, candidate)) continue;
    applied.created++;
    applied.proposals.push({ id: candidate.proposal.id, name: skillToCreate.name, type: "create" });
  }

  for (const skillToUpdate of plan.skills_to_update) {
    const existing = skills.getSkill(projectId, skillToUpdate.name);
    if (!existing) throw new Error(`Skill update target "${skillToUpdate.name}" was not found`);
    const referenceFiles = skillToUpdate.reference_files ?? [];
    const fileTreePatch = referenceFiles.length > 0
      ? JSON.stringify(Object.fromEntries(referenceFiles.map((file) => [file.path, file.content])))
      : undefined;
    const proposedState = JSON.stringify({
      content: `${existing.content}\n\n${skillToUpdate.patch}`,
      description: existing.description,
      category: (existing as { category?: string | null }).category || null,
      tags: existing.tags || null,
      always_apply: (existing as { always_apply?: number }).always_apply ?? 0,
      file_tree_patch: fileTreePatch,
    });
    const candidate = skillGovernance.ensureProposalCandidate(
      projectId,
      "update",
      skillToUpdate.name,
      proposedState,
      {
        evidenceJson: JSON.stringify([{
          trigger: "LLM synthesis update",
          observation_ids: observationIds,
          session_ids: sessionIds,
          model: synthModel,
          patch_type: skillToUpdate.patch_type,
        }]),
        observationIds: observationIdsJson,
        qualityScore: 0.5,
        noveltyScore: 0.3,
        alwaysApply: (existing as { always_apply?: number }).always_apply ?? 0,
      },
    );
    if (!submitProposalCandidate(projectId, candidate)) continue;
    applied.proposals.push({ id: candidate.proposal.id, name: skillToUpdate.name, type: "update" });
  }

  advanceProposalStage(projectId, claimed.batch.id, ownerToken);
  return applied;
}

function acknowledgeBatch(projectId: string, claimed: ClaimedBatch, ownerToken: string): number {
  const processed = execTransaction(() => {
    const db = synthesisDb();
    const now = timestamp();
    assertOwnedStage(db, projectId, claimed.batch.id, ownerToken, "proposals_applied", now);
    const batchMembers = db.prepare(
      `SELECT observation.status
       FROM synthesis_batch_observations AS membership
       JOIN observations AS observation
         ON observation.project_id = membership.project_id
        AND observation.id = membership.observation_id
       WHERE membership.batch_id = ? AND membership.project_id = ?`,
    ).all(claimed.batch.id, projectId) as Array<{ status: Observation["status"] }>;
    if (batchMembers.length !== claimed.batch.observation_count
      || batchMembers.some((observation) => observation.status !== "pending")) {
      throw new Error("Synthesis batch observations changed before acknowledgment");
    }
    const observationUpdate = db.prepare(
      `UPDATE observations
       SET status = 'processed', updated_at = ?
       WHERE project_id = ?
         AND id IN (
           SELECT observation_id
           FROM synthesis_batch_observations
           WHERE batch_id = ? AND project_id = ?
         )`,
    ).run(now, projectId, claimed.batch.id, projectId);
    if (observationUpdate.changes !== claimed.batch.observation_count) {
      throw new Error("Synthesis batch acknowledgment did not update every observation");
    }
    const completed = db.prepare(
      `UPDATE synthesis_batches
       SET stage = 'complete', completed_at = ?, proposal_plan = NULL,
           owner_token = NULL, lease_expires_at = NULL,
           last_error_code = NULL, last_error_message = NULL,
           updated_at = ?, revision = revision + 1
       WHERE id = ? AND project_id = ? AND owner_token = ?
         AND lease_expires_at > ? AND stage = 'proposals_applied'`,
    ).run(now, now, claimed.batch.id, projectId, ownerToken, now);
    if (completed.changes !== 1) throw new SynthesisBatchOwnershipError();
    return observationUpdate.changes;
  });
  checkpointAfterWrite();
  return processed;
}

function applyTraitDecay(projectId: string): void {
  const threshold = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  for (const trait of personality.getTraits(projectId)) {
    if (trait.updated_at >= threshold || trait.confidence <= 0.05) continue;
    try {
      personality.updateConfidence(projectId, trait.trait_type, trait.trait_value, -0.05);
    } catch {
      // A concurrent delete makes decay irrelevant for this cycle.
    }
  }
}

function logFailure(
  projectId: string,
  sessionId: string | undefined,
  parentEventId: number | undefined,
  result: DurableSynthesisResult,
  synthModel: string | undefined,
  synthEndpoint: string | undefined,
  synthProvider: string | undefined,
): void {
  try {
    logEvent(
      projectId,
      "synthesis_failed",
      "synthesis",
      "Synthesis batch remains resumable",
      result.summary,
      { ...result, model: synthModel, endpoint: synthEndpoint, provider: synthProvider },
      parentEventId,
      sessionId,
    );
  } catch {
    // Timeline observability must not alter durable batch progress.
  }
}

export async function runDurableSynthesis(
  projectId: string,
  sessionId?: string,
  opts?: DurableSynthesisOptions,
): Promise<DurableSynthesisResult> {
  const result = emptyResult();
  const globalProjectId = projects.getGlobalProject()?.id;
  const synthModel = globalProjectId ? getSetting(globalProjectId, "synthesis_model") : undefined;
  const synthEndpoint = globalProjectId ? getSetting(globalProjectId, "synthesis_endpoint") : undefined;
  const synthProvider = globalProjectId ? getSetting(globalProjectId, "synthesis_provider") : undefined;
  const ownerToken = opts?.ownerToken ?? randomUUID();
  const claim = claimOrCreateBatch(projectId, ownerToken);

  if (claim === "locked") {
    result.summary = "An existing synthesis batch is currently owned by another worker.";
    return result;
  }
  if (!claim) {
    applyTraitDecay(projectId);
    result.summary = "No pending observations to process.";
    try {
      logEvent(
        projectId,
        "synthesis_completed",
        "synthesis",
        "No pending observations.",
        result.summary,
        { observations_processed: 0, model: synthModel, endpoint: synthEndpoint, provider: synthProvider },
        undefined,
        sessionId,
      );
    } catch {
      // Timeline observability must not change the result.
    }
    return result;
  }

  let current = claim;
  let synthesisEventId: number | undefined;
  try {
    try {
      synthesisEventId = logEvent(
        projectId,
        "synthesis_started",
        "synthesis",
        `Synthesis ${current.batch.stage === "created" ? "started" : "resumed"} — ${current.observations.length} observation(s)`,
        `${current.observations.length} persisted observation(s) in batch ${current.batch.id}`,
        {
          batch_id: current.batch.id,
          stage: current.batch.stage,
          observation_ids: current.observations.map((observation) => observation.id),
          model: synthModel,
          endpoint: synthEndpoint,
        },
        undefined,
        sessionId,
      ).id;
    } catch {
      // Timeline observability must not block a durable batch.
    }

    if (current.batch.stage === "created") {
      const consolidation = await synthesisLlm.consolidateTraits(
        projectId,
        current.observations.map((observation) => ({
          id: observation.id,
          observation_type: observation.observation_type,
          content: observation.content,
        })),
        personality.getTraits(projectId).map((trait) => ({
          id: trait.id,
          trait_type: trait.trait_type,
          trait_value: trait.trait_value,
          confidence: trait.confidence,
        })),
        opts?.llmExecutor,
      );
      if (!consolidation) {
        const configured = synthesisLlm.getFullLLMSynthesisConfig(projectId) || opts?.llmExecutor;
        result.summary = configured
          ? "LLM consolidation is unavailable; the synthesis batch remains pending."
          : "LLM synthesis is not configured; the synthesis batch remains pending.";
        result.errors.push(result.summary);
        recordBatchError(projectId, current.batch.id, ownerToken, "TRAIT_LLM_UNAVAILABLE", result.summary);
        logFailure(projectId, sessionId, synthesisEventId, result, synthModel, synthEndpoint, synthProvider);
        return result;
      }
      if (!renewBatchLease(projectId, current.batch.id, ownerToken)) {
        result.summary = "Synthesis batch lease changed before traits could be applied.";
        return result;
      }
      try {
        const applied = applyTraitStage(projectId, current, ownerToken, consolidation);
        result.traits_created += applied.created;
        result.traits_updated += applied.updated;
        result.observations_skipped += applied.skipped;
      } catch (error) {
        if (error instanceof SynthesisBatchOwnershipError) {
          result.summary = "Synthesis batch lease changed while applying traits.";
          return result;
        }
        const message = error instanceof Error ? error.message : "Trait application failed";
        result.summary = "Trait application failed; the synthesis batch remains pending.";
        result.errors.push(result.summary);
        recordBatchError(projectId, current.batch.id, ownerToken, "TRAIT_APPLY_FAILED", message);
        logFailure(projectId, sessionId, synthesisEventId, result, synthModel, synthEndpoint, synthProvider);
        return result;
      }
      current = { ...current, batch: { ...current.batch, stage: "traits_applied" } };
      opts?.faultInjector?.("after_traits_applied");
    }

    if (current.batch.stage === "traits_applied") {
      let plan = current.batch.proposal_plan ? parseProposalPlan(current.batch.proposal_plan) : null;
      if (current.batch.proposal_plan && !plan) {
        result.summary = "Stored proposal plan is invalid; the synthesis batch remains pending.";
        result.errors.push(result.summary);
        recordBatchError(projectId, current.batch.id, ownerToken, "PROPOSAL_PLAN_INVALID", result.summary);
        logFailure(projectId, sessionId, synthesisEventId, result, synthModel, synthEndpoint, synthProvider);
        return result;
      }
      if (!plan) {
        plan = await generateProposalPlan(projectId, current.observations, opts);
        if (!plan || plan.unavailable) {
          result.summary = "LLM proposal synthesis is unavailable; the synthesis batch remains pending.";
          result.errors.push(result.summary);
          recordBatchError(projectId, current.batch.id, ownerToken, "PROPOSAL_LLM_UNAVAILABLE", result.summary);
          logFailure(projectId, sessionId, synthesisEventId, result, synthModel, synthEndpoint, synthProvider);
          return result;
        }
        const serializedPlan = JSON.stringify(plan);
        if (Buffer.byteLength(serializedPlan, "utf8") > MAX_PROPOSAL_PLAN_BYTES) {
          result.summary = "LLM proposal plan exceeded the durable batch limit; the synthesis batch remains pending.";
          result.errors.push(result.summary);
          recordBatchError(projectId, current.batch.id, ownerToken, "PROPOSAL_PLAN_TOO_LARGE", result.summary);
          logFailure(projectId, sessionId, synthesisEventId, result, synthModel, synthEndpoint, synthProvider);
          return result;
        }
        if (!persistProposalPlan(projectId, current.batch.id, ownerToken, serializedPlan)) {
          result.summary = "Synthesis batch lease changed before the proposal plan was persisted.";
          return result;
        }
        current = { ...current, batch: { ...current.batch, proposal_plan: serializedPlan } };
      }
      if (!renewBatchLease(projectId, current.batch.id, ownerToken)) {
        result.summary = "Synthesis batch lease changed before proposals could be applied.";
        return result;
      }
      let applied: ProposalApplication;
      try {
        applied = applyProposalPlan(projectId, current, ownerToken, plan, synthModel);
      } catch (error) {
        if (error instanceof SynthesisBatchOwnershipError) {
          result.summary = "Synthesis batch lease changed while applying proposals.";
          return result;
        }
        logger.warn("synthesis", "Proposal batch application remains resumable", { name: error instanceof Error ? error.name : "unknown" });
        result.summary = "Proposal application failed; the synthesis batch remains pending.";
        result.errors.push(result.summary);
        recordBatchError(
          projectId,
          current.batch.id,
          ownerToken,
          proposalApplicationErrorCode(error),
          result.summary,
        );
        logFailure(projectId, sessionId, synthesisEventId, result, synthModel, synthEndpoint, synthProvider);
        return result;
      }
      result.skills_created += applied.created;
      result.traits_created += applied.traitsCreated;
      result.traits_updated += applied.traitsUpdated;
      const projectName = projects.getProject(projectId)?.name || "unknown";
      for (const proposal of applied.proposals) {
        try {
          logEvent(
            projectId,
            "proposal_created",
            "synthesis",
            `Proposal created (${proposal.type}): ${proposal.name}`,
            "Created from a durable synthesis batch",
            {
              proposal_id: proposal.id,
              skill_name: proposal.name,
              proposal_type: proposal.type,
              batch_id: current.batch.id,
              observation_ids: current.observations.map((observation) => observation.id),
              project_name: projectName,
              via_llm: true,
              model: synthModel,
            },
            synthesisEventId,
            sessionId,
          );
        } catch {
          // Proposal persistence already committed; event delivery is best effort.
        }
      }
      current = { ...current, batch: { ...current.batch, stage: "proposals_applied" } };
      opts?.faultInjector?.("after_proposals_applied");
    }

    if (current.batch.stage === "proposals_applied") {
      opts?.faultInjector?.("before_acknowledgment");
      try {
        result.observations_processed = acknowledgeBatch(projectId, current, ownerToken);
      } catch (error) {
        if (error instanceof SynthesisBatchOwnershipError) {
          result.summary = "Synthesis batch lease changed before acknowledgment.";
          return result;
        }
        const message = error instanceof Error ? error.message : "Synthesis batch acknowledgment failed";
        result.summary = "Synthesis batch acknowledgment failed; observations remain pending.";
        result.errors.push(result.summary);
        recordBatchError(projectId, current.batch.id, ownerToken, "ACKNOWLEDGMENT_FAILED", message);
        logFailure(projectId, sessionId, synthesisEventId, result, synthModel, synthEndpoint, synthProvider);
        return result;
      }
    }

    result.summary = `Processed ${result.observations_processed} observations: ${result.traits_created} traits created, ${result.traits_updated} traits updated.`;
    try {
      logEvent(
        projectId,
        "synthesis_completed",
        "synthesis",
        `Synthesis completed — ${result.observations_processed} processed`,
        result.summary,
        { ...result, batch_id: current.batch.id, model: synthModel, endpoint: synthEndpoint, provider: synthProvider, insights: current.batch.proposal_plan ? parseProposalPlan(current.batch.proposal_plan)?.insights ?? [] : [] },
        synthesisEventId,
        sessionId,
      );
    } catch {
      // Timeline observability must not change durable completion.
    }
    return result;
  } finally {
    releaseBatch(projectId, current.batch.id, ownerToken);
  }
}
