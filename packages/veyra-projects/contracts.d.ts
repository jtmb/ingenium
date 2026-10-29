export interface OwnerScope {
  instanceId: string;
  organizationId: string;
  ownerUserId: string;
}
export interface WorkspaceRoot {
  id: string;
  canonicalRootId: string;
  hostId: string;
  environmentId: string;
  displayPath: string;
  isPrimary: boolean;
  repositoryIdentity: string | null;
}
export interface ProjectRef {
  version: 1;
  id: string;
  scope: OwnerScope;
  label: string;
  revision: number;
  archivedAt: string | null;
  archived: boolean;
  pinned: boolean;
  roots: WorkspaceRoot[];
  source: {system: "ingenium" | "native"; instanceId: string; revision: number};
}
interface ExecutionBase {
  version: 1;
  id: string;
  hostId: string;
  environmentId: string;
  workspaceBindingId: string;
  canonicalRootId: string;
  directory: string;
  shellId: string;
  securityEpoch: number;
  workspaceIdentity: string;
  mappingHash: string;
  ownerInstanceId: string;
  ownerRevision: number;
}
export type ExecutionBinding = ExecutionBase & (
  {kind: "windows"} |
  {kind: "wsl"; distro: string; user: string} |
  {kind: "cluster"; runtimeId: string; storageId: string}
);
export interface ExecutionChoice {
  binding: ExecutionBinding;
  projectId: string | null;
  label: string;
  available: boolean;
  reason?: string;
}
export interface WorkspaceSelection {
  projectId: string | null;
  bindingId: string | null;
}
export interface TerminalView {
  id: string;
  revision: number;
  title: string;
  state: "opening" | "running" | "reconnecting" | "closed" | "unknown";
  output: string;
  inputState: "idle" | "pending" | "unknown";
  gap: boolean;
}
export interface ProjectAction {
  id: string;
  label: string;
  kind: "run" | "build" | "test" | "setup";
  enabled: boolean;
  disabledReason?: string;
}
export interface WorktreeView {
  id: string;
  label: string;
  state: "creating" | "active" | "archive_intent" | "archived" | "restore_intent" | "unknown" | "create_failed";
  revision: number;
  canArchive: boolean;
  canRestore: boolean;
  reason?: string;
}
