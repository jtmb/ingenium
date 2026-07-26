import { SkillLineage, SkillProposal } from "../schema.js";
export declare class GovernanceError extends Error {
    readonly code: string;
    readonly statusCode: number;
    constructor(message: string, code: string, statusCode?: number);
}
export declare function errCode(code: string, msg: string, status?: number): GovernanceError;
export declare function createLineage(projectId: string, sourceProjectId: string, sourceName: string, targetSkillId: string, sourceHash?: string, mergedFilePaths?: string[], tombstonePath?: string | null, reason?: string): SkillLineage;
export declare function listLineage(projectId: string): SkillLineage[];
export declare function listLineageByTarget(targetSkillId: string): SkillLineage[];
export declare function resolveLineage(targetSkillId: string, projectId?: string): SkillLineage[];
export declare function createProposal(projectId: string, proposalType: "create" | "update" | "merge" | "archive", targetName: string, proposedState: string, options?: {
    sourceProjectId?: string;
    sourceName?: string;
    expectedRevision?: number;
    evidenceJson?: string;
    observationIds?: string;
    qualityScore?: number;
    noveltyScore?: number;
    contradictionFlag?: number;
    candidateGroupKey?: string;
    alwaysApply?: number;
    targetSkillId?: string;
}): SkillProposal;
export declare function listProposals(projectId: string, status?: string): SkillProposal[];
export declare function getProposal(projectId: string, proposalId: string): SkillProposal | undefined;
export declare function submitProposal(projectId: string, proposalId: string): SkillProposal | undefined;
export declare function approveProposal(projectId: string, proposalId: string, reviewer: string, reviewReason?: string): SkillProposal;
export declare function rejectProposal(projectId: string, proposalId: string, reviewer: string, reviewReason?: string): SkillProposal;
export declare function rollbackProposal(projectId: string, proposalId: string, reviewer: string, reviewReason?: string): SkillProposal;
//# sourceMappingURL=skill-governance.d.ts.map