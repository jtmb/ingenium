export interface MemoryScope { organizationId: string; ownerUserId: string; hostId: string; environmentId: string; projectId: string | null; workspaceId: string; bindingHash: string; bindingEpoch: number; visibility: "private" }
export interface RecallPage { items: { id: string; version: number; content: string; provenance: unknown; scope: MemoryScope; estimatedTokens: number; contentKind: "untrusted_memory_data"; instructionAuthority: false }[]; omitted: { id: string; reason: string }[]; usedTokens: number; excluded: boolean }
export function recallContext(page: RecallPage, expectedScope: MemoryScope): string | null;
export interface ContextManifestInput {
  contextLimit: number | null; measuredInputTokens: number | null; reservedOutputTokens: number | null;
  memoryPage?: RecallPage; expectedScope?: MemoryScope;
  sources?: { id: string; kind: string; hash: string; version: number; authority: string }[];
  compaction?: { checkpointId: string; inputHash: string; state: string } | null;
}
export function contextManifest(input: ContextManifestInput): {
  schemaVersion: 1; contextLimit: number | null; measuredInputTokens: number | null; reservedOutputTokens: number | null;
  remainingInputTokens: number | null; memory: { included: boolean; estimatedTokens: number; omitted: RecallPage['omitted']; instructionAuthority: false };
  sources: NonNullable<ContextManifestInput['sources']>; compaction: ContextManifestInput['compaction'];
};
export const MEMORY_LANES: ReadonlyArray<{ id: string; label: string; authority: string; editable: boolean }>;
export function memoryCommand(command: string): { action: string; lane: string } | null;
