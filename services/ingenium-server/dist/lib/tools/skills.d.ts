/** List all skills for a project. */
export declare function skillList(project: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Load a single skill by name. */
export declare function skillLoad(project: string, name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Full-text search across skills. */
export declare function skillSearch(project: string, query: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Create a new skill. */
export declare function skillCreate(project: string, name: string, description: string, content: string, category?: string, tags?: string, always_apply?: number, files?: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Update an existing skill's content. */
export declare function skillUpdate(project: string, name: string, content: string, description?: string, tags?: string, always_apply?: number, files?: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Delete a skill by name (archive-only semantics — soft-deletes to archived state). */
export declare function skillDelete(project: string, name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Enable a skill and sync to disk. */
export declare function skillEnable(project: string, name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Disable a skill and remove from disk. */
export declare function skillDisable(project: string, name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Sync a skill from its .md file on disk to the DB — edits made directly to the file are persisted. */
export declare function skillSync(project: string, name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Trigger LLM-driven skill audit — merges redundant skills to ≤20 total. */
export declare function skillConsolidate(project: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Preview what sync-all would change without modifying anything. */
export declare function skillSyncAllPreview(project: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Sync ALL skills disk→DB for a project. Use ?write_to_disk=true to also push DB→disk. */
export declare function skillSyncAll(project: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Archive a skill (soft-delete — moves to archived state, not permanent removal). */
export declare function skillArchive(project: string, name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Restore a previously archived skill. */
export declare function skillRestore(project: string, name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** List all archived skills for a project. */
export declare function skillListArchived(project: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Get version history for a skill. */
export declare function skillVersions(project: string, name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Rollback a skill to a specific revision. */
export declare function skillRollback(project: string, name: string, revision: number): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Create a skill provenance lineage relationship linking a source skill to a target. */
export declare function skillLineageCreate(project: string, sourceProjectId: string, sourceName: string, targetSkillId: string, sourceHash?: string, mergedFilePaths?: string[], tombstonePath?: string, reason?: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** List lineage relationships for a skill (parents and children). */
export declare function skillLineageList(project: string, name: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Accepted proposal types (must match API enum). */
export type ProposalType = "create" | "update" | "merge" | "archive";
/** DB proposal statuses used for filtering (must match API query param). */
export type ProposalStatus = "draft" | "pending" | "rejected" | "applied" | "rolled_back" | "stale";
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
export declare function skillProposalCreate(project: string, proposalType: ProposalType, targetName: string, proposedState: ProposalProposedState, sourceProjectId?: string, sourceName?: string, expectedRevision?: number, evidence?: unknown[], observationIds?: number[], qualityScore?: number, noveltyScore?: number, contradictionFlag?: boolean, candidateGroupKey?: string, alwaysApply?: number, targetSkillId?: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** List all skill proposals for a project. */
export declare function skillProposalList(project: string, status?: ProposalStatus): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Get a single skill proposal by ID (UUID). */
export declare function skillProposalGet(project: string, proposalId: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Submit a proposal for review (transitions from draft to pending). */
export declare function skillProposalSubmit(project: string, proposalId: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Approve a pending proposal. Reviewer is required; reason is optional. */
export declare function skillProposalApprove(project: string, proposalId: string, reviewer: string, reason?: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Reject a pending proposal. Reviewer is required; reason is optional. */
export declare function skillProposalReject(project: string, proposalId: string, reviewer: string, reason?: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
/** Rollback an approved (applied) proposal. Reviewer is required; reason is optional. */
export declare function skillProposalRollback(project: string, proposalId: string, reviewer: string, reason?: string): Promise<{
    content: {
        type: "text";
        text: string;
    }[];
}>;
//# sourceMappingURL=skills.d.ts.map