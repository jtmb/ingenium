/**
 * Skill Governance — proposals, lineage, and version history management.
 */
import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { Skill, SkillLineage, SkillProposal, SkillVersion } from "../schema.js";
import { randomUUID } from "node:crypto";
import { createHash } from "node:crypto";
import {
  getSkill, getSkillById, writeSkillToDisk, removeSkillMdOnly,
  isSafeSkillName, isValidSkillFileTree,
} from "./skills.js";

export class GovernanceError extends Error {
  constructor(message: string, public readonly code: string, public readonly statusCode: number = 400) {
    super(message); this.name = "GovernanceError";
  }
}
export function errCode(code: string, msg: string, status: number = 400): GovernanceError {
  return new GovernanceError(msg, code, status);
}

/**
 * Format a stale-proposal review reason.
 * Always retains the machine-determined system cause so it's never silently discarded.
 * An optional reviewer note is appended after a pipe separator when provided.
 */
function formatStaleReason(systemCause: string, reviewerNote?: string): string {
  if (reviewerNote) return `${systemCause} | ${reviewerNote}`;
  return systemCause;
}

// =========================================================================
// Validation helpers
// =========================================================================

function validateJsonArray(_field: string, value: string, label: string): void {
  try { if (!Array.isArray(JSON.parse(value))) throw errCode("INVALID_JSON", `${label} must be a JSON array`, 400); }
  catch (e) { if (e instanceof GovernanceError) throw e; throw errCode("INVALID_JSON", `${label} must be valid JSON`, 400); }
}
function validateStringArray(value: string): void {
  validateJsonArray("merged_file_paths", value, "merged_file_paths");
  for (const item of JSON.parse(value)) { if (typeof item !== "string") throw errCode("INVALID_JSON", "merged_file_paths must be an array of strings", 400); }
}
function validateProposedState(proposedState: string, proposalType: string): Record<string, unknown> {
  let state: Record<string, unknown>;
  try { state = JSON.parse(proposedState); } catch { throw errCode("INVALID_PROPOSED_STATE", "proposed_state must be valid JSON", 400); }
  if (typeof state !== "object" || state === null) throw errCode("INVALID_PROPOSED_STATE", "proposed_state must be a JSON object", 400);
  if (state.content !== undefined && typeof state.content !== "string") throw errCode("INVALID_PROPOSED_STATE", "proposed_state.content must be a string", 400);
  if (state.description !== undefined && typeof state.description !== "string") throw errCode("INVALID_PROPOSED_STATE", "proposed_state.description must be a string", 400);
  if (state.category !== undefined && state.category !== null && typeof state.category !== "string") throw errCode("INVALID_PROPOSED_STATE", "proposed_state.category must be a string or null", 400);
  if (state.tags !== undefined && state.tags !== null && typeof state.tags !== "string") throw errCode("INVALID_PROPOSED_STATE", "proposed_state.tags must be a string or null", 400);
  if (state.always_apply !== undefined && typeof state.always_apply !== "number") throw errCode("INVALID_PROPOSED_STATE", "proposed_state.always_apply must be a number", 400);
  if (state.file_tree !== undefined && state.file_tree !== null) {
    if (typeof state.file_tree !== "string") throw errCode("INVALID_PROPOSED_STATE", "proposed_state.file_tree must be a string or null", 400);
    if (!isValidSkillFileTree(state.file_tree)) throw errCode("INVALID_PROPOSED_STATE", "proposed_state.file_tree must be a JSON string representing a non-array object whose values are all strings", 400);
  }
  // Archive proposals do not require content/description (the skill is being
  // soft-deleted). However, any supplied file_tree or other metadata is still
  // validated against the normal rules (string-only values, etc.).
  if (proposalType !== "archive") {
    if (!state.content || (typeof state.content === "string" && state.content.trim().length === 0)) throw errCode("INVALID_PROPOSED_STATE", "proposed_state.content is required and must not be empty for create/update/merge proposals", 400);
    if (!state.description || (typeof state.description === "string" && state.description.trim().length === 0)) throw errCode("INVALID_PROPOSED_STATE", "proposed_state.description is required and must not be empty for create/update/merge proposals", 400);
  }
  return state;
}
function validateName(name: string, field: string): void {
  if (!isSafeSkillName(name)) {
    throw errCode("INVALID_NAME", `${field} is unsafe: must be 1-64 chars with no path separators, null bytes, or '.'/'..'`, 400);
  }
}
function validateQualityScore(score: number | undefined, label: string): void {
  if (score !== undefined && (score < 0 || score > 1)) throw errCode("INVALID_SCORE", `${label} must be between 0 and 1`, 400);
}

// =========================================================================
// Lineage
// =========================================================================

const MAX_LINEAGE_DEPTH = 100;

function hashSkillContent(content: string): string { return createHash("sha256").update(content).digest("hex"); }

function wouldCreateLineageCycle(db: ReturnType<typeof getDb>, sourceProjectId: string, sourceName: string, targetSkillId: string): boolean {
  const src = db.prepare("SELECT id FROM skills WHERE project_id=? AND name=?").get(sourceProjectId, sourceName) as { id: string } | undefined;
  if (src && src.id === targetSkillId) return true;
  if (!src) return false;
  const visited = new Set([src.id]); const q = [src.id]; let depth = 0;
  while (q.length) {
    if (++depth > MAX_LINEAGE_DEPTH) return true; // Treat exceeding depth as potential cycle — reject
    const cur = q.shift()!;
    for (const a of db.prepare("SELECT source_project_id,source_name FROM skill_lineage WHERE target_skill_id=?").all(cur) as any[]) {
      const as = db.prepare("SELECT id FROM skills WHERE project_id=? AND name=?").get(a.source_project_id, a.source_name) as { id: string } | undefined;
      if (as) { if (as.id === targetSkillId) return true; if (!visited.has(as.id)) { visited.add(as.id); q.push(as.id); } }
    }
  }
  return false;
}

export function createLineage(projectId: string, sourceProjectId: string, sourceName: string, targetSkillId: string, sourceHash?: string, mergedFilePaths?: string[], tombstonePath?: string | null, reason?: string): SkillLineage {
  if (mergedFilePaths !== undefined) validateStringArray(JSON.stringify(mergedFilePaths));
  const result = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    const tgt = db.prepare("SELECT project_id FROM skills WHERE id=?").get(targetSkillId) as { project_id: string } | undefined;
    if (!tgt) throw errCode("TARGET_NOT_FOUND", `Target skill ${targetSkillId} not found`, 404);
    if (tgt.project_id !== projectId) throw errCode("TARGET_OWNERSHIP", `Target skill ${targetSkillId} does not belong to project ${projectId}`, 403);
    if (wouldCreateLineageCycle(db, sourceProjectId, sourceName, targetSkillId)) throw errCode("LINEAGE_CYCLE", `Lineage ${sourceProjectId}/${sourceName}→${targetSkillId} would create a cycle or self-reference`, 409);
    db.prepare("INSERT INTO skill_lineage (project_id,source_project_id,source_name,target_skill_id,source_hash,merged_file_paths,tombstone_path,reason,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,?) ON CONFLICT(project_id,source_project_id,source_name,target_skill_id) DO UPDATE SET source_hash=excluded.source_hash,merged_file_paths=excluded.merged_file_paths,tombstone_path=excluded.tombstone_path,reason=excluded.reason,updated_at=excluded.updated_at")
      .run(projectId, sourceProjectId, sourceName, targetSkillId, sourceHash || "", mergedFilePaths ? JSON.stringify(mergedFilePaths) : "[]", tombstonePath ?? null, reason || "", now, now);
    return db.prepare("SELECT * FROM skill_lineage WHERE project_id=? AND source_project_id=? AND source_name=? AND target_skill_id=?").get(projectId, sourceProjectId, sourceName, targetSkillId) as SkillLineage;
  });
  checkpointAfterWrite(); return result;
}
export function listLineage(projectId: string): SkillLineage[] {
  return (getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data").prepare("SELECT * FROM skill_lineage WHERE project_id=? ORDER BY created_at DESC").all(projectId) as SkillLineage[]);
}
export function listLineageByTarget(targetSkillId: string): SkillLineage[] {
  return (getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data").prepare("SELECT * FROM skill_lineage WHERE target_skill_id=? ORDER BY created_at DESC").all(targetSkillId) as SkillLineage[]);
}
export function resolveLineage(targetSkillId: string, projectId?: string): SkillLineage[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const visited = new Set<string>(); const result: SkillLineage[] = []; const q = [targetSkillId]; let depth = 0;
  while (q.length) {
    if (++depth > MAX_LINEAGE_DEPTH) break; // Guard against unbounded traversal
    const c = q.shift()!; if (visited.has(c)) break; visited.add(c);
    for (const r of (projectId ? db.prepare("SELECT * FROM skill_lineage WHERE project_id=? AND target_skill_id=? ORDER BY created_at DESC").all(projectId, c) : db.prepare("SELECT * FROM skill_lineage WHERE target_skill_id=? ORDER BY created_at DESC").all(c)) as SkillLineage[]) {
      result.push(r); const s = db.prepare("SELECT id FROM skills WHERE project_id=? AND name=?").get(r.source_project_id, r.source_name) as { id: string } | undefined;
      if (s) q.push(s.id);
    }
  }
  return result;
}

// =========================================================================
// Proposals
// =========================================================================

export function createProposal(
  projectId: string, proposalType: "create" | "update" | "merge" | "archive", targetName: string, proposedState: string,
  options?: { sourceProjectId?: string; sourceName?: string; expectedRevision?: number; evidenceJson?: string; observationIds?: string; qualityScore?: number; noveltyScore?: number; contradictionFlag?: number; candidateGroupKey?: string; alwaysApply?: number; targetSkillId?: string; },
): SkillProposal {
  validateName(targetName, "target_name");
  validateProposedState(proposedState, proposalType);
  if (options?.sourceName) validateName(options.sourceName, "source_name");
  if (options?.evidenceJson) validateJsonArray("evidence_json", options.evidenceJson, "evidence_json");
  if (options?.observationIds) validateJsonArray("observation_ids", options.observationIds, "observation_ids");
  validateQualityScore(options?.qualityScore, "quality_score");
  validateQualityScore(options?.noveltyScore, "novelty_score");
  if (options?.expectedRevision !== undefined && options.expectedRevision < 0) throw errCode("INVALID_REVISION", "expected_revision must be >= 0", 400);
  if (options?.contradictionFlag !== undefined && ![0, 1].includes(options.contradictionFlag)) throw errCode("INVALID_FLAG", "contradiction_flag must be 0 or 1", 400);
  if (options?.alwaysApply !== undefined && ![0, 1].includes(options.alwaysApply)) throw errCode("INVALID_FLAG", "always_apply must be 0 or 1", 400);
  if (options?.candidateGroupKey !== undefined && (options.candidateGroupKey.length === 0 || options.candidateGroupKey.length > 256)) throw errCode("INVALID_KEY", "candidate_group_key must be 1-256 chars", 400);

  const result = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    const id = randomUUID();
    let resolvedTargetId: string | null = options?.targetSkillId ?? null;
    let resolvedExpectedRev: number | null = options?.expectedRevision ?? null;
    let resolvedExpectedSrcRev: number | null = null;

    // CREATE: reject if target already exists
    if (proposalType === "create") {
      if (db.prepare("SELECT id FROM skills WHERE project_id=? AND name=?").get(projectId, targetName)) throw errCode("TARGET_EXISTS", `Cannot create proposal: skill "${targetName}" already exists`, 409);
    }

    // UPDATE/ARCHIVE: resolve target, reject archived target
    if (proposalType === "update" || proposalType === "archive") {
      if (!resolvedTargetId) {
        const tgt = db.prepare("SELECT id,revision,archived_at FROM skills WHERE project_id=? AND name=?").get(projectId, targetName) as { id: string; revision: number; archived_at: string | null } | undefined;
        if (!tgt) throw errCode("TARGET_NOT_FOUND", `Target skill "${targetName}" not found`, 404);
        if (tgt.archived_at) throw errCode("TARGET_ARCHIVED", `Target skill "${targetName}" is archived`, 400);
        resolvedTargetId = tgt.id;
        if (resolvedExpectedRev === null) resolvedExpectedRev = tgt.revision;
      } else {
        const tgt = db.prepare("SELECT name,revision,archived_at FROM skills WHERE id=? AND project_id=?").get(resolvedTargetId, projectId) as { name: string; revision: number; archived_at: string | null } | undefined;
        if (!tgt) throw errCode("TARGET_NOT_FOUND", `Target skill ${resolvedTargetId} not found`, 404);
        if (tgt.archived_at) throw errCode("TARGET_ARCHIVED", `Target skill ${resolvedTargetId} is archived`, 400);
        if (tgt.name !== targetName) throw errCode("NAME_MISMATCH", `target_name "${targetName}" != skill name "${tgt.name}"`, 400);
        if (resolvedExpectedRev === null) resolvedExpectedRev = tgt.revision;
      }
    }

    // MERGE: require complete source, source active, capture source revision
    if (proposalType === "merge") {
      if (!options?.sourceProjectId || !options?.sourceName) throw errCode("MISSING_SOURCE", "merge proposal requires source_project_id and source_name", 400);
      const src = db.prepare("SELECT id,revision,archived_at FROM skills WHERE project_id=? AND name=?").get(options.sourceProjectId, options.sourceName) as { id: string; revision: number; archived_at: string | null } | undefined;
      if (!src) throw errCode("SOURCE_NOT_FOUND", `Source skill ${options.sourceProjectId}/${options.sourceName} not found`, 404);
      if (src.archived_at) throw errCode("SOURCE_ARCHIVED", `Source skill ${options.sourceProjectId}/${options.sourceName} is archived`, 400);
      resolvedExpectedSrcRev = src.revision; // capture expected source revision

      if (!resolvedTargetId) {
        const tgt = db.prepare("SELECT id,revision,archived_at FROM skills WHERE project_id=? AND name=?").get(projectId, targetName) as { id: string; revision: number; archived_at: string | null } | undefined;
        if (tgt) {
          if (tgt.archived_at) throw errCode("TARGET_ARCHIVED", `Target skill "${targetName}" is archived`, 400);
          resolvedTargetId = tgt.id;
          if (resolvedExpectedRev === null) resolvedExpectedRev = tgt.revision;
        }
      } else {
        const tgt = db.prepare("SELECT name,revision,archived_at FROM skills WHERE id=? AND project_id=?").get(resolvedTargetId, projectId) as { name: string; revision: number; archived_at: string | null } | undefined;
        if (!tgt) throw errCode("TARGET_NOT_FOUND", `Target skill ${resolvedTargetId} not found`, 404);
        if (tgt.archived_at) throw errCode("TARGET_ARCHIVED", `Target skill ${resolvedTargetId} is archived`, 400);
        if (tgt.name !== targetName) throw errCode("NAME_MISMATCH", `target_name "${targetName}" != skill name "${tgt.name}"`, 400);
        if (resolvedExpectedRev === null) resolvedExpectedRev = tgt.revision;
      }
    }

    // Dedup
    if (options?.candidateGroupKey) {
      if (db.prepare("SELECT id FROM skill_proposals WHERE project_id=? AND candidate_group_key=? AND status IN ('draft','pending') LIMIT 1").get(projectId, options.candidateGroupKey))
        throw errCode("DUPLICATE_PROPOSAL", `A pending proposal already exists for candidate group: ${options.candidateGroupKey}`, 409);
    }

    try {
      db.prepare(
        "INSERT INTO skill_proposals (id,project_id,status,proposal_type,target_skill_id,target_name,source_project_id,source_name,expected_revision,expected_source_revision,target_revision_before,source_revision_before,target_created,proposed_state,evidence_json,observation_ids,quality_score,novelty_score,contradiction_flag,candidate_group_key,always_apply,created_at,updated_at) VALUES (?,?,'draft',?,?,?,?,?,?,?,NULL,NULL,0,?,?,?,?,?,?,?,?,?,?)"
      ).run(id, projectId, proposalType, resolvedTargetId, targetName, options?.sourceProjectId ?? null, options?.sourceName ?? null, resolvedExpectedRev, resolvedExpectedSrcRev,
        proposedState, options?.evidenceJson ?? "[]", options?.observationIds ?? "[]", options?.qualityScore ?? 0, options?.noveltyScore ?? 0, options?.contradictionFlag ?? 0,
        options?.candidateGroupKey ?? null, options?.alwaysApply ?? 0, now, now);
    } catch (e: any) {
      // Item 6: Catch race-time unique candidate constraint, map to GovernanceError
      if (e.message && e.message.includes("SQLITE_CONSTRAINT") && e.message.includes("idx_skill_proposals_candidate_uniq")) {
        throw errCode("DUPLICATE_PROPOSAL", `Concurrent proposal insertion detected for candidate group: ${options?.candidateGroupKey}`, 409);
      }
      throw e;
    }

    return db.prepare("SELECT * FROM skill_proposals WHERE id=?").get(id) as SkillProposal;
  });
  checkpointAfterWrite(); return result;
}

export function listProposals(projectId: string, status?: string): SkillProposal[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return status ? db.prepare("SELECT * FROM skill_proposals WHERE project_id=? AND status=? ORDER BY created_at DESC").all(projectId, status) as SkillProposal[]
    : db.prepare("SELECT * FROM skill_proposals WHERE project_id=? ORDER BY created_at DESC").all(projectId) as SkillProposal[];
}
export function getProposal(projectId: string, proposalId: string): SkillProposal | undefined {
  return (getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data").prepare("SELECT * FROM skill_proposals WHERE id=? AND project_id=?").get(proposalId, projectId) as SkillProposal | undefined);
}
export function submitProposal(projectId: string, proposalId: string): SkillProposal | undefined {
  const result = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const p = db.prepare("SELECT * FROM skill_proposals WHERE id=? AND project_id=?").get(proposalId, projectId) as SkillProposal | undefined;
    if (!p) throw errCode("PROPOSAL_NOT_FOUND", `Proposal ${proposalId} not found`, 404);
    if (p.status !== "draft") throw errCode("INVALID_STATUS_TRANSITION", `Cannot submit proposal in status "${p.status}"`, 409);
    db.prepare("UPDATE skill_proposals SET status='pending',updated_at=? WHERE id=?").run(new Date().toISOString(), proposalId);
    return db.prepare("SELECT * FROM skill_proposals WHERE id=?").get(proposalId) as SkillProposal | undefined;
  });
  checkpointAfterWrite(); return result;
}

// =========================================================================
// Post-commit action collection for disk reconciliation (Item 2)
// =========================================================================
type DiskAction =
  | { type: "write"; skillId: string }
  | { type: "removeMd"; name: string; projectId: string };

export function approveProposal(projectId: string, proposalId: string, reviewer: string, reviewReason?: string): SkillProposal {
  const diskActions: DiskAction[] = [];
  let isStale = false;

  const result = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    const proposal = db.prepare("SELECT * FROM skill_proposals WHERE id=? AND project_id=?").get(proposalId, projectId) as SkillProposal | undefined;
    if (!proposal) throw errCode("PROPOSAL_NOT_FOUND", `Proposal ${proposalId} not found`, 404);
    if (proposal.status !== "pending") throw errCode("INVALID_STATUS_TRANSITION", `Cannot approve proposal in status "${proposal.status}"`, 409);

    // --- Stale checks (Item 1) ---

    // CREATE: if target name appeared after draft creation → stale
    if (proposal.proposal_type === "create") {
      const existing = db.prepare("SELECT id FROM skills WHERE project_id=? AND name=?").get(projectId, proposal.target_name) as { id: string } | undefined;
      if (existing) {
        const systemCause = `Target name "${proposal.target_name}" already exists (appeared after draft)`;
        db.prepare("UPDATE skill_proposals SET status='stale',reviewer=?,review_reason=?,reviewed_at=?,updated_at=? WHERE id=?").run(reviewer, formatStaleReason(systemCause, reviewReason), now, now, proposalId);
        isStale = true; return db.prepare("SELECT * FROM skill_proposals WHERE id=?").get(proposalId) as SkillProposal;
      }
    }

    // Target revision stale check (update/archive/merge with target)
    if (proposal.expected_revision != null && proposal.target_skill_id) {
      const tgt = db.prepare("SELECT id,revision,archived_at,name FROM skills WHERE id=? AND project_id=?").get(proposal.target_skill_id, projectId) as { id: string; revision: number; archived_at: string | null; name: string } | undefined;
      if (!tgt) {
        db.prepare("UPDATE skill_proposals SET status='stale',reviewer=?,review_reason=?,reviewed_at=?,updated_at=? WHERE id=?").run(reviewer, formatStaleReason("Target skill no longer exists", reviewReason), now, now, proposalId);
        isStale = true; return db.prepare("SELECT * FROM skill_proposals WHERE id=?").get(proposalId) as SkillProposal;
      }
      if (tgt.archived_at) {
        db.prepare("UPDATE skill_proposals SET status='stale',reviewer=?,review_reason=?,reviewed_at=?,updated_at=? WHERE id=?").run(reviewer, formatStaleReason("Target skill is archived", reviewReason), now, now, proposalId);
        isStale = true; return db.prepare("SELECT * FROM skill_proposals WHERE id=?").get(proposalId) as SkillProposal;
      }
      if (tgt.revision !== proposal.expected_revision) {
        const systemCause = `Revision conflict: expected ${proposal.expected_revision}, actual ${tgt.revision}`;
        db.prepare("UPDATE skill_proposals SET status='stale',reviewer=?,review_reason=?,reviewed_at=?,updated_at=? WHERE id=?").run(reviewer, formatStaleReason(systemCause, reviewReason), now, now, proposalId);
        isStale = true; return db.prepare("SELECT * FROM skill_proposals WHERE id=?").get(proposalId) as SkillProposal;
      }
    }

    // Source stale check for merge
    if (proposal.proposal_type === "merge" && proposal.expected_source_revision != null && proposal.source_project_id && proposal.source_name) {
      const src = db.prepare("SELECT id,revision,archived_at,name FROM skills WHERE project_id=? AND name=?").get(proposal.source_project_id, proposal.source_name) as { id: string; revision: number; archived_at: string | null; name: string } | undefined;
      if (!src) {
        db.prepare("UPDATE skill_proposals SET status='stale',reviewer=?,review_reason=?,reviewed_at=?,updated_at=? WHERE id=?").run(reviewer, formatStaleReason("Source skill no longer exists", reviewReason), now, now, proposalId);
        isStale = true; return db.prepare("SELECT * FROM skill_proposals WHERE id=?").get(proposalId) as SkillProposal;
      }
      if (src.archived_at) {
        db.prepare("UPDATE skill_proposals SET status='stale',reviewer=?,review_reason=?,reviewed_at=?,updated_at=? WHERE id=?").run(reviewer, formatStaleReason("Source skill is archived", reviewReason), now, now, proposalId);
        isStale = true; return db.prepare("SELECT * FROM skill_proposals WHERE id=?").get(proposalId) as SkillProposal;
      }
      if (src.revision !== proposal.expected_source_revision) {
        const systemCause = `Source revision conflict: expected ${proposal.expected_source_revision}, actual ${src.revision}`;
        db.prepare("UPDATE skill_proposals SET status='stale',reviewer=?,review_reason=?,reviewed_at=?,updated_at=? WHERE id=?").run(reviewer, formatStaleReason(systemCause, reviewReason), now, now, proposalId);
        isStale = true; return db.prepare("SELECT * FROM skill_proposals WHERE id=?").get(proposalId) as SkillProposal;
      }
    }

    // Capture pre-apply state
    let targetRevBefore: number | null = null, sourceRevBefore: number | null = null, targetCreated = 0;

    if (proposal.target_skill_id) {
      const t = db.prepare("SELECT revision FROM skills WHERE id=?").get(proposal.target_skill_id) as { revision: number } | undefined;
      if (t) targetRevBefore = t.revision;
    }
    if (proposal.source_name && proposal.source_project_id) {
      const s = db.prepare("SELECT revision FROM skills WHERE project_id=? AND name=?").get(proposal.source_project_id, proposal.source_name) as { revision: number } | undefined;
      if (s) sourceRevBefore = s.revision;
    }

    const state = JSON.parse(proposal.proposed_state);

    switch (proposal.proposal_type) {
      case "create": {
        const created = createSkillWithinTransaction(projectId, proposal.target_name, state.description as string, state.content as string, state.category as string | undefined, state.tags as string | undefined, state.always_apply as number | undefined, state.file_tree as string | undefined);
        targetCreated = 1;
        diskActions.push({ type: "write", skillId: created.id });
        db.prepare("UPDATE skill_proposals SET target_skill_id=? WHERE id=?").run(created.id, proposalId);
        break;
      }
      case "update": {
        if (!proposal.target_skill_id) throw errCode("MISSING_TARGET", "update requires target_skill_id", 400);
        updateSkillWithinTransaction(projectId, proposal.target_name, state.content as string, state.description as string | undefined, state.tags as string | undefined, state.always_apply as number | undefined, state.file_tree as string | undefined, state.category as string | undefined);
        diskActions.push({ type: "write", skillId: proposal.target_skill_id });
        break;
      }
      case "archive": {
        if (!proposal.target_skill_id) throw errCode("MISSING_TARGET", "archive requires target_skill_id", 400);
        archiveSkillWithinTransaction(projectId, proposal.target_name);
        diskActions.push({ type: "removeMd", name: proposal.target_name, projectId });
        break;
      }
      case "merge": {
        if (!proposal.source_name || !proposal.source_project_id) throw errCode("MISSING_SOURCE", "merge requires source", 400);
        const targetSkill = proposal.target_skill_id ? getSkillById(proposal.target_skill_id) : getSkill(projectId, proposal.target_name);
        const sourceSkill = getSkill(proposal.source_project_id, proposal.source_name);
        const sourceContent = sourceSkill?.content || "";

        if (targetSkill) {
          updateSkillWithinTransaction(projectId, targetSkill.name, state.content as string, state.description as string | undefined, state.tags as string | undefined, state.always_apply as number | undefined, state.file_tree as string | undefined);
          diskActions.push({ type: "write", skillId: targetSkill.id });
        } else {
          const created = createSkillWithinTransaction(projectId, proposal.target_name, state.description as string, state.content as string, state.category as string | undefined, state.tags as string | undefined, state.always_apply as number | undefined, state.file_tree as string | undefined);
          targetCreated = 1;
          diskActions.push({ type: "write", skillId: created.id });
          db.prepare("UPDATE skill_proposals SET target_skill_id=? WHERE id=?").run(created.id, proposalId);
        }

        if (sourceSkill) {
          archiveSkillWithinTransaction(proposal.source_project_id, proposal.source_name);
          diskActions.push({ type: "removeMd", name: proposal.source_name, projectId: proposal.source_project_id });
          const updatedTarget = getSkill(projectId, proposal.target_name);
          if (updatedTarget) {
            db.prepare("INSERT INTO skill_lineage (project_id,source_project_id,source_name,target_skill_id,source_hash,merged_file_paths,reason,created_at,updated_at) VALUES (?,?,?,?,?,'[]',?,?,?) ON CONFLICT(project_id,source_project_id,source_name,target_skill_id) DO UPDATE SET source_hash=excluded.source_hash,reason=excluded.reason,updated_at=excluded.updated_at")
              .run(projectId, proposal.source_project_id, proposal.source_name, updatedTarget.id, hashSkillContent(sourceContent), `Merge proposal ${proposalId} applied`, now, now);
          }
        }
        break;
      }
    }

    db.prepare("UPDATE skill_proposals SET target_revision_before=?,source_revision_before=?,target_created=? WHERE id=?").run(targetRevBefore, sourceRevBefore, targetCreated, proposalId);
    db.prepare("UPDATE skill_proposals SET status='applied',reviewer=?,review_reason=?,reviewed_at=?,applied_at=?,updated_at=? WHERE id=?").run(reviewer, reviewReason ?? null, now, now, now, proposalId);
    return db.prepare("SELECT * FROM skill_proposals WHERE id=?").get(proposalId) as SkillProposal;
  });
  checkpointAfterWrite();

  if (isStale) return result;

  // Execute collected disk actions
  for (const action of diskActions) {
    if (action.type === "write") {
      const skill = getSkillById(action.skillId);
      if (skill && !skill.archived_at) writeSkillToDisk(skill);
    } else if (action.type === "removeMd") {
      removeSkillMdOnly(action.name, action.projectId);
    }
  }

  return result;
}

export function rejectProposal(projectId: string, proposalId: string, reviewer: string, reviewReason?: string): SkillProposal {
  const result = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    const p = db.prepare("SELECT * FROM skill_proposals WHERE id=? AND project_id=?").get(proposalId, projectId) as SkillProposal | undefined;
    if (!p) throw errCode("PROPOSAL_NOT_FOUND", `Proposal ${proposalId} not found`, 404);
    if (p.status !== "pending") throw errCode("INVALID_STATUS_TRANSITION", `Cannot reject in status "${p.status}"`, 409);
    db.prepare("UPDATE skill_proposals SET status='rejected',reviewer=?,review_reason=?,reviewed_at=?,updated_at=? WHERE id=?").run(reviewer, reviewReason ?? null, now, now, proposalId);
    return db.prepare("SELECT * FROM skill_proposals WHERE id=?").get(proposalId) as SkillProposal;
  });
  checkpointAfterWrite(); return result;
}

// =========================================================================
// Rollback with post-commit action collection (Item 2)
// =========================================================================

/** Validate a loaded SkillVersion name before applying it in a rollback UPDATE. */
function validateVersionName(version: SkillVersion, context: string): void {
  if (!isSafeSkillName(version.name)) {
    throw errCode("INVALID_NAME", `Rollback ${context}: version has unsafe name "${version.name}"`, 400);
  }
}

export function rollbackProposal(projectId: string, proposalId: string, reviewer: string, reviewReason?: string): SkillProposal {
  const diskActions: DiskAction[] = [];

  const result = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    const proposal = db.prepare("SELECT * FROM skill_proposals WHERE id=? AND project_id=?").get(proposalId, projectId) as SkillProposal | undefined;
    if (!proposal) throw errCode("PROPOSAL_NOT_FOUND", `Proposal ${proposalId} not found`, 404);
    if (proposal.status !== "applied") throw errCode("INVALID_STATUS_TRANSITION", `Cannot rollback in status "${proposal.status}"`, 409);

    // --- ALL pre-checks before any mutation ---
    switch (proposal.proposal_type) {
      case "create": {
        if (!proposal.target_created) throw errCode("ROLLBACK_REFUSED", "create: missing target_created", 500);
        const s = getSkill(projectId, proposal.target_name);
        if (!s) throw errCode("ROLLBACK_REFUSED", `create: skill "${proposal.target_name}" no longer exists`, 500);
        diskActions.push({ type: "removeMd", name: proposal.target_name, projectId });
        break;
      }
      case "update": {
        if (proposal.target_revision_before == null || !proposal.target_skill_id) throw errCode("ROLLBACK_REFUSED", "update: missing target_revision_before or target_skill_id", 500);
        if (!db.prepare("SELECT id FROM skills WHERE id=?").get(proposal.target_skill_id)) throw errCode("ROLLBACK_REFUSED", `update: target ${proposal.target_skill_id} no longer exists`, 500);
        if (!db.prepare("SELECT * FROM skill_versions WHERE skill_id=? AND revision=?").get(proposal.target_skill_id, proposal.target_revision_before)) throw errCode("ROLLBACK_REFUSED", `update: target version ${proposal.target_revision_before} missing`, 500);
        break;
      }
      case "merge": {
        if (!proposal.source_project_id || !proposal.source_name) throw errCode("ROLLBACK_REFUSED", "merge: missing source identity", 500);
        if (proposal.source_revision_before == null) throw errCode("ROLLBACK_REFUSED", "merge: missing source_revision_before", 500);
        const src = db.prepare("SELECT id,revision FROM skills WHERE project_id=? AND name=?").get(proposal.source_project_id, proposal.source_name) as { id: string; revision: number } | undefined;
        if (!src) throw errCode("ROLLBACK_REFUSED", `merge: source "${proposal.source_name}" no longer exists`, 500);
        if (!db.prepare("SELECT * FROM skill_versions WHERE skill_id=? AND revision=?").get(src.id, proposal.source_revision_before)) throw errCode("ROLLBACK_REFUSED", `merge: source version ${proposal.source_revision_before} missing`, 500);

        if (proposal.target_created) {
          const ct = getSkill(projectId, proposal.target_name);
          if (!ct) throw errCode("ROLLBACK_REFUSED", `merge: created target "${proposal.target_name}" no longer exists`, 500);
          diskActions.push({ type: "removeMd", name: proposal.target_name, projectId });
        } else {
          if (proposal.target_revision_before == null || !proposal.target_skill_id) throw errCode("ROLLBACK_REFUSED", "merge: missing target_revision_before", 500);
          if (!db.prepare("SELECT id FROM skills WHERE id=?").get(proposal.target_skill_id)) throw errCode("ROLLBACK_REFUSED", `merge: target ${proposal.target_skill_id} no longer exists`, 500);
          if (!db.prepare("SELECT * FROM skill_versions WHERE skill_id=? AND revision=?").get(proposal.target_skill_id, proposal.target_revision_before)) throw errCode("ROLLBACK_REFUSED", `merge: target version ${proposal.target_revision_before} missing`, 500);
        }
        break;
      }
      case "archive": {
        if (proposal.target_revision_before == null || !proposal.target_skill_id) throw errCode("ROLLBACK_REFUSED", "archive: missing target_revision_before or target_skill_id", 500);
        if (!db.prepare("SELECT id FROM skills WHERE id=?").get(proposal.target_skill_id)) throw errCode("ROLLBACK_REFUSED", `archive: target ${proposal.target_skill_id} no longer exists`, 500);
        if (!db.prepare("SELECT * FROM skill_versions WHERE skill_id=? AND revision=?").get(proposal.target_skill_id, proposal.target_revision_before)) throw errCode("ROLLBACK_REFUSED", `archive: target version ${proposal.target_revision_before} missing`, 500);
        break;
      }
    }

    // --- Perform mutations ---
    switch (proposal.proposal_type) {
      case "create": {
        archiveSkillWithinTransaction(projectId, proposal.target_name);
        break;
      }
      case "update": {
        const ver = db.prepare("SELECT * FROM skill_versions WHERE skill_id=? AND revision=?").get(proposal.target_skill_id!, proposal.target_revision_before!) as SkillVersion;
        validateVersionName(ver, "update");
        const cur = db.prepare("SELECT revision FROM skills WHERE id=?").get(proposal.target_skill_id) as { revision: number };
        db.prepare("UPDATE skills SET name=?,description=?,content=?,category=?,tags=?,always_apply=?,file_tree=?,enabled=?,archived_at=?,revision=?,updated_at=? WHERE id=?")
          .run(ver.name, ver.description, ver.content, ver.category, ver.tags, ver.always_apply, ver.file_tree, ver.enabled, ver.archived_at, cur.revision + 1, now, proposal.target_skill_id);
        diskActions.push({ type: "write", skillId: proposal.target_skill_id! });
        break;
      }
      case "merge": {
        // Restore source
        const src = db.prepare("SELECT id,revision FROM skills WHERE project_id=? AND name=?").get(proposal.source_project_id!, proposal.source_name!) as { id: string; revision: number };
        const sv = db.prepare("SELECT * FROM skill_versions WHERE skill_id=? AND revision=?").get(src.id, proposal.source_revision_before!) as SkillVersion;
        validateVersionName(sv, "merge source");
        db.prepare("UPDATE skills SET name=?,description=?,content=?,category=?,tags=?,always_apply=?,file_tree=?,enabled=?,archived_at=?,revision=?,updated_at=? WHERE id=?")
          .run(sv.name, sv.description, sv.content, sv.category, sv.tags, sv.always_apply, sv.file_tree, sv.enabled, sv.archived_at, src.revision + 1, now, src.id);
        diskActions.push({ type: "write", skillId: src.id });

        // Handle target
        if (proposal.target_created) {
          archiveSkillWithinTransaction(projectId, proposal.target_name!);
        } else {
          const tv = db.prepare("SELECT * FROM skill_versions WHERE skill_id=? AND revision=?").get(proposal.target_skill_id!, proposal.target_revision_before!) as SkillVersion;
          validateVersionName(tv, "merge target");
          const tc = db.prepare("SELECT revision FROM skills WHERE id=?").get(proposal.target_skill_id) as { revision: number };
          db.prepare("UPDATE skills SET name=?,description=?,content=?,category=?,tags=?,always_apply=?,file_tree=?,enabled=?,archived_at=?,revision=?,updated_at=? WHERE id=?")
            .run(tv.name, tv.description, tv.content, tv.category, tv.tags, tv.always_apply, tv.file_tree, tv.enabled, tv.archived_at, tc.revision + 1, now, proposal.target_skill_id);
          diskActions.push({ type: "write", skillId: proposal.target_skill_id! });
        }
        break;
      }
      case "archive": {
        const ver = db.prepare("SELECT * FROM skill_versions WHERE skill_id=? AND revision=?").get(proposal.target_skill_id!, proposal.target_revision_before!) as SkillVersion;
        validateVersionName(ver, "archive");
        const cur = db.prepare("SELECT revision FROM skills WHERE id=?").get(proposal.target_skill_id) as { revision: number };
        db.prepare("UPDATE skills SET name=?,description=?,content=?,category=?,tags=?,always_apply=?,file_tree=?,enabled=?,archived_at=?,revision=?,updated_at=? WHERE id=?")
          .run(ver.name, ver.description, ver.content, ver.category, ver.tags, ver.always_apply, ver.file_tree, ver.enabled, ver.archived_at, cur.revision + 1, now, proposal.target_skill_id);
        diskActions.push({ type: "write", skillId: proposal.target_skill_id! });
        break;
      }
    }

    db.prepare("UPDATE skill_proposals SET status='rolled_back',reviewer=?,review_reason=?,reviewed_at=COALESCE(reviewed_at,?),rolled_back_at=?,updated_at=? WHERE id=?")
      .run(reviewer, reviewReason ?? null, now, now, now, proposalId);
    return db.prepare("SELECT * FROM skill_proposals WHERE id=?").get(proposalId) as SkillProposal;
  });
  checkpointAfterWrite();

  // Execute collected disk actions
  for (const action of diskActions) {
    if (action.type === "write") {
      const skill = getSkillById(action.skillId);
      if (skill) {
        if (skill.archived_at) removeSkillMdOnly(skill.name, skill.project_id);
        else writeSkillToDisk(skill);
      }
    } else if (action.type === "removeMd") {
      removeSkillMdOnly(action.name, action.projectId);
    }
  }

  return result;
}

// =========================================================================
// Internal helpers — no content fabrication (Item 7)
// =========================================================================

function createSkillWithinTransaction(projectId: string, name: string, description: string, content: string, category?: string, tags?: string, alwaysApply?: number, fileTree?: string): Skill {
  if (!isSafeSkillName(name)) throw errCode("INVALID_NAME", `Unsafe target name "${name}"`, 400);
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const now = new Date().toISOString();
  const id = randomUUID();
  // Never fabricate defaults — use exactly what was provided from proposed_state
  db.prepare("INSERT INTO skills (id,project_id,name,description,content,category,tags,always_apply,file_tree,revision,created_at,updated_at) VALUES (?,?,?,?,?,?,?,?,?,0,?,?)")
    .run(id, projectId, name, description, content, category ?? null, tags ?? null, alwaysApply ?? 0, fileTree ?? null, now, now);
  return getSkillById(id)!;
}

function updateSkillWithinTransaction(projectId: string, name: string, content: string, description?: string, tags?: string, alwaysApply?: number, fileTree?: string, category?: string): Skill {
  if (!isSafeSkillName(name)) throw errCode("INVALID_NAME", `Unsafe target name "${name}"`, 400);
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const now = new Date().toISOString();
  const cur = db.prepare("SELECT revision FROM skills WHERE project_id=? AND name=?").get(projectId, name) as { revision: number } | undefined;
  if (!cur) throw errCode("SKILL_NOT_FOUND", `Skill ${projectId}/${name} not found`, 404);
  db.prepare("UPDATE skills SET content=?,description=COALESCE(?,description),category=COALESCE(?,category),tags=COALESCE(?,tags),always_apply=COALESCE(?,always_apply),file_tree=COALESCE(?,file_tree),revision=?,updated_at=? WHERE project_id=? AND name=?")
    .run(content, description ?? null, category ?? null, tags ?? null, alwaysApply ?? null, fileTree ?? null, cur.revision + 1, now, projectId, name);
  return getSkill(projectId, name)!;
}

function archiveSkillWithinTransaction(projectId: string, name: string): Skill {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const now = new Date().toISOString();
  const cur = db.prepare("SELECT revision FROM skills WHERE project_id=? AND name=?").get(projectId, name) as { revision: number } | undefined;
  if (!cur) throw errCode("SKILL_NOT_FOUND", `Skill ${projectId}/${name} not found`, 404);
  db.prepare("UPDATE skills SET archived_at=?,revision=?,updated_at=? WHERE project_id=? AND name=?").run(now, cur.revision + 1, now, projectId, name);
  return getSkill(projectId, name)!;
}
