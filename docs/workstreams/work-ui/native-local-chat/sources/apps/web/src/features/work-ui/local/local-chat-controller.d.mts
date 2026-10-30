import type { ChatOperation, LocalIdentity, LocalTransport, Seal, WorkspaceObservation } from "./local-protocol.mjs";
export interface OriginalStore {
  read(key: string): string | null;
  put(key: string, expected: string | null, next: string): void;
  withLock<T>(key: string, work: () => Promise<T>): Promise<T>;
}
export type LocalJournal = Readonly<{
  schema: 1; flow_id: string; identity: LocalIdentity; draft: string; agent: string; sequence: number; error: string | null;
  plan: { wire: string; sha256: string } | null;
  workspace: { seal: Seal; observation: WorkspaceObservation | null } | null;
  session: Seal | null; prompts: readonly Seal[]; controls: readonly Seal[];
}>;
export type LocalChatSnapshot = Readonly<{ loaded: boolean; busy: boolean; error: string | null; journal: LocalJournal | null }>;
export class LocalChatController {
  constructor(options: { identity: LocalIdentity; flowID: string; store: OriginalStore; transport: LocalTransport; current: () => boolean; uuid?: () => string });
  readonly identity: LocalIdentity;
  readonly key: string;
  readonly transport: LocalTransport;
  readonly current: () => boolean;
  getSnapshot(): LocalChatSnapshot;
  subscribe(listener: () => void): () => void;
  restore(): Promise<void>;
  setDraft(text: string, agent: string): Promise<void>;
  send(): Promise<void>;
  prepareWorkspace(): Promise<void>;
  control(operation: Extract<ChatOperation, { kind: "session_interrupt" | "session_select_model" | "session_select_agent" }>): Promise<void>;
  checkOriginals(): Promise<void>;
  unresolved(journal: LocalJournal): boolean;
}
