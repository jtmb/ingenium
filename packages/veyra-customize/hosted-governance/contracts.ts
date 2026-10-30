/** Existing hosted snake_case Skill DTO, not a new resource store. */
export type Skill = {id: string; project_id: string; name: string; description: string; content: string;
  category: string | null; tags: string | null; always_apply: number; file_tree: string | null; enabled: 0 | 1;
  revision: number; archived_at: string | null; created_at: string; updated_at: string};
export type CatalogRow = {id: string; kind: "skill" | "plugin"; name: string; description: string; category: string;
  visibility: string; installed: boolean; enabled: boolean; archived: boolean; revision: number | null; actions: string[]};
export type ProposalSummary = {id: string; status: string; proposalType: string; targetName: string; sourceName: string | null;
  qualityScore: number; noveltyScore: number; createdAt: string};
export type ProposalDetail = ProposalSummary & {projectId: string; targetSkillId: string | null; sourceProjectId: string | null;
  expectedRevision: number | null; expectedSourceRevision: number | null; proposedState: Record<string, unknown>;
  evidence: unknown[]; observationIds: unknown[]; reviewer: string | null; reviewReason: string | null;
  updatedAt: string; appliedAt: string | null; rolledBackAt: string | null; observations?: {id: number; contentPreview?: string; source?: string}[];
  currentSkill?: {content: string; revision: number} | null; sourceSkill?: {projectId:string; content: string; revision: number; name: string} | null};
export type ProposalPage = {data: ProposalSummary[]; pagination: {nextCursor: string | null; hasMore: boolean}};
export type ProposalCounts = {open: number; history: number; byStatus: Record<string, number>};
export type SynthesisStatus = {total_observations: number; pending_count: number; processed_count: number; trait_count: number;
  last_synthesis_at: string | null; incompleteBatch: null | {stage: string; observationCount: number; hasStoredProposalPlan: boolean;
    errorCount: number; lastErrorCode: string | null; createdAt: string; updatedAt: string; leaseState: string}};
export type ModelProvider = {providerId: string; label: string; models: {id: string; label: string}[]; defaultModel?: string};
export type Binding = Readonly<{
  authorityId: string; connectionId: string; grantId: string; grantRevision: number; epoch: string;
  nativeLibraryId: string; nativeServiceInstanceId: string; hostedServiceInstanceId: string; nativeProjectId: string | null; nativeProjectRevision: number | null;
  actorId: string; installationId: string; hostedProjectId: string; apiProject: string; visibility: "project" | "system";
}>;
export type ReadCommand =
  | {op: "catalog"; kind: "skill" | "plugin"; offset: number; limit: number}
  | {op: "skill"; name: string}
  | {op: "archived"}
  | {op: "proposal-counts"}
  | {op: "proposal-page"; view: "open" | "history"; cursor?: string}
  | {op: "proposal"; id: string; enrich?:boolean}
  | {op: "synthesis-status"} | {op: "synthesis-models"} | {op: "pipeline"};
export type WriteCommand =
  | {op: "create"; reviewedAbsent:true; name: string; description: string; content: string}
  | {op: "save"; name: string; filePath:string; target: {id:string;revision:number}; content: string; extra: {tags?: string; always_apply: number; files?: string}}
  | {op: "archive" | "restore" | "enable" | "disable"; name: string; target: {id:string;revision:number}}
  | {op: "approve" | "reject" | "rollback"; id: string; reviewed: {status:string;updatedAt:string;targetSkillId:string|null;sourceProjectId:string|null;sourceName:string|null;expectedRevision:number|null;expectedSourceRevision:number|null}; reviewer: string; reason?: string}
  | {op: "synthesis-run"; sessionId?: string; model?: {providerId: string; modelId: string}};
export type Command = ReadCommand | WriteCommand;
export type Operation = Command["op"];
export type WriteOriginal = Readonly<{id: string; binding: Binding; command: WriteCommand}>;
export type OperationReceipt = Readonly<{original: WriteOriginal; outcome: "succeeded" | "refused" | "unknown";
  value?: unknown; error?: {status?: number; code?: string; message: string}}>;
/** Root owns authentication, grant checks, durable original retention and dispatch. */
export interface BoundGovernanceTransport {
  readonly binding: Binding;
  readonly capabilities: readonly Operation[];
  current(): boolean;
  read(command: ReadCommand, binding: Binding): Promise<{binding: Binding; value: unknown}>;
  reserve(command: WriteCommand, binding: Binding): Promise<WriteOriginal>;
  send(original: WriteOriginal): Promise<OperationReceipt>;
  inspect(original: WriteOriginal): Promise<OperationReceipt>;
  pending(binding: Binding): Promise<readonly WriteOriginal[]>;
}
