/**
 * MCP tool handlers for skill management.
 * 🔴 DB ISOLATION: MCP tool wrapper — proxies to API via HTTP, no direct DB access.
 * Each function calls the Ingenium API via HTTP and returns MCP-formatted results.
 * Skills use a bidirectional disk↔DB sync model with SHA-256 hash manifests.
 */
import { api } from "../client.js";
/** List all skills for a project. */
export async function skillList(project) {
    const res = await api.get("/skills", { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Load a single skill by name. */
export async function skillLoad(project, name) {
    const res = await api.get(`/skills/${encodeURIComponent(name)}`, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Full-text search across skills. */
export async function skillSearch(project, query) {
    const res = await api.get("/skills/search", { project, q: query });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Create a new skill. */
export async function skillCreate(project, name, description, content, category, tags, always_apply, files) {
    const res = await api.post("/skills", { name, description, content, category, tags, always_apply, files }, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Update an existing skill's content. */
export async function skillUpdate(project, name, content, description, tags, always_apply, files) {
    const res = await api.patch(`/skills/${encodeURIComponent(name)}`, { content, description, tags, always_apply, files }, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Delete a skill by name (archive-only semantics — soft-deletes to archived state). */
export async function skillDelete(project, name) {
    const res = await api.del(`/skills/${encodeURIComponent(name)}`, { project });
    // 204 returns empty body
    if (res.status === 204) {
        return { content: [{ type: "text", text: "Skill deleted" }] };
    }
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Enable a skill and sync to disk. */
export async function skillEnable(project, name) {
    const res = await api.post(`/skills/${encodeURIComponent(name)}/enable?project=${encodeURIComponent(project)}`);
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Disable a skill and remove from disk. */
export async function skillDisable(project, name) {
    const res = await api.post(`/skills/${encodeURIComponent(name)}/disable?project=${encodeURIComponent(project)}`);
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Sync a skill from its .md file on disk to the DB — edits made directly to the file are persisted. */
export async function skillSync(project, name) {
    const res = await api.post(`/skills/${encodeURIComponent(name)}/sync?project=${encodeURIComponent(project)}`);
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Trigger LLM-driven skill audit — merges redundant skills to ≤20 total. */
export async function skillConsolidate(project) {
    const res = await api.post("/skills/consolidate", {}, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Preview what sync-all would change without modifying anything. */
export async function skillSyncAllPreview(project) {
    const res = await api.get("/skills/sync-all/preview", { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Sync ALL skills disk→DB for a project. Use ?write_to_disk=true to also push DB→disk. */
export async function skillSyncAll(project) {
    const res = await api.post("/skills/sync-all", {}, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
// ── Governance tools (archive / restore / versions / rollback) ─────
/** Archive a skill (soft-delete — moves to archived state, not permanent removal). */
export async function skillArchive(project, name) {
    const res = await api.post(`/skills/${encodeURIComponent(name)}/archive`, {}, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Restore a previously archived skill. */
export async function skillRestore(project, name) {
    const res = await api.post(`/skills/${encodeURIComponent(name)}/restore`, {}, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** List all archived skills for a project. */
export async function skillListArchived(project) {
    const res = await api.get("/skills/archived", { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Get version history for a skill. */
export async function skillVersions(project, name) {
    const res = await api.get(`/skills/${encodeURIComponent(name)}/versions`, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Rollback a skill to a specific revision. */
export async function skillRollback(project, name, revision) {
    const res = await api.post(`/skills/${encodeURIComponent(name)}/rollback`, { revision }, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
// ── Lineage tools ──────────────────────────────────────────
/** Create a skill provenance lineage relationship linking a source skill to a target. */
export async function skillLineageCreate(project, sourceProjectId, sourceName, targetSkillId, sourceHash, mergedFilePaths, tombstonePath, reason) {
    const body = { sourceProjectId, sourceName, targetSkillId };
    if (sourceHash !== undefined)
        body.sourceHash = sourceHash;
    if (mergedFilePaths !== undefined)
        body.mergedFilePaths = mergedFilePaths;
    if (tombstonePath !== undefined)
        body.tombstonePath = tombstonePath;
    if (reason !== undefined)
        body.reason = reason;
    const res = await api.post("/skills/lineage", body, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** List lineage relationships for a skill (parents and children). */
export async function skillLineageList(project, name) {
    const res = await api.get(`/skills/${encodeURIComponent(name)}/lineage`, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Create a new skill governance proposal. Body matches API contract exactly. */
export async function skillProposalCreate(project, proposalType, targetName, proposedState, sourceProjectId, sourceName, expectedRevision, evidence, observationIds, qualityScore, noveltyScore, contradictionFlag, candidateGroupKey, alwaysApply, targetSkillId) {
    const body = {
        proposalType,
        targetName,
        proposedState,
    };
    if (sourceProjectId !== undefined)
        body.sourceProjectId = sourceProjectId;
    if (sourceName !== undefined)
        body.sourceName = sourceName;
    if (expectedRevision !== undefined)
        body.expectedRevision = expectedRevision;
    if (evidence !== undefined)
        body.evidence = evidence;
    if (observationIds !== undefined)
        body.observationIds = observationIds;
    if (qualityScore !== undefined)
        body.qualityScore = qualityScore;
    if (noveltyScore !== undefined)
        body.noveltyScore = noveltyScore;
    if (contradictionFlag !== undefined)
        body.contradictionFlag = contradictionFlag;
    if (candidateGroupKey !== undefined)
        body.candidateGroupKey = candidateGroupKey;
    if (alwaysApply !== undefined)
        body.alwaysApply = alwaysApply;
    if (targetSkillId !== undefined)
        body.targetSkillId = targetSkillId;
    const res = await api.post("/skills/proposals", body, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** List all skill proposals for a project. */
export async function skillProposalList(project, status) {
    const params = { project };
    if (status)
        params.status = status;
    const res = await api.get("/skills/proposals", params);
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Get a single skill proposal by ID (UUID). */
export async function skillProposalGet(project, proposalId) {
    const res = await api.get(`/skills/proposals/${encodeURIComponent(proposalId)}`, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Submit a proposal for review (transitions from draft to pending). */
export async function skillProposalSubmit(project, proposalId) {
    const res = await api.post(`/skills/proposals/${encodeURIComponent(proposalId)}/submit`, {}, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Approve a pending proposal. Reviewer is required; reason is optional. */
export async function skillProposalApprove(project, proposalId, reviewer, reason) {
    const res = await api.post(`/skills/proposals/${encodeURIComponent(proposalId)}/approve`, { reviewer, reason }, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Reject a pending proposal. Reviewer is required; reason is optional. */
export async function skillProposalReject(project, proposalId, reviewer, reason) {
    const res = await api.post(`/skills/proposals/${encodeURIComponent(proposalId)}/reject`, { reviewer, reason }, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Rollback an approved (applied) proposal. Reviewer is required; reason is optional. */
export async function skillProposalRollback(project, proposalId, reviewer, reason) {
    const res = await api.post(`/skills/proposals/${encodeURIComponent(proposalId)}/rollback`, { reviewer, reason }, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
