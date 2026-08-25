/**
 * MCP tool handlers for skill management.
 * 🔴 DB ISOLATION: MCP tool wrapper — proxies to API via HTTP, no direct DB access.
 * Each function calls the Ingenium API via HTTP and returns MCP-formatted results.
 * Skills use a bidirectional disk↔DB sync model with SHA-256 hash manifests.
 */
import { api, ApiHttpError } from "../client.js";
import { z } from "zod";
import { textResult } from "./result.js";

/** List all skills for a project. */
export async function skillList(project: string) {
  const res = await api.get("/skills", { project });
  return textResult(res.data);
}

/** Load a single skill by name. */
export async function skillLoad(project: string, name: string) {
  const res = await api.get(`/skills/${encodeURIComponent(name)}`, { project });
  return textResult(res.data);
}

/** Full-text search across skills. */
export async function skillSearch(project: string, query: string) {
  const res = await api.get("/skills/search", { project, q: query });
  return textResult(res.data);
}

/** Create a new skill. */
export async function skillCreate(project: string, name: string, description: string, content: string, category?: string, tags?: string, always_apply?: number, files?: string) {
  const res = await api.post("/skills", { name, description, content, category, tags, always_apply, files }, { project });
  return textResult(res.data);
}

/** Update an existing skill's content. */
export async function skillUpdate(project: string, name: string, content: string, description?: string, tags?: string, always_apply?: number, files?: string) {
  const res = await api.patch(`/skills/${encodeURIComponent(name)}`, { content, description, tags, always_apply, files }, { project });
  return textResult(res.data);
}

/** Delete a skill by name (archive-only semantics — soft-deletes to archived state). */
export async function skillDelete(project: string, name: string) {
  const res = await api.del(`/skills/${encodeURIComponent(name)}`, { project });
  // 204 returns empty body
  if (res.status === 204) {
    return { content: [{ type: "text" as const, text: "Skill deleted" }] };
  }
  return textResult(res.data);
}

/** Enable a skill and sync to disk. */
export async function skillEnable(project: string, name: string) {
  const res = await api.post(`/skills/${encodeURIComponent(name)}/enable?project=${encodeURIComponent(project)}`);
  return textResult(res.data);
}

/** Disable a skill and remove from disk. */
export async function skillDisable(project: string, name: string) {
  const res = await api.post(`/skills/${encodeURIComponent(name)}/disable?project=${encodeURIComponent(project)}`);
  return textResult(res.data);
}

/** Sync a skill from its .md file on disk to the DB — edits made directly to the file are persisted. */
export async function skillSync(project: string, name: string) {
  const res = await api.post(`/skills/${encodeURIComponent(name)}/sync?project=${encodeURIComponent(project)}`);
  return textResult(res.data);
}

/** Trigger LLM-driven skill audit — merges redundant skills to ≤20 total. */
export async function skillConsolidate(project: string) {
  const res = await api.post("/skills/consolidate", {}, { project });
  return textResult(res.data);
}

/** Preview what sync-all would change without modifying anything. */
export async function skillSyncAllPreview(project: string) {
  const res = await api.get("/skills/sync-all/preview", { project });
  return textResult(res.data);
}

/** Sync ALL skills disk→DB for a project. Use ?write_to_disk=true to also push DB→disk. */
export async function skillSyncAll(project: string) {
  const res = await api.post("/skills/sync-all", {}, { project });
  return textResult(res.data);
}

// ── Governance tools (archive / restore / versions / rollback) ─────

/** Archive a skill (soft-delete — moves to archived state, not permanent removal). */
export async function skillArchive(project: string, name: string) {
  const res = await api.post(`/skills/${encodeURIComponent(name)}/archive`, {}, { project });
  return textResult(res.data);
}

/** Restore a previously archived skill. */
export async function skillRestore(project: string, name: string) {
  const res = await api.post(`/skills/${encodeURIComponent(name)}/restore`, {}, { project });
  return textResult(res.data);
}

/** List all archived skills for a project. */
export async function skillListArchived(project: string) {
  const res = await api.get("/skills/archived", { project });
  return textResult(res.data);
}

/** Get version history for a skill. */
export async function skillVersions(project: string, name: string) {
  const res = await api.get(`/skills/${encodeURIComponent(name)}/versions`, { project });
  return textResult(res.data);
}

/** Rollback a skill to a specific revision. */
export async function skillRollback(project: string, name: string, revision: number) {
  const res = await api.post(`/skills/${encodeURIComponent(name)}/rollback`, { revision }, { project });
  return textResult(res.data);
}

// ── Lineage tools ──────────────────────────────────────────

/** Create a skill provenance lineage relationship linking a source skill to a target. */
export async function skillLineageCreate(
  project: string,
  sourceProjectId: string,
  sourceName: string,
  targetSkillId: string,
  sourceHash?: string,
  mergedFilePaths?: string[],
  tombstonePath?: string,
  reason?: string,
) {
  const body: Record<string, unknown> = { sourceProjectId, sourceName, targetSkillId };
  if (sourceHash !== undefined) body.sourceHash = sourceHash;
  if (mergedFilePaths !== undefined) body.mergedFilePaths = mergedFilePaths;
  if (tombstonePath !== undefined) body.tombstonePath = tombstonePath;
  if (reason !== undefined) body.reason = reason;
  const res = await api.post("/skills/lineage", body, { project });
  return textResult(res.data);
}

/** List lineage relationships for a skill (parents and children). */
export async function skillLineageList(project: string, name: string) {
  const res = await api.get(`/skills/${encodeURIComponent(name)}/lineage`, { project });
  return textResult(res.data);
}

// ── Proposal tools ─────────────────────────────────────────

/** Accepted proposal types (must match API enum). */
export type ProposalType = "create" | "update" | "merge" | "archive";

/** DB proposal statuses used for filtering (must match API query param). */
export type ProposalStatus = "draft" | "pending" | "rejected" | "applied" | "rolled_back" | "stale";
export type ProposalPageView = "open" | "history";

export const skillProposalPageViewSchema = z.enum(["open", "history"]);
export const skillProposalPageLimitSchema = z.number().int().min(1).max(100);
export const skillProposalPageCursorSchema = z.string().max(512);

/** Proposal state object type for the governance workflow — camelCase wire shape expected by API. */
export interface ProposalProposedState {
  description?: string;
  content?: string;
  category?: string;
  tags?: string;
  alwaysApply?: number;
  fileTree?: Record<string, string> | string;
}

/** Create a new skill governance proposal. Body matches API contract exactly. */
export async function skillProposalCreate(
  project: string,
  proposalType: ProposalType,
  targetName: string,
  proposedState: ProposalProposedState,
  sourceProjectId?: string,
  sourceName?: string,
  expectedRevision?: number,
  evidence?: unknown[],
  observationIds?: number[],
  qualityScore?: number,
  noveltyScore?: number,
  contradictionFlag?: boolean,
  candidateGroupKey?: string,
  alwaysApply?: number,
  targetSkillId?: string,
) {
  const body: Record<string, unknown> = {
    proposalType,
    targetName,
    proposedState,
  };
  if (sourceProjectId !== undefined) body.sourceProjectId = sourceProjectId;
  if (sourceName !== undefined) body.sourceName = sourceName;
  if (expectedRevision !== undefined) body.expectedRevision = expectedRevision;
  if (evidence !== undefined) body.evidence = evidence;
  if (observationIds !== undefined) body.observationIds = observationIds;
  if (qualityScore !== undefined) body.qualityScore = qualityScore;
  if (noveltyScore !== undefined) body.noveltyScore = noveltyScore;
  if (contradictionFlag !== undefined) body.contradictionFlag = contradictionFlag;
  if (candidateGroupKey !== undefined) body.candidateGroupKey = candidateGroupKey;
  if (alwaysApply !== undefined) body.alwaysApply = alwaysApply;
  if (targetSkillId !== undefined) body.targetSkillId = targetSkillId;

  const res = await api.post("/skills/proposals", body, { project });
  return textResult(res.data);
}

/** @deprecated The API returns SKILL_PROPOSAL_LIST_RETIRED; use page and counts tools. */
export async function skillProposalList(project: string, status?: ProposalStatus) {
  const params: Record<string, string> = { project };
  if (status) params.status = status;
  const res = await api.get("/skills/proposals", params);
  return textResult(res.data);
}

/** Read one API-enforced bounded proposal page without transforming its metadata. */
export async function skillProposalPage(
  project: string,
  view: ProposalPageView,
  limit?: number,
  cursor?: string,
) {
  const params: Record<string, string> = { project, view };
  if (limit !== undefined) params.limit = String(limit);
  if (cursor !== undefined) params.cursor = cursor;
  const res = await api.settled.get("/skills/proposals/page", params);
  if (!res.ok) {
    const payload = res.payload as { error?: { code?: unknown; message?: unknown } } | null;
    throw new ApiHttpError(res.status, payload?.error?.code, payload?.error?.message);
  }
  return { content: [{ type: "text" as const, text: JSON.stringify(res.payload) }] };
}

/** Read API-derived proposal counts for the scoped project. */
export async function skillProposalCounts(project: string) {
  const res = await api.get("/skills/proposals/counts", { project });
  return textResult(res.data);
}

/** Get a single skill proposal by ID (UUID). */
export async function skillProposalGet(project: string, proposalId: string) {
  const res = await api.get(`/skills/proposals/${encodeURIComponent(proposalId)}`, { project });
  return textResult(res.data);
}

/** Submit a proposal for review (transitions from draft to pending). */
export async function skillProposalSubmit(project: string, proposalId: string) {
  const res = await api.post(`/skills/proposals/${encodeURIComponent(proposalId)}/submit`, {}, { project });
  return textResult(res.data);
}

/** Approve a pending proposal. Reviewer is required; reason is optional. */
export async function skillProposalApprove(project: string, proposalId: string, reviewer: string, reason?: string) {
  const res = await api.post(`/skills/proposals/${encodeURIComponent(proposalId)}/approve`, { reviewer, reason }, { project });
  return textResult(res.data);
}

/** Reject a pending proposal. Reviewer is required; reason is optional. */
export async function skillProposalReject(project: string, proposalId: string, reviewer: string, reason?: string) {
  const res = await api.post(`/skills/proposals/${encodeURIComponent(proposalId)}/reject`, { reviewer, reason }, { project });
  return textResult(res.data);
}

/** Rollback an approved (applied) proposal. Reviewer is required; reason is optional. */
export async function skillProposalRollback(project: string, proposalId: string, reviewer: string, reason?: string) {
  const res = await api.post(`/skills/proposals/${encodeURIComponent(proposalId)}/rollback`, { reviewer, reason }, { project });
  return textResult(res.data);
}
