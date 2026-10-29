import type { MemoryScope, MemoryPermission, MemoryLifecycle, SourceState, SqlConnection } from './lifecycle.mjs';
export interface MemoryActor {
  type: 'user' | 'service'; id: string; scopes: readonly string[];
  tokenId?: string; workspaceId?: string; storageMappingHash?: string;
}
export interface MemorySelection { projectId: string | null; workspaceId: string; runtimeId: string }
export interface WorkspaceOwnership {
  organizationId: string; ownerUserId: string; projectId: string | null; workspaceId: string;
  bindingHash: string; bindingEpoch: number; status: 'authorized'; visibility?: 'private';
}
export interface AuthenticatedExecution extends WorkspaceOwnership {
  runtimeId: string; mode: 'runtime' | 'native' | 'compatibility'; hostId: string; environmentId: string; available: true;
}
export interface ChatBinding extends MemoryScope { chatId: string; runtimeId: string; available: true }
export interface MemoryApiPorts<RequestContext = unknown> {
  core: { getDb: () => SqlConnection & { readonly inTransaction: boolean }; execTransaction: <T>(work: () => T, retries: number) => T; checkpointAfterWrite: () => void };
  request: RequestContext;
  selected: MemorySelection;
  authenticate: (request: RequestContext) => { principal: MemoryActor; attestation?: { credentialId: string; workspaceId: string; storageMappingHash: string } } | null;
  resolveExistingScope: (input: { projectId: string; workspaceId: string; allowProjectVisibility: false;
    principal: { type: 'user'; userId: string } | { type: 'service'; servicePrincipalId: string; credentialId: string; storageMappingHash: string } }) => { organizationId: string; projectId: string; workspaceId: string; ownerUserId: string };
  resolveExecution: (input: { request: RequestContext; principal: MemoryActor; ownership: WorkspaceOwnership; runtimeId: string }) => AuthenticatedExecution | null;
  resolveChatBinding: (input: { request: RequestContext; principal: MemoryActor; scope: MemoryScope; execution: AuthenticatedExecution; chatId: string }) => ChatBinding | null;
  authorizeOperation: (input: { request: RequestContext; principal: MemoryActor; scope: MemoryScope; execution: AuthenticatedExecution; permission: MemoryPermission; chatId: string | null }) => boolean;
  resolveSourceState: (input: { request: RequestContext; principal: MemoryActor; scope: MemoryScope; execution: AuthenticatedExecution; chatId: string; messageId: string; conversationId: string; role: 'user' | 'assistant' | 'tool'; contentHash: string }) => Pick<SourceState,'active' | 'excluded' | 'uncertain' | 'idleEligible'> | null;
  resolveProjectlessScope?: (input: { request: RequestContext; principal: MemoryActor; workspaceId: string }) => (WorkspaceOwnership & { projectId: null; visibility: 'private' }) | null;
  clock?: () => string;
}
export function createApiMemorySession<RequestContext>(ports: MemoryApiPorts<RequestContext>): Readonly<{
  memory: MemoryLifecycle;
  resolveScope: (permission: MemoryPermission, chatId?: string | null) => MemoryScope;
  readSource: (scope: MemoryScope, chatId: string, messageId: string) => (SourceState & { content: string; role: 'user' | 'assistant' | 'tool'; contentKind: 'untrusted_context_data'; instructionAuthority: false }) | null;
}>;
export function explicitMemoryForChat<T extends { items: { instructionAuthority: false; contentKind: 'untrusted_memory_data'; memory: { organizationId: string; ownerUserId: string; projectId: string; workspaceId: string; state: 'active' | 'forgotten'; visibility: 'private' | 'project' } }[] }>(input: {
  memory: MemoryLifecycle; scope: MemoryScope; chatId: string;
  loadExplicit: (scope: { organizationId: string; ownerUserId: string; projectId: string; workspaceId: string; allowProjectVisibility: false }) => T | Promise<T>;
}): Promise<{ excluded: boolean; reason: string | null; page: T | null }>;
