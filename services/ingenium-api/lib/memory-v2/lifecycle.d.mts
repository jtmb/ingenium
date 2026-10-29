export interface MemoryScope {
  organizationId: string; ownerUserId: string; hostId: string; environmentId: string;
  projectId: string | null; workspaceId: string; bindingHash: string; bindingEpoch: number; visibility: "private";
}
export type MemoryPermission = "read" | "write-policy" | "generate" | "read-source" | "forget" | "backup" | "restore";
export interface HostPolicy { revision: number; enabled: boolean; generate: boolean; useMemory: boolean; externalContext: boolean }
export interface ChatPolicy { revision: number; useMemory: boolean; contribute: boolean }
export interface SourceRef { id: string; contentHash: string }
export interface SourceState { contentHash: string; active: boolean; excluded: boolean; uncertain: boolean; idleEligible: boolean; kind: "transcript" | "tool" | "external" }
export interface Admission {
  schemaVersion: 1; scopeHash: string; chatId: string; policyRevision: number; chatRevision: number;
  sources: (SourceRef & { kind: SourceState["kind"]; chatId: string })[]; inputHash: string;
}
export interface MemoryReceipt {
  schemaVersion: 1; receiptId: string; operationId: string; status: "committed"; operation: string;
  committedAt: string; scopeHash: string; memoryId?: string; version?: number; revision?: number; forgottenCount?: number; inputHash?: string; jobHash?: string;
}
export interface MutationResult { receipt: MemoryReceipt; idempotent: boolean }
export interface RecallItem {
  id: string; version: number; content: string; contentHash: string;
  provenance: { sources: Admission["sources"]; model: string; policyRevision: number; inferred: true };
  scope: MemoryScope; contentKind: "untrusted_memory_data"; instructionAuthority: false;
  stalePossible: true; estimatedTokens: number; reason: string;
}
export interface RecallPage { items: RecallItem[]; omitted: { id: string; reason: string }[]; excluded: boolean; usedTokens: number }
export interface SqlStatement {
  run(...params: (string | number | null)[]): unknown;
  get(...params: (string | number | null)[]): unknown;
  all(...params: (string | number | null)[]): unknown[];
}
export interface SqlConnection { exec(sql: string): unknown; prepare(sql: string): SqlStatement }
export class MemoryError extends Error { code: string; constructor(code: string) }
export function scopeKey(scope: MemoryScope): string;
export const DEFAULT_MEMORY_POLICY: Readonly<HostPolicy>;
export const DEFAULT_CHAT_MEMORY_POLICY: Readonly<ChatPolicy>;
export interface SuppressionBundle { schemaVersion: 1; scopeHash: string; entries: { kind: "memory" | "source" | "content"; target: string; receipt_id: string }[]; receipts: { operation_id: string; request_hash: string; receipt_json: string }[] }
export class MemoryLifecycle {
  constructor(adapter: { db: SqlConnection; authorize: (scope: MemoryScope, permission: MemoryPermission, chatId: string | null) => boolean;
    sources: (scope: MemoryScope, chatId: string, id: string) => SourceState | null; checkpoint: () => void; clock?: () => string });
  policy(scope: MemoryScope, chatId: string): { schemaVersion: 1; policy: HostPolicy; chat: ChatPolicy; available: true };
  operation(scope: MemoryScope, operationId: string): MemoryReceipt | null;
  setPolicy(scope: MemoryScope, input: Omit<HostPolicy,"revision"> & { operationId: string; expectedRevision: number }): MutationResult;
  setChatPolicy(scope: MemoryScope, chatId: string, input: Omit<ChatPolicy,"revision"> & { operationId: string; expectedRevision: number }): MutationResult;
  admit(scope: MemoryScope, chatId: string, sourceRefs: SourceRef[]): Admission;
  commitRecall(scope: MemoryScope, input: { operationId: string; admission: Admission; content: string; model: string }): MutationResult;
  recall(scope: MemoryScope, chatId: string, budget?: { maxItems?: number; maxTokens?: number }): RecallPage;
  inspect(scope: MemoryScope, page?: { offset?: number; limit?: number }): { items: Pick<RecallItem,"id" | "content" | "version" | "provenance">[]; total: number; nextOffset: number | null };
  forget(scope: MemoryScope, input: { operationId: string; memoryId: string; expectedVersion: number }): MutationResult;
  previewReset(scope: MemoryScope): { scopeHash: string; count: number; confirmation: string };
  reset(scope: MemoryScope, input: { operationId: string; confirmation: string }): MutationResult;
  exportSuppressions(scope: MemoryScope): SuppressionBundle;
  applySuppressions(scope: MemoryScope, bundle: SuppressionBundle): { suppressedCount: number };
}
