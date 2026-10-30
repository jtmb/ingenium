import { useEffect, useRef, useState } from "react";
import type { LocalWorkspaceOwner } from "@veyra/contracts";
import type { LocalChatController } from "./local-chat-controller.mjs";
import { boundRead, type RuntimeRead } from "./local-observations.mjs";

export type RuntimeCatalog = { ready: boolean; agents: readonly { id: string; label: string }[]; message?: string };
export function LocalRuntimeControls({ controller, owner, sessionID, locked, onCatalog }: {
  controller: LocalChatController; owner: LocalWorkspaceOwner; sessionID?: string; locked: boolean;
  onCatalog: (catalog: RuntimeCatalog) => void;
}) {
  const [runtime, setRuntime] = useState<RuntimeRead | null>(null), [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), epoch = useRef(0);
  const ownerKey = JSON.stringify(owner);
  useEffect(() => { void refresh(); return () => { epoch.current++; }; }, [controller, ownerKey, onCatalog]);
  const refresh = async () => {
    const captured = ++epoch.current; setBusy(true); setError(null); setRuntime(null); onCatalog({ ready: false, agents: [] });
    try {
      const value = boundRead(await controller.transport.readRuntime(owner.workspace_id, controller.current), owner) as RuntimeRead;
      if (captured !== epoch.current || !controller.current()) return;
      if (value.ready !== true || value.readiness_scope !== "engine_protocol_only" || !Array.isArray(value.agents)) throw new Error(value.reason === "engine_stopped" || value.reason === "owned_engine_exited"
        ? "The local engine is stopped. Load a model in Models, then check again. Your draft is kept."
        : "The selected local engine is not ready. Your draft is kept.");
      const agents = value.agents.filter(agent => agent.mode === "primary" && !agent.hidden && typeof agent.id === "string" && agent.id.length > 0);
      setRuntime(value); onCatalog({ ready: true, agents: agents.map(agent => ({ id: agent.id, label: agent.name ?? agent.id })) });
    } catch (cause) { if (captured === epoch.current) { setError(cause instanceof Error ? cause.message : "Runtime observation unavailable."); onCatalog({ ready: false, agents: [], message: "This chat is not ready. Your draft is kept." }); } }
    finally { if (captured === epoch.current) setBusy(false); }
  };
  const select = async (kind: "session_select_agent" | "session_select_model", value: string) => {
    if (!sessionID) return;
    setBusy(true); setError(null);
    try {
      await controller.control(kind === "session_select_agent" ? { kind, session_id: sessionID, agent: value } : { kind, session_id: sessionID, model_id: value });
    } catch (cause) { setError(cause instanceof Error ? cause.message : "Selection outcome is unknown. Check the original receipt."); }
    finally { setBusy(false); }
  };
  return <section aria-label="Chat readiness">
    {busy && <p role="status">Checking available agents…</p>}
    {error && <p role="alert">{error}</p>}
    {runtime && <>
      <p role="status">{runtime.agents?.length ? "Ready to choose an agent." : "No primary agent is available. Your draft is kept."}</p>
      {sessionID && <label>Conversation agent <select defaultValue="" disabled={busy || locked} onChange={event => { const value = event.target.value; if (value) void select("session_select_agent", value); event.target.value = ""; }}>
        <option value="">Select observed agent</option>{runtime.agents?.map(agent => <option key={agent.id} value={agent.id}>{agent.name ?? agent.id}</option>)}
      </select></label>}
      {sessionID && runtime.model_selection_scope === "current_engine_model_only" && runtime.engine_model_selection?.id &&
        <button type="button" disabled={busy || locked} onClick={() => { void select("session_select_model", runtime.engine_model_selection!.id); }}>Use current engine model: {runtime.engine_model_selection.id}</button>}
    </>}
    <details><summary>Runtime details</summary><p>Readiness covers the selected engine protocol. Selecting an environment alone does not establish engine readiness.</p>
      <button type="button" disabled={busy} onClick={() => { void refresh(); }}>Check runtime again</button></details>
  </section>;
}
