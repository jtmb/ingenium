/**
 * Skill Governance — proposals, lineage, and version history management.
 */
import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import {
  SKILL_PROPOSAL_PAGE_CURSOR_VERSION,
  SKILL_PROPOSAL_RETENTION_INDEX,
} from "../schema.js";
import type {
  Skill,
  SkillLineage,
  SkillProposal,
  SkillProposalCounts,
  SkillProposalPage,
  SkillProposalPageCursor,
  SkillProposalPageView,
  SkillProposalSummary,
  SkillVersion,
} from "../schema.js";
import { Buffer } from "node:buffer";
import { createHash, randomUUID } from "node:crypto";
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

export const MAX_PROPOSAL_EVIDENCE_ITEMS = 64;
export const MAX_PROPOSAL_OBSERVATION_IDS = 128;
export const MAX_PROPOSAL_JSON_DEPTH = 16;
export const MAX_PROPOSAL_JSON_NODES = 4_096;
export const MAX_PROPOSAL_SERIALIZED_BYTES = 128 * 1024;
export const MAX_PROPOSAL_REQUEST_BYTES = 192 * 1024;
export const MAX_PROPOSAL_MERGED_REFERENCES = 128;
export const MAX_RECONCILIATION_OPEN_PROPOSALS = 500;
export const MAX_RECONCILIATION_RAW_BYTES = 8 * 1024 * 1024;
export const MAX_RECONCILIATION_WORK_UNITS = 400;
export const MAX_SKILL_PROPOSAL_SUMMARY_TEXT_CHARACTERS = 64;
export const MAX_SKILL_PROPOSAL_SUMMARY_TEXT_BYTES = MAX_SKILL_PROPOSAL_SUMMARY_TEXT_CHARACTERS * 4;

function byteLength(value: string): number {
  return Buffer.byteLength(value, "utf8");
}

function parseBoundedJson(raw: string, label: string, code = "INVALID_JSON"): unknown {
  if (typeof raw !== "string") throw errCode(code, `${label} must be valid JSON`, 400);
  if (byteLength(raw) > MAX_PROPOSAL_SERIALIZED_BYTES) {
    throw errCode(code, `${label} exceeds the ${MAX_PROPOSAL_SERIALIZED_BYTES}-byte limit`, 400);
  }

  let depth = 0;
  let inString = false;
  let escaped = false;
  for (const character of raw) {
    if (inString) {
      if (escaped) escaped = false;
      else if (character === "\\") escaped = true;
      else if (character === '"') inString = false;
      continue;
    }
    if (character === '"') {
      inString = true;
    } else if (character === "{" || character === "[") {
      depth++;
      if (depth > MAX_PROPOSAL_JSON_DEPTH) {
        throw errCode(code, `${label} exceeds the JSON depth limit`, 400);
      }
    } else if (character === "}" || character === "]") {
      depth--;
    }
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw errCode(code, `${label} must be valid JSON`, 400);
  }

  let nodes = 0;
  const stack: Array<{ value: unknown; depth: number }> = [{ value: parsed, depth: 0 }];
  while (stack.length > 0) {
    const entry = stack.pop()!;
    if (++nodes > MAX_PROPOSAL_JSON_NODES) {
      throw errCode(code, `${label} exceeds the JSON node limit`, 400);
    }
    if (entry.depth > MAX_PROPOSAL_JSON_DEPTH) {
      throw errCode(code, `${label} exceeds the JSON depth limit`, 400);
    }
    if (Array.isArray(entry.value)) {
      for (const item of entry.value) stack.push({ value: item, depth: entry.depth + 1 });
    } else if (typeof entry.value === "object" && entry.value !== null) {
      for (const item of Object.values(entry.value)) stack.push({ value: item, depth: entry.depth + 1 });
    }
  }
  return parsed;
}

function validateStringArray(value: string): void {
  const parsed = parseBoundedJson(value, "merged_file_paths");
  if (!Array.isArray(parsed) || parsed.some((item) => typeof item !== "string")) {
    throw errCode("INVALID_JSON", "merged_file_paths must be an array of strings", 400);
  }
}

function validateFileTreeState(value: unknown, field: "file_tree" | "file_tree_patch"): void {
  if (typeof value !== "string") {
    throw errCode("INVALID_PROPOSED_STATE", `proposed_state.${field} must be a JSON string`, 400);
  }
  parseBoundedJson(value, `proposed_state.${field}`, "INVALID_PROPOSED_STATE");
  if (!isValidSkillFileTree(value)) {
    throw errCode("INVALID_PROPOSED_STATE", `proposed_state.${field} must be a JSON string representing a non-array object whose values are all strings`, 400);
  }
}

function validateProposedState(proposedState: string, proposalType: string): Record<string, unknown> {
  const parsed = parseBoundedJson(proposedState, "proposed_state", "INVALID_PROPOSED_STATE");
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    throw errCode("INVALID_PROPOSED_STATE", "proposed_state must be a JSON object", 400);
  }
  const state = parsed as Record<string, unknown>;
  if (state.content !== undefined && typeof state.content !== "string") throw errCode("INVALID_PROPOSED_STATE", "proposed_state.content must be a string", 400);
  if (state.description !== undefined && typeof state.description !== "string") throw errCode("INVALID_PROPOSED_STATE", "proposed_state.description must be a string", 400);
  if (state.category !== undefined && state.category !== null && typeof state.category !== "string") throw errCode("INVALID_PROPOSED_STATE", "proposed_state.category must be a string or null", 400);
  if (state.tags !== undefined && state.tags !== null && typeof state.tags !== "string") throw errCode("INVALID_PROPOSED_STATE", "proposed_state.tags must be a string or null", 400);
  if (state.always_apply !== undefined && typeof state.always_apply !== "number") throw errCode("INVALID_PROPOSED_STATE", "proposed_state.always_apply must be a number", 400);
  if (state.file_tree !== undefined && state.file_tree !== null) {
    validateFileTreeState(state.file_tree, "file_tree");
  }
  if (state.file_tree_patch !== undefined) {
    if (proposalType !== "update" || state.file_tree !== undefined) {
      throw errCode("INVALID_PROPOSED_STATE", "proposed_state.file_tree_patch is only valid for updates without file_tree", 400);
    }
    validateFileTreeState(state.file_tree_patch, "file_tree_patch");
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
  if (!isSafeSkillName(name) || byteLength(name) > MAX_SKILL_PROPOSAL_SUMMARY_TEXT_BYTES) {
    throw errCode("INVALID_NAME", `${field} is unsafe: must be 1-64 chars and at most ${MAX_SKILL_PROPOSAL_SUMMARY_TEXT_BYTES} UTF-8 bytes with no path separators, null bytes, or '.'/'..'`, 400);
  }
}
function validateQualityScore(score: number | undefined, label: string): void {
  if (score !== undefined && (!Number.isFinite(score) || score < 0 || score > 1)) throw errCode("INVALID_SCORE", `${label} must be between 0 and 1`, 400);
}

type ProposalType = SkillProposal["proposal_type"];

export interface ProposalCandidateOptions {
  sourceProjectId?: string;
  sourceName?: string;
  expectedRevision?: number;
  evidenceJson?: string;
  observationIds?: string;
  qualityScore?: number;
  noveltyScore?: number;
  contradictionFlag?: number;
  /** Compatibility-only. Candidate grouping is always derived from proposal identity. */
  candidateGroupKey?: string;
  alwaysApply?: number;
  targetSkillId?: string;
}

export interface ProposalCandidateResult {
  proposal: SkillProposal;
  disposition: "created" | "reused" | "replaced";
}

export interface ProposalCandidateReconciliation {
  groupsProcessed: number;
  keysAssigned: number;
  staleProposals: number;
  evidenceReferencesMerged: number;
  observationReferencesMerged: number;
  truncated: boolean;
  deferredGroups: number;
  deferredCandidates: number;
  rawBytesProcessed: number;
  workUnits: number;
}

const OPEN_PROPOSAL_STATUSES = "('draft','pending')";
const HISTORY_PROPOSAL_STATUSES = "('stale','rejected','applied','rolled_back')";
const SUPERSEDED_CANDIDATE_REASON = "Superseded by a materially newer candidate in the same candidate group";
const MALFORMED_CANDIDATE_REASON = "Superseded because its stored proposal references are invalid";
const RECONCILED_CANDIDATE_REASON = "Superseded during proposal candidate reconciliation";

interface CanonicalizationState {
  nodes: number;
}

function canonicalizeJson(
  value: unknown,
  sortArrays = false,
  depth = 0,
  state: CanonicalizationState = { nodes: 0 },
): unknown {
  if (depth > MAX_PROPOSAL_JSON_DEPTH || ++state.nodes > MAX_PROPOSAL_JSON_NODES) {
    throw errCode("INVALID_JSON", "JSON value exceeds canonicalization limits", 400);
  }
  if (Array.isArray(value)) {
    const entries = value.map((entry) => canonicalizeJson(entry, sortArrays, depth + 1, state));
    if (!sortArrays) return entries;
    return entries.sort((left, right) => {
      const leftJson = JSON.stringify(left) ?? "";
      const rightJson = JSON.stringify(right) ?? "";
      return leftJson.localeCompare(rightJson);
    });
  }
  if (typeof value !== "object" || value === null) return value;
  const record = value as Record<string, unknown>;
  return Object.fromEntries(
    Object.keys(record).sort().map((key) => [key, canonicalizeJson(record[key], sortArrays, depth + 1, state)]),
  );
}

function canonicalJson(value: unknown, sortArrays = false): string {
  const json = JSON.stringify(canonicalizeJson(value, sortArrays));
  if (json === undefined) throw errCode("INVALID_JSON", "JSON value cannot be serialized", 400);
  return json;
}

function proposalStateFingerprint(proposedState: string): string {
  try {
    const state = parseBoundedJson(proposedState, "proposed_state") as Record<string, unknown>;
    const normalized = { ...state };
    if (typeof normalized.file_tree === "string") {
      try {
        normalized.file_tree = parseBoundedJson(normalized.file_tree, "proposed_state.file_tree");
      } catch {
        return canonicalJson(normalized);
      }
    }
    return canonicalJson(normalized);
  } catch {
    return proposedState;
  }
}

function parseEvidenceReferences(raw: string, maxItems = MAX_PROPOSAL_EVIDENCE_ITEMS): unknown[] {
  const parsed = parseBoundedJson(raw, "evidence_json");
  if (!Array.isArray(parsed)) throw errCode("INVALID_JSON", "evidence_json must be a JSON array", 400);
  if (parsed.length > maxItems) {
    throw errCode("INVALID_JSON", `evidence_json exceeds the ${maxItems}-item limit`, 400);
  }
  return parsed;
}

function parseObservationReferences(raw: string, maxItems = MAX_PROPOSAL_OBSERVATION_IDS): number[] {
  const parsed = parseBoundedJson(raw, "observation_ids", "INVALID_OBSERVATION_IDS");
  if (!Array.isArray(parsed) || parsed.length > maxItems
    || parsed.some((id) => !Number.isSafeInteger(id) || id < 1)) {
    throw errCode("INVALID_OBSERVATION_IDS", `observation_ids must contain at most ${maxItems} positive integer IDs`, 400);
  }
  return parsed as number[];
}

function mergeUniqueJsonReferences(
  existingRaw: string,
  incomingRaw: string,
  kind: "evidence" | "observations",
): { json: string; added: number } {
  const existing = kind === "evidence"
    ? parseEvidenceReferences(existingRaw, MAX_PROPOSAL_MERGED_REFERENCES)
    : parseObservationReferences(existingRaw, MAX_PROPOSAL_MERGED_REFERENCES);
  const incoming = kind === "evidence" ? parseEvidenceReferences(incomingRaw) : parseObservationReferences(incomingRaw);

  const unique = new Map<string, unknown>();
  for (const entry of existing) unique.set(canonicalJson(entry, true), entry);
  if (unique.size > MAX_PROPOSAL_MERGED_REFERENCES) {
    throw errCode("REFERENCE_LIMIT", `Stored ${kind} references exceed the ${MAX_PROPOSAL_MERGED_REFERENCES}-reference limit`, 400);
  }
  let added = 0;
  for (const entry of incoming) {
    const key = canonicalJson(entry, true);
    if (!unique.has(key)) {
      unique.set(key, entry);
      added++;
    }
  }
  if (unique.size > MAX_PROPOSAL_MERGED_REFERENCES) {
    throw errCode("REFERENCE_LIMIT", `Merged ${kind} references exceed the ${MAX_PROPOSAL_MERGED_REFERENCES}-reference limit`, 400);
  }
  if (added === 0) return { json: existingRaw, added };
  const json = JSON.stringify(
    [...unique.entries()]
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([, entry]) => canonicalizeJson(entry, true)),
  );
  if (byteLength(json) > MAX_PROPOSAL_SERIALIZED_BYTES) {
    throw errCode("REFERENCE_LIMIT", `Merged ${kind} references exceed the serialized byte limit`, 400);
  }
  return { json, added };
}

interface ValidatedProposalCandidateInput {
  evidenceJson: string;
  observationIds: string;
  parsedObservationIds: number[];
}

function validateProposalCandidateInput(
  proposedState: string,
  proposalType: ProposalType,
  options: ProposalCandidateOptions,
): ValidatedProposalCandidateInput {
  if (typeof proposedState !== "string") {
    throw errCode("INVALID_PROPOSED_STATE", "proposed_state must be valid JSON", 400);
  }
  const evidenceJson = options.evidenceJson ?? "[]";
  const observationIds = options.observationIds ?? "[]";
  if (typeof evidenceJson !== "string" || typeof observationIds !== "string") {
    throw errCode("INVALID_JSON", "proposal references must be JSON strings", 400);
  }
  if (byteLength(proposedState) + byteLength(evidenceJson) + byteLength(observationIds) > MAX_PROPOSAL_REQUEST_BYTES) {
    throw errCode("INVALID_JSON", `proposal payload exceeds the ${MAX_PROPOSAL_REQUEST_BYTES}-byte limit`, 400);
  }
  validateProposedState(proposedState, proposalType);
  parseEvidenceReferences(evidenceJson);
  return { evidenceJson, observationIds, parsedObservationIds: parseObservationReferences(observationIds) };
}

function assertProjectOwnsObservations(
  db: ReturnType<typeof getDb>,
  projectId: string,
  observationIds: number[],
): void {
  const uniqueIds = [...new Set(observationIds)];
  if (uniqueIds.length === 0) return;
  const placeholders = uniqueIds.map(() => "?").join(",");
  const rows = db.prepare(
    `SELECT id FROM observations WHERE project_id=? AND id IN (${placeholders})`,
  ).all(projectId, ...uniqueIds) as Array<{ id: number }>;
  if (rows.length !== uniqueIds.length) {
    throw errCode("INVALID_OBSERVATION_IDS", "observation_ids must reference observations in the proposal project", 400);
  }
}

export function deriveCandidateGroupKey(
  projectId: string,
  proposalType: ProposalType,
  targetName: string,
  sourceProjectId?: string | null,
  sourceName?: string | null,
): string {
  const identity = canonicalJson({
    projectId,
    proposalType,
    targetName,
    sourceProjectId: sourceProjectId ?? null,
    sourceName: sourceName ?? null,
  });
  return `proposal:v1:${createHash("sha256").update(identity).digest("hex")}`;
}

function findOpenCandidate(
  db: ReturnType<typeof getDb>,
  projectId: string,
  candidateGroupKey: string,
): SkillProposal | undefined {
  return db.prepare(
    `SELECT * FROM skill_proposals
     WHERE project_id=? AND candidate_group_key=? AND status IN ${OPEN_PROPOSAL_STATUSES}
     ORDER BY updated_at DESC, created_at DESC, id DESC LIMIT 1`,
  ).get(projectId, candidateGroupKey) as SkillProposal | undefined;
}

function sameCandidateDecision(
  proposal: SkillProposal,
  proposalType: ProposalType,
  targetName: string,
  proposedState: string,
  options: ProposalCandidateOptions,
  targetSkillId: string | null,
  expectedRevision: number | null,
  expectedSourceRevision: number | null,
): boolean {
  return proposal.proposal_type === proposalType
    && proposal.target_name === targetName
    && (proposal.target_skill_id ?? null) === targetSkillId
    && (proposal.source_project_id ?? null) === (options.sourceProjectId ?? null)
    && (proposal.source_name ?? null) === (options.sourceName ?? null)
    && (proposal.expected_revision ?? null) === expectedRevision
    && (proposal.expected_source_revision ?? null) === expectedSourceRevision
    && proposal.always_apply === (options.alwaysApply ?? 0)
    && proposalStateFingerprint(proposal.proposed_state) === proposalStateFingerprint(proposedState);
}

function mergeEquivalentCandidate(
  db: ReturnType<typeof getDb>,
  projectId: string,
  proposal: SkillProposal,
  evidenceJson: string,
  observationIds: string,
  qualityScore: number,
  noveltyScore: number,
  contradictionFlag: number,
  now: string,
): { proposal: SkillProposal; wrote: boolean } {
  assertProjectOwnsObservations(db, projectId, parseObservationReferences(proposal.observation_ids));
  const mergedEvidence = mergeUniqueJsonReferences(proposal.evidence_json, evidenceJson, "evidence");
  const mergedObservations = mergeUniqueJsonReferences(proposal.observation_ids, observationIds, "observations");
  const nextEvidence = mergedEvidence.json;
  const nextObservations = mergedObservations.json;
  const nextQualityScore = Math.max(proposal.quality_score, qualityScore);
  const nextNoveltyScore = Math.max(proposal.novelty_score, noveltyScore);
  const nextContradictionFlag = Math.max(proposal.contradiction_flag, contradictionFlag);
  const wrote = nextEvidence !== proposal.evidence_json
    || nextObservations !== proposal.observation_ids
    || nextQualityScore !== proposal.quality_score
    || nextNoveltyScore !== proposal.novelty_score
    || nextContradictionFlag !== proposal.contradiction_flag;
  if (!wrote) return { proposal, wrote };

  db.prepare(
    "UPDATE skill_proposals SET evidence_json=?,observation_ids=?,quality_score=?,novelty_score=?,contradiction_flag=?,updated_at=? WHERE id=? AND project_id=?",
  ).run(
    nextEvidence,
    nextObservations,
    nextQualityScore,
    nextNoveltyScore,
    nextContradictionFlag,
    now,
    proposal.id,
    proposal.project_id,
  );
  return {
    proposal: db.prepare("SELECT * FROM skill_proposals WHERE id=?").get(proposal.id) as SkillProposal,
    wrote,
  };
}

function staleOpenCandidate(
  db: ReturnType<typeof getDb>,
  projectId: string,
  proposalId: string,
  reason: string,
  now: string,
): void {
  db.prepare(
    `UPDATE skill_proposals
     SET status='stale',reviewer='system',review_reason=?,reviewed_at=?,updated_at=?
     WHERE id=? AND project_id=? AND status IN ${OPEN_PROPOSAL_STATUSES}`,
  ).run(reason, now, now, proposalId, projectId);
}

function mergeFileTreePatch(currentFileTree: string | null, patch: string): string {
  if (currentFileTree !== null && !isValidSkillFileTree(currentFileTree)) {
    throw errCode("INVALID_PROPOSED_STATE", "target file_tree is invalid", 400);
  }
  const current = currentFileTree === null
    ? {}
    : JSON.parse(currentFileTree) as Record<string, string>;
  const additions = JSON.parse(patch) as Record<string, string>;
  return JSON.stringify({ ...current, ...additions });
}

function isCandidateUniqueConstraint(error: unknown): boolean {
  const message = error instanceof Error ? error.message : String(error);
  const code = typeof error === "object" && error !== null && "code" in error && typeof error.code === "string"
    ? error.code
    : "";
  return (code.startsWith("SQLITE_CONSTRAINT") || message.includes("SQLITE_CONSTRAINT") || message.includes("UNIQUE constraint failed"))
    && (message.includes("idx_skill_proposals_candidate_uniq")
      || message.includes("skill_proposals.project_id, skill_proposals.candidate_group_key"));
}

// =========================================================================
// Lineage
// =========================================================================

// Bound graph traversal to prevent corrupt or adversarial lineage data from causing unbounded work.
const MAX_LINEAGE_DEPTH = 100;

function hashSkillContent(content: string): string { return createHash("sha256").update(content).digest("hex"); }

function wouldCreateLineageCycle(db: ReturnType<typeof getDb>, sourceProjectId: string, sourceName: string, targetSkillId: string): boolean {
  const src = db.prepare("SELECT id FROM skills WHERE project_id=? AND name=?").get(sourceProjectId, sourceName) as { id: string } | undefined;
  if (src && src.id === targetSkillId) return true;
  if (!src) return false;
  const visited = new Set([src.id]); const q = [src.id]; let depth = 0;
  while (q.length) {
    if (++depth > MAX_LINEAGE_DEPTH) return true;
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
export function resolveLineage(targetSkillId: string, projectId?: string): SkillLineage[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const visited = new Set<string>(); const result: SkillLineage[] = []; const q = [targetSkillId]; let depth = 0;
  while (q.length) {
    if (++depth > MAX_LINEAGE_DEPTH) break;
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

export function ensureProposalCandidate(
  projectId: string,
  proposalType: ProposalType,
  targetName: string,
  proposedState: string,
  options: ProposalCandidateOptions = {},
): ProposalCandidateResult {
  validateName(targetName, "target_name");
  const input = validateProposalCandidateInput(proposedState, proposalType, options);
  if (options.sourceName) validateName(options.sourceName, "source_name");
  validateQualityScore(options.qualityScore, "quality_score");
  validateQualityScore(options.noveltyScore, "novelty_score");
  if (options.expectedRevision !== undefined && options.expectedRevision < 0) throw errCode("INVALID_REVISION", "expected_revision must be >= 0", 400);
  if (options.contradictionFlag !== undefined && ![0, 1].includes(options.contradictionFlag)) throw errCode("INVALID_FLAG", "contradiction_flag must be 0 or 1", 400);
  if (options.alwaysApply !== undefined && ![0, 1].includes(options.alwaysApply)) throw errCode("INVALID_FLAG", "always_apply must be 0 or 1", 400);

  const candidateGroupKey = deriveCandidateGroupKey(projectId, proposalType, targetName, options.sourceProjectId, options.sourceName);
  const evidenceJson = input.evidenceJson;
  const observationIds = input.observationIds;
  const qualityScore = options.qualityScore ?? 0;
  const noveltyScore = options.noveltyScore ?? 0;
  const contradictionFlag = options.contradictionFlag ?? 0;
  const alwaysApply = options.alwaysApply ?? 0;

  const outcome = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const now = new Date().toISOString();
    let wrote = false;
    let resolvedTargetId: string | null = options.targetSkillId ?? null;
    let resolvedExpectedRev: number | null = options.expectedRevision ?? null;
    let resolvedExpectedSrcRev: number | null = null;

    assertProjectOwnsObservations(db, projectId, input.parsedObservationIds);

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
      if (!options.sourceProjectId || !options.sourceName) throw errCode("MISSING_SOURCE", "merge proposal requires source_project_id and source_name", 400);
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

    const resolveExistingCandidate = (existing: SkillProposal): ProposalCandidateResult | undefined => {
      if (sameCandidateDecision(
        existing,
        proposalType,
        targetName,
        proposedState,
        options,
        resolvedTargetId,
        resolvedExpectedRev,
        resolvedExpectedSrcRev,
      )) {
        let merged: { proposal: SkillProposal; wrote: boolean };
        try {
          merged = mergeEquivalentCandidate(
            db,
            projectId,
            existing,
            evidenceJson,
            observationIds,
            qualityScore,
            noveltyScore,
            contradictionFlag,
            now,
          );
        } catch (error) {
          if (!(error instanceof GovernanceError) || error.code !== "INVALID_JSON") throw error;
          staleOpenCandidate(db, projectId, existing.id, MALFORMED_CANDIDATE_REASON, now);
          wrote = true;
          return undefined;
        }
        wrote ||= merged.wrote;
        return { proposal: merged.proposal, disposition: "reused" };
      }
      staleOpenCandidate(db, projectId, existing.id, SUPERSEDED_CANDIDATE_REASON, now);
      wrote = true;
      return undefined;
    };

    const existing = findOpenCandidate(db, projectId, candidateGroupKey);
    if (existing) {
      const reused = resolveExistingCandidate(existing);
      if (reused) return { result: reused, wrote };
    }

    const insertCandidate = (): SkillProposal => {
      const id = randomUUID();
      db.prepare(
        "INSERT INTO skill_proposals (id,project_id,status,proposal_type,target_skill_id,target_name,source_project_id,source_name,expected_revision,expected_source_revision,target_revision_before,source_revision_before,target_created,proposed_state,evidence_json,observation_ids,quality_score,novelty_score,contradiction_flag,candidate_group_key,always_apply,created_at,updated_at) VALUES (?,?,'draft',?,?,?,?,?,?,?,NULL,NULL,0,?,?,?,?,?,?,?,?,?,?)",
      ).run(
        id,
        projectId,
        proposalType,
        resolvedTargetId,
        targetName,
        options.sourceProjectId ?? null,
        options.sourceName ?? null,
        resolvedExpectedRev,
        resolvedExpectedSrcRev,
        proposedState,
        evidenceJson,
        observationIds,
        qualityScore,
        noveltyScore,
        contradictionFlag,
        candidateGroupKey,
        alwaysApply,
        now,
        now,
      );
      wrote = true;
      return db.prepare("SELECT * FROM skill_proposals WHERE id=?").get(id) as SkillProposal;
    };

    try {
      const proposal = insertCandidate();
      return {
        result: { proposal, disposition: existing ? "replaced" as const : "created" as const },
        wrote,
      };
    } catch (error) {
      if (!isCandidateUniqueConstraint(error)) throw error;
      const raced = findOpenCandidate(db, projectId, candidateGroupKey);
      if (!raced) {
        throw errCode("DUPLICATE_PROPOSAL", `Concurrent proposal insertion detected for candidate group: ${candidateGroupKey}`, 409);
      }
      const reused = resolveExistingCandidate(raced);
      if (reused) return { result: reused, wrote };
      try {
        const proposal = insertCandidate();
        return { result: { proposal, disposition: "replaced" as const }, wrote };
      } catch (retryError) {
        if (isCandidateUniqueConstraint(retryError)) {
          throw errCode("DUPLICATE_PROPOSAL", `Concurrent proposal insertion detected for candidate group: ${candidateGroupKey}`, 409);
        }
        throw retryError;
      }
    }
  });
  if (outcome.wrote) checkpointAfterWrite();
  return outcome.result;
}

export function createProposal(
  projectId: string,
  proposalType: ProposalType,
  targetName: string,
  proposedState: string,
  options?: ProposalCandidateOptions,
): SkillProposal {
  return ensureProposalCandidate(projectId, proposalType, targetName, proposedState, options).proposal;
}

function sameStoredCandidateDecision(left: SkillProposal, right: SkillProposal): boolean {
  return sameCandidateDecision(
    left,
    right.proposal_type,
    right.target_name,
    right.proposed_state,
    {
      sourceProjectId: right.source_project_id ?? undefined,
      sourceName: right.source_name ?? undefined,
      alwaysApply: right.always_apply,
    },
    right.target_skill_id ?? null,
    right.expected_revision ?? null,
    right.expected_source_revision ?? null,
  );
}

function candidateCanStillApply(db: ReturnType<typeof getDb>, proposal: SkillProposal): boolean {
  if (proposal.proposal_type === "create") {
    return !db.prepare("SELECT id FROM skills WHERE project_id=? AND name=?").get(proposal.project_id, proposal.target_name);
  }

  const target = proposal.target_skill_id
    ? db.prepare("SELECT revision,archived_at FROM skills WHERE id=? AND project_id=?").get(proposal.target_skill_id, proposal.project_id) as { revision: number; archived_at: string | null } | undefined
    : undefined;
  const targetMatches = Boolean(target && !target.archived_at
    && (proposal.expected_revision == null || target.revision === proposal.expected_revision));
  if (proposal.proposal_type === "update" || proposal.proposal_type === "archive") return targetMatches;

  const source = proposal.source_project_id && proposal.source_name
    ? db.prepare("SELECT revision,archived_at FROM skills WHERE project_id=? AND name=?").get(proposal.source_project_id, proposal.source_name) as { revision: number; archived_at: string | null } | undefined
    : undefined;
  const sourceMatches = Boolean(source && !source.archived_at
    && (proposal.expected_source_revision == null || source.revision === proposal.expected_source_revision));
  return sourceMatches && (!proposal.target_skill_id || targetMatches);
}

function selectProposalSurvivor(db: ReturnType<typeof getDb>, candidates: SkillProposal[]): SkillProposal {
  const canApply = new Map(candidates.map((candidate) => [candidate.id, candidateCanStillApply(db, candidate)]));
  return [...candidates].sort((left, right) => {
    const currentDifference = Number(canApply.get(right.id)) - Number(canApply.get(left.id));
    if (currentDifference !== 0) return currentDifference;
    const pendingDifference = Number(right.status === "pending") - Number(left.status === "pending");
    if (pendingDifference !== 0) return pendingDifference;
    const rightTimestamp = `${right.updated_at}\u0000${right.created_at}\u0000${right.id}`;
    const leftTimestamp = `${left.updated_at}\u0000${left.created_at}\u0000${left.id}`;
    return rightTimestamp.localeCompare(leftTimestamp);
  })[0]!;
}

interface ReconciliationCandidateMetadata {
  id: string;
  project_id: string;
  proposal_type: ProposalType;
  target_name: string;
  source_project_id: string | null;
  source_name: string | null;
  raw_bytes: number;
}

const RECONCILIATION_METADATA_COLUMNS = `
  id,project_id,proposal_type,target_name,source_project_id,source_name,
  COALESCE(length(CAST(proposed_state AS BLOB)), 0)
    + COALESCE(length(CAST(evidence_json AS BLOB)), 0)
    + COALESCE(length(CAST(observation_ids AS BLOB)), 0) AS raw_bytes`;
const LEGACY_CANDIDATE_GROUP_CONDITION = `(
  candidate_group_key IS NULL
  OR length(candidate_group_key) != 76
  OR substr(candidate_group_key, 1, 12) != 'proposal:v1:'
  OR substr(candidate_group_key, 13) GLOB '*[^0-9a-f]*'
)`;

function candidateGroupKeyForMetadata(candidate: ReconciliationCandidateMetadata): string {
  return deriveCandidateGroupKey(
    candidate.project_id,
    candidate.proposal_type,
    candidate.target_name,
    candidate.source_project_id,
    candidate.source_name,
  );
}

function reconciliationRawBytes(candidate: ReconciliationCandidateMetadata): number {
  return Number.isSafeInteger(candidate.raw_bytes) && candidate.raw_bytes >= 0
    ? candidate.raw_bytes
    : MAX_RECONCILIATION_RAW_BYTES + 1;
}

function findOpenCandidateMetadata(
  db: ReturnType<typeof getDb>,
  projectId: string,
  candidateGroupKey: string,
): ReconciliationCandidateMetadata | undefined {
  return db.prepare(
    `SELECT ${RECONCILIATION_METADATA_COLUMNS}
     FROM skill_proposals
     WHERE project_id=? AND candidate_group_key=? AND status IN ${OPEN_PROPOSAL_STATUSES}
     ORDER BY updated_at DESC, created_at DESC, id DESC LIMIT 1`,
  ).get(projectId, candidateGroupKey) as ReconciliationCandidateMetadata | undefined;
}

function loadProposalCandidates(
  db: ReturnType<typeof getDb>,
  ids: string[],
): Map<string, SkillProposal> {
  if (ids.length === 0) return new Map();
  const placeholders = ids.map(() => "?").join(",");
  const rows = db.prepare(`SELECT * FROM skill_proposals WHERE id IN (${placeholders})`).all(...ids) as SkillProposal[];
  return new Map(rows.map((row) => [row.id, row]));
}

export function reconcileOpenProposalCandidates(
  limit = MAX_RECONCILIATION_OPEN_PROPOSALS,
): ProposalCandidateReconciliation {
  const boundedLimit = Number.isInteger(limit)
    ? Math.min(Math.max(limit, 1), MAX_RECONCILIATION_OPEN_PROPOSALS)
    : MAX_RECONCILIATION_OPEN_PROPOSALS;
  const outcome = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const scanned = db.prepare(
      `SELECT ${RECONCILIATION_METADATA_COLUMNS}
       FROM skill_proposals
       WHERE ${LEGACY_CANDIDATE_GROUP_CONDITION} AND status IN ${OPEN_PROPOSAL_STATUSES}
       ORDER BY project_id, proposal_type, target_name, source_project_id, source_name, updated_at DESC, created_at DESC, id DESC
       LIMIT ?`,
    ).all(boundedLimit + 1) as ReconciliationCandidateMetadata[];
    const deferredGroupKeys = new Set<string>();
    const deferredCandidateIds = new Set<string>();
    const groups = new Map<string, ReconciliationCandidateMetadata[]>();
    let reservedRawBytes = 0;
    let reservedWorkUnits = 0;

    const defer = (candidateGroupKey: string, candidates: ReconciliationCandidateMetadata[]): void => {
      deferredGroupKeys.add(candidateGroupKey);
      for (const candidate of candidates) deferredCandidateIds.add(candidate.id);
    };

    for (const candidate of scanned.slice(0, boundedLimit)) {
      const candidateGroupKey = candidateGroupKeyForMetadata(candidate);
      const rawBytes = reconciliationRawBytes(candidate);
      if (reservedWorkUnits + 1 > MAX_RECONCILIATION_WORK_UNITS
        || reservedRawBytes + rawBytes > MAX_RECONCILIATION_RAW_BYTES) {
        defer(candidateGroupKey, [candidate]);
        continue;
      }
      const group = groups.get(candidateGroupKey);
      if (group) group.push(candidate);
      else groups.set(candidateGroupKey, [candidate]);
      reservedWorkUnits++;
      reservedRawBytes += rawBytes;
    }
    for (const candidate of scanned.slice(boundedLimit)) {
      defer(candidateGroupKeyForMetadata(candidate), [candidate]);
    }

    for (const [candidateGroupKey, candidates] of groups) {
      if (deferredGroupKeys.has(candidateGroupKey)) continue;
      const keyedCandidate = findOpenCandidateMetadata(db, candidates[0]!.project_id, candidateGroupKey);
      if (!keyedCandidate || candidates.some((candidate) => candidate.id === keyedCandidate.id)) continue;
      const rawBytes = reconciliationRawBytes(keyedCandidate);
      if (reservedWorkUnits + 1 > MAX_RECONCILIATION_WORK_UNITS
        || reservedRawBytes + rawBytes > MAX_RECONCILIATION_RAW_BYTES) {
        defer(candidateGroupKey, [...candidates, keyedCandidate]);
        continue;
      }
      candidates.push(keyedCandidate);
      reservedWorkUnits++;
      reservedRawBytes += rawBytes;
    }

    const processableGroups = [...groups.entries()].filter(([candidateGroupKey]) => !deferredGroupKeys.has(candidateGroupKey));
    const candidateIds = processableGroups.flatMap(([, candidates]) => candidates.map((candidate) => candidate.id));
    const candidatesById = loadProposalCandidates(db, candidateIds);

    const result: ProposalCandidateReconciliation = {
      groupsProcessed: 0,
      keysAssigned: 0,
      staleProposals: 0,
      evidenceReferencesMerged: 0,
      observationReferencesMerged: 0,
      truncated: scanned.length > boundedLimit,
      deferredGroups: 0,
      deferredCandidates: 0,
      rawBytesProcessed: processableGroups
        .flatMap(([, candidates]) => candidates)
        .reduce((total, candidate) => total + reconciliationRawBytes(candidate), 0),
      workUnits: candidateIds.length,
    };
    let wrote = false;
    const now = new Date().toISOString();

    for (const [candidateGroupKey, candidateMetadata] of processableGroups) {
      const candidates = candidateMetadata
        .map((candidate) => candidatesById.get(candidate.id))
        .filter((candidate): candidate is SkillProposal => candidate !== undefined);
      if (candidates.length !== candidateMetadata.length) {
        defer(candidateGroupKey, candidateMetadata);
        continue;
      }
      const survivor = selectProposalSurvivor(db, candidates);
      let evidenceJson = survivor.evidence_json;
      let observationIds = survivor.observation_ids;
      let qualityScore = survivor.quality_score;
      let noveltyScore = survivor.novelty_score;
      let contradictionFlag = survivor.contradiction_flag;
      let evidenceReferencesMerged = 0;
      let observationReferencesMerged = 0;

      try {
        for (const candidate of candidates) {
          if (candidate.id === survivor.id || !sameStoredCandidateDecision(candidate, survivor)) continue;
          assertProjectOwnsObservations(db, survivor.project_id, parseObservationReferences(observationIds));
          assertProjectOwnsObservations(db, survivor.project_id, parseObservationReferences(candidate.observation_ids));
          const mergedEvidence = mergeUniqueJsonReferences(evidenceJson, candidate.evidence_json, "evidence");
          evidenceJson = mergedEvidence.json;
          evidenceReferencesMerged += mergedEvidence.added;
          const mergedObservations = mergeUniqueJsonReferences(observationIds, candidate.observation_ids, "observations");
          observationIds = mergedObservations.json;
          observationReferencesMerged += mergedObservations.added;
          qualityScore = Math.max(qualityScore, candidate.quality_score);
          noveltyScore = Math.max(noveltyScore, candidate.novelty_score);
          contradictionFlag = Math.max(contradictionFlag, candidate.contradiction_flag);
        }
      } catch (error) {
        if (error instanceof GovernanceError) {
          defer(candidateGroupKey, candidateMetadata);
          continue;
        }
        throw error;
      }

      for (const candidate of candidates) {
        if (candidate.id === survivor.id) continue;
        staleOpenCandidate(db, survivor.project_id, candidate.id, RECONCILED_CANDIDATE_REASON, now);
        result.staleProposals++;
        wrote = true;
      }
      result.evidenceReferencesMerged += evidenceReferencesMerged;
      result.observationReferencesMerged += observationReferencesMerged;

      const needsUpdate = survivor.candidate_group_key !== candidateGroupKey
        || survivor.evidence_json !== evidenceJson
        || survivor.observation_ids !== observationIds
        || survivor.quality_score !== qualityScore
        || survivor.novelty_score !== noveltyScore
        || survivor.contradiction_flag !== contradictionFlag;
      if (!needsUpdate) {
        result.groupsProcessed++;
        continue;
      }
      db.prepare(
        "UPDATE skill_proposals SET candidate_group_key=?,evidence_json=?,observation_ids=?,quality_score=?,novelty_score=?,contradiction_flag=?,updated_at=? WHERE id=? AND project_id=?",
      ).run(
        candidateGroupKey,
        evidenceJson,
        observationIds,
        qualityScore,
        noveltyScore,
        contradictionFlag,
        now,
        survivor.id,
        survivor.project_id,
      );
      if (survivor.candidate_group_key !== candidateGroupKey) result.keysAssigned++;
      wrote = true;
      result.groupsProcessed++;
    }
    result.truncated ||= deferredGroupKeys.size > 0;
    result.deferredGroups = deferredGroupKeys.size;
    result.deferredCandidates = deferredCandidateIds.size;
    return { result, wrote };
  });
  if (outcome.wrote) checkpointAfterWrite();
  return outcome.result;
}

/** @deprecated Use listProposalPage() for bounded proposal reads. */
export function listProposals(projectId: string, status?: string): SkillProposal[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return status ? db.prepare("SELECT * FROM skill_proposals WHERE project_id=? AND status=? ORDER BY created_at DESC").all(projectId, status) as SkillProposal[]
    : db.prepare("SELECT * FROM skill_proposals WHERE project_id=? ORDER BY created_at DESC").all(projectId) as SkillProposal[];
}

export const DEFAULT_SKILL_PROPOSAL_PAGE_LIMIT = 25;
export const MAX_SKILL_PROPOSAL_PAGE_LIMIT = 100;
export const MAX_SKILL_PROPOSAL_PAGE_CURSOR_LENGTH = 512;

export interface SkillProposalPageOptions {
  view: SkillProposalPageView;
  limit?: number;
  cursor?: string;
}

const PROPOSAL_SUMMARY_COLUMNS = `
  id,status,proposal_type,
  substr(target_name, 1, ${MAX_SKILL_PROPOSAL_SUMMARY_TEXT_CHARACTERS}) AS target_name,
  substr(source_name, 1, ${MAX_SKILL_PROPOSAL_SUMMARY_TEXT_CHARACTERS}) AS source_name,
  quality_score,novelty_score,created_at`;

function proposalPageValidationError(code: string, message: string): GovernanceError {
  return errCode(code, message, 422);
}

function isProposalPageView(value: unknown): value is SkillProposalPageView {
  return value === "open" || value === "history";
}

function validateProposalPageLimit(value: number | undefined): number {
  const limit = value ?? DEFAULT_SKILL_PROPOSAL_PAGE_LIMIT;
  if (!Number.isSafeInteger(limit) || limit < 1 || limit > MAX_SKILL_PROPOSAL_PAGE_LIMIT) {
    throw proposalPageValidationError(
      "INVALID_PROPOSAL_PAGE_LIMIT",
      `limit must be an integer between 1 and ${MAX_SKILL_PROPOSAL_PAGE_LIMIT}`,
    );
  }
  return limit;
}

function isCanonicalProposalTimestamp(value: string): boolean {
  if (value.length !== 24) return false;
  const milliseconds = Date.parse(value);
  return Number.isFinite(milliseconds) && new Date(milliseconds).toISOString() === value;
}

function decodeProposalPageCursor(cursor: string): SkillProposalPageCursor {
  if (typeof cursor !== "string" || cursor.length === 0 || cursor.length > MAX_SKILL_PROPOSAL_PAGE_CURSOR_LENGTH
    || !/^[A-Za-z0-9_-]+$/.test(cursor)) {
    throw proposalPageValidationError("INVALID_PROPOSAL_PAGE_CURSOR", "cursor must be a base64url value no longer than 512 characters");
  }

  let value: unknown;
  try {
    const decoded = Buffer.from(cursor, "base64url");
    if (decoded.toString("base64url") !== cursor) throw new Error("non-canonical base64url");
    value = JSON.parse(decoded.toString("utf8"));
  } catch {
    throw proposalPageValidationError("INVALID_PROPOSAL_PAGE_CURSOR", "cursor must contain a valid version 1 proposal anchor");
  }

  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw proposalPageValidationError("INVALID_PROPOSAL_PAGE_CURSOR", "cursor must contain a version 1 proposal anchor");
  }
  const candidate = value as Record<string, unknown>;
  const keys = Object.keys(candidate).sort();
  if (keys.join(",") !== "createdAt,id,v"
    || candidate.v !== SKILL_PROPOSAL_PAGE_CURSOR_VERSION
    || typeof candidate.createdAt !== "string"
    || !isCanonicalProposalTimestamp(candidate.createdAt)
    || typeof candidate.id !== "string"
    || candidate.id.length === 0) {
    throw proposalPageValidationError("INVALID_PROPOSAL_PAGE_CURSOR", "cursor must contain a valid version 1 proposal anchor");
  }
  return {
    v: SKILL_PROPOSAL_PAGE_CURSOR_VERSION,
    createdAt: candidate.createdAt,
    id: candidate.id,
  };
}

function encodeProposalPageCursor(proposal: SkillProposalSummary): string {
  return Buffer.from(JSON.stringify({
    v: SKILL_PROPOSAL_PAGE_CURSOR_VERSION,
    createdAt: proposal.created_at,
    id: proposal.id,
  })).toString("base64url");
}

function assertProposalPageCursorScope(
  db: ReturnType<typeof getDb>,
  projectId: string,
  cursor: SkillProposalPageCursor,
): void {
  const anchor = db.prepare(
    "SELECT project_id,created_at FROM skill_proposals WHERE id=?",
  ).get(cursor.id) as { project_id: string; created_at: string } | undefined;
  if (anchor && (anchor.project_id !== projectId || anchor.created_at !== cursor.createdAt)) {
    throw proposalPageValidationError("INVALID_PROPOSAL_PAGE_CURSOR", "cursor does not match this project's proposal ordering");
  }
}

function proposalStatusFilter(view: SkillProposalPageView): string {
  return view === "open" ? OPEN_PROPOSAL_STATUSES : HISTORY_PROPOSAL_STATUSES;
}

export function listProposalPage(projectId: string, options: SkillProposalPageOptions): SkillProposalPage {
  if (!isProposalPageView(options.view)) {
    throw proposalPageValidationError("INVALID_PROPOSAL_PAGE_VIEW", "view must be either open or history");
  }
  const limit = validateProposalPageLimit(options.limit);
  const cursor = options.cursor === undefined ? undefined : decodeProposalPageCursor(options.cursor);
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  if (cursor) assertProposalPageCursorScope(db, projectId, cursor);

  const query = `
    SELECT ${PROPOSAL_SUMMARY_COLUMNS}
    FROM skill_proposals INDEXED BY ${SKILL_PROPOSAL_RETENTION_INDEX}
    WHERE project_id=? AND status IN ${proposalStatusFilter(options.view)}
    ${cursor ? "AND (created_at < ? OR (created_at = ? AND id < ?))" : ""}
    ORDER BY created_at DESC,id DESC
    LIMIT ?`;
  const rows = (cursor
    ? db.prepare(query).all(projectId, cursor.createdAt, cursor.createdAt, cursor.id, limit + 1)
    : db.prepare(query).all(projectId, limit + 1)) as SkillProposalSummary[];
  const hasMore = rows.length > limit;
  const data = rows.slice(0, limit);
  return {
    data,
    pagination: {
      nextCursor: hasMore ? encodeProposalPageCursor(data[data.length - 1]!) : null,
      hasMore,
    },
  };
}

export function getProposalCounts(projectId: string): SkillProposalCounts {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  const counts = db.prepare(`
    SELECT
      COALESCE(SUM(CASE WHEN status IN ${OPEN_PROPOSAL_STATUSES} THEN 1 ELSE 0 END), 0) AS open,
      COALESCE(SUM(CASE WHEN status IN ${HISTORY_PROPOSAL_STATUSES} THEN 1 ELSE 0 END), 0) AS history,
      COALESCE(SUM(CASE WHEN status = 'draft' THEN 1 ELSE 0 END), 0) AS draft,
      COALESCE(SUM(CASE WHEN status = 'pending' THEN 1 ELSE 0 END), 0) AS pending,
      COALESCE(SUM(CASE WHEN status = 'stale' THEN 1 ELSE 0 END), 0) AS stale,
      COALESCE(SUM(CASE WHEN status = 'rejected' THEN 1 ELSE 0 END), 0) AS rejected,
      COALESCE(SUM(CASE WHEN status = 'applied' THEN 1 ELSE 0 END), 0) AS applied,
      COALESCE(SUM(CASE WHEN status = 'rolled_back' THEN 1 ELSE 0 END), 0) AS rolled_back
    FROM skill_proposals INDEXED BY ${SKILL_PROPOSAL_RETENTION_INDEX}
    WHERE project_id=?
  `).get(projectId) as {
    open: number;
    history: number;
    draft: number;
    pending: number;
    stale: number;
    rejected: number;
    applied: number;
    rolled_back: number;
  };
  return {
    open: counts.open,
    history: counts.history,
    byStatus: {
      draft: counts.draft,
      pending: counts.pending,
      stale: counts.stale,
      rejected: counts.rejected,
      applied: counts.applied,
      rolledBack: counts.rolled_back,
    },
  };
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
        const target = db.prepare(
          "SELECT file_tree FROM skills WHERE id=? AND project_id=?",
        ).get(proposal.target_skill_id, projectId) as { file_tree: string | null } | undefined;
        if (!target) throw errCode("TARGET_NOT_FOUND", `Target skill ${proposal.target_skill_id} not found`, 404);
        const fileTree = typeof state.file_tree_patch === "string"
          ? mergeFileTreePatch(target.file_tree, state.file_tree_patch)
          : state.file_tree as string | undefined;
        updateSkillWithinTransaction(projectId, proposal.target_name, state.content as string, state.description as string | undefined, state.tags as string | undefined, state.always_apply as number | undefined, fileTree, state.category as string | undefined);
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
