"use client";

export interface MemoryControlsState {
  scopeKey: string;
  chatId: string;
  available: boolean;
  canChange: boolean;
  loading: boolean;
  pending: boolean;
  unknownOperationId?: string;
  unavailableReason?: string;
  error?: string;
  policy: { revision: number; enabled: boolean; generate: boolean; useMemory: boolean; externalContext: boolean };
  chat: { revision: number; useMemory: boolean; contribute: boolean };
}
export type MemoryControlChange =
  | { target: "host"; expectedRevision: number; values: MemoryControlsState["policy"] }
  | { target: "chat"; expectedRevision: number; values: MemoryControlsState["chat"] };

export function MemoryControls({ state, onChange, onReconcile }: {
  state: MemoryControlsState;
  onChange: (scopeKey: string, chatId: string, change: MemoryControlChange) => void;
  onReconcile: (operationId: string) => void;
}) {
  const disabled = !state.available || !state.canChange || state.loading || state.pending || !!state.unknownOperationId;
  const host = (field: "enabled" | "generate" | "useMemory" | "externalContext", checked: boolean) => onChange(state.scopeKey, state.chatId,
    { target: "host", expectedRevision: state.policy.revision, values: { ...state.policy, [field]: checked } });
  const chat = (field: "useMemory" | "contribute", checked: boolean) => onChange(state.scopeKey, state.chatId,
    { target: "chat", expectedRevision: state.chat.revision, values: { ...state.chat, [field]: checked } });
  return <section aria-label="Memory controls" className="space-y-3 rounded-lg border border-[var(--border)] p-4">
    <h3 className="font-medium">Memory</h3>
    {state.loading && <p role="status">Checking memory availability…</p>}
    {!state.available && !state.loading && <p role="status">{state.unavailableReason || "Memory is unavailable for this host and workspace."}</p>}
    {state.error && <p role="alert">{state.error}</p>}
    {state.unknownOperationId && <div role="status">
      <p>The last change has an unknown outcome. Check its receipt before making another change.</p>
      <button type="button" disabled={state.pending} onClick={() => onReconcile(state.unknownOperationId!)}>Check operation status</button>
    </div>}
    <fieldset disabled={disabled} className="space-y-2">
      <legend className="text-sm font-medium">This host and workspace</legend>
      <label className="flex items-center gap-2"><input type="checkbox" checked={state.policy.enabled} onChange={(e) => host("enabled", e.target.checked)} />Enable memory</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={state.policy.useMemory} onChange={(e) => host("useMemory", e.target.checked)} />Use memories</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={state.policy.generate} onChange={(e) => host("generate", e.target.checked)} />Generate learned recall from eligible chats</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={state.policy.externalContext} onChange={(e) => host("externalContext", e.target.checked)} />Allow tool and external context in generation</label>
    </fieldset>
    <fieldset disabled={disabled} className="space-y-2">
      <legend className="text-sm font-medium">This chat</legend>
      <label className="flex items-center gap-2"><input type="checkbox" checked={state.chat.useMemory} onChange={(e) => chat("useMemory", e.target.checked)} />Use memories in this chat</label>
      <label className="flex items-center gap-2"><input type="checkbox" checked={state.chat.contribute} onChange={(e) => chat("contribute", e.target.checked)} />Allow this chat to contribute</label>
    </fieldset>
    <p className="text-sm text-[var(--text-muted)]">Changes apply to future context and generation. They cannot retract memory already sent to a model. Turning generation off does not delete existing memories.</p>
    <p className="text-sm text-[var(--text-muted)]">Learned recall is inferred reference data. Instructions and skill activation remain separate.</p>
  </section>;
}
