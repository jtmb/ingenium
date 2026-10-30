import { useEffect, useRef, useState, useSyncExternalStore, type ReactNode } from "react";
import type { LocalWorkspaceOwner } from "@veyra/contracts";
import { NativeWorkPresentation } from "../NativeWorkPresentation";
import { identity, owner, same, type LocalIdentity } from "./local-protocol.mjs";
import type { LocalChatController } from "./local-chat-controller.mjs";
import { LocalConversation } from "./LocalConversation";
import { LocalRuntimeControls, type RuntimeCatalog } from "./LocalRuntimeControls";
import "./local-chat.css";

/** Projection of the actual new closed context port; Root adapts the frozen
 * generated DTO. Unavailable is the default, never a fixture/readiness fallback. */
export type LocalAdmissionView =
  | { kind: "unavailable"; message: string }
  | { kind: "observed"; identity: LocalIdentity; canRequest: boolean; message: string };
export type BoundLocalContent = { owner: LocalWorkspaceOwner; session_id: string; content: ReactNode };
function sameContext(view: LocalAdmissionView, controller: LocalChatController) {
  try { return view.kind === "observed" && same(identity(view.identity), controller.identity); } catch { return false; }
}
function boundContent(value: BoundLocalContent | null | undefined, actual: LocalWorkspaceOwner | undefined, sessionID: string | undefined) {
  try { return value && actual && sessionID === value.session_id && same(owner(value.owner), owner(actual)) ? value.content : null; } catch { return null; }
}
export function LocalChatPanel({ controller, admission, conversation, controls }: {
  controller: LocalChatController | null; admission: LocalAdmissionView;
  conversation?: BoundLocalContent | null; controls?: BoundLocalContent | null;
}) {
  if (!controller) return <NativeWorkPresentation scope="local-unavailable" projectName="No project" hasWorkspace={false}>
    <p role="status">Chats without a project are not available yet. Your existing originals are kept.</p>
  </NativeWorkPresentation>;
  return <LocalChatForm key={controller.key} controller={controller} admission={admission} conversation={conversation} controls={controls} />;
}
function LocalChatForm({ controller, admission, conversation, controls }: {
  controller: LocalChatController; admission: LocalAdmissionView; conversation?: BoundLocalContent | null; controls?: BoundLocalContent | null;
}) {
  const snapshot = useSyncExternalStore(controller.subscribe, controller.getSnapshot, controller.getSnapshot);
  const [form, setForm] = useState({ text: "", agent: "" }), latest = useRef(form);
  const [working, setWorking] = useState(false), [error, setError] = useState<string | null>(null);
  const [catalog, setCatalog] = useState<RuntimeCatalog>({ ready: false, agents: [] });
  const queue = useRef<Promise<void>>(Promise.resolve()), hydrated = useRef(false), live = useRef(true);
  useEffect(() => {
    live.current = true;
    void controller.restore().catch(cause => { if (live.current) setError(cause instanceof Error ? cause.message : "Original storage unavailable."); });
    return () => { live.current = false; };
  }, [controller]);
  useEffect(() => {
    if (snapshot.loaded && !hydrated.current && snapshot.journal) {
      hydrated.current = true;
      latest.current = { text: snapshot.journal.draft, agent: snapshot.journal.agent };
      setForm(latest.current);
    }
  }, [snapshot]);
  const journal = snapshot.journal, unresolved = journal ? controller.unresolved(journal) : false;
  const actualOwner = journal?.workspace?.observation?.owner, sessionID = journal?.session?.observation?.id;
  const custodyEligible = sameContext(admission, controller) && admission.kind === "observed" && admission.canRequest;
  const eligible = custodyEligible && catalog.ready;
  const update = (patch: Partial<typeof form>) => {
    latest.current = { ...latest.current, ...patch }; setForm(latest.current);
    const captured = { ...latest.current };
    queue.current = queue.current.catch(() => {}).then(() => controller.setDraft(captured.text, captured.agent)).catch(cause => {
      if (live.current) setError(cause instanceof Error ? cause.message : "The draft could not be saved.");
    });
  };
  const run = async (readOnly: boolean) => {
    if (working) return;
    setWorking(true); setError(null);
    try {
      await queue.current;
      if (readOnly) await controller.checkOriginals();
      else {
        if (!eligible) throw new Error("Veyra cannot admit this local message yet. Your draft was kept.");
        await controller.setDraft(latest.current.text, latest.current.agent);
        await controller.send();
      }
      const stored = controller.getSnapshot().journal;
      if (live.current && stored) { latest.current = { text: stored.draft, agent: stored.agent }; setForm(latest.current); }
    } catch (cause) { if (live.current) setError(cause instanceof Error ? cause.message : "The original outcome could not be confirmed."); }
    finally { if (live.current) setWorking(false); }
  };
  const renderedConversation = boundContent(conversation, actualOwner, sessionID);
  return <NativeWorkPresentation scope={JSON.stringify([controller.key, actualOwner, sessionID])} projectName="No project" hasWorkspace={false}>
    <section className="native-local-chat" aria-label="Chat without a project">
      {!eligible && <p role="status">{admission.message}</p>}
      {(error || snapshot.error) && <p role="alert">{error ?? snapshot.error}</p>}
      {unresolved && <div role="status"><p>An original outcome needs checking. No message or workspace will be repeated.</p>
        <button type="button" disabled={working} onClick={() => { void run(true); }}>Check original receipts</button></div>}
      {!actualOwner && <button type="button" disabled={!snapshot.loaded || working || unresolved || !custodyEligible} onClick={() => {
        if (working) return; setWorking(true); setError(null);
        void queue.current.then(() => controller.prepareWorkspace()).catch(cause => setError(cause instanceof Error ? cause.message : "Workspace outcome unknown.")).finally(() => setWorking(false));
      }}>Prepare private workspace</button>}
      {actualOwner && <LocalRuntimeControls controller={controller} owner={actualOwner} sessionID={sessionID} locked={unresolved || working} onCatalog={setCatalog} />}
      <div className="native-local-transcript" aria-label="Local conversation">
        {renderedConversation ?? (actualOwner && sessionID ? <LocalConversation controller={controller} owner={actualOwner} sessionID={sessionID} locked={unresolved || working} /> : <p role="status">Prepare the private workspace, then read its actual runtime to choose an agent. Saved originals are available below.</p>)}
      </div>
      {boundContent(controls, actualOwner, sessionID)}
      <div className="native-local-composer">
        <label>Agent <select aria-label="Agent for the new local conversation" value={form.agent} disabled={!snapshot.loaded || working || unresolved || Boolean(sessionID)}
          onChange={event => update({ agent: event.target.value })}>
          <option value="">Choose an agent</option>
          {catalog.agents.map(agent => <option key={agent.id} value={agent.id}>{agent.label}</option>)}
          {sessionID && !(catalog.agents.some(agent => agent.id === form.agent))
            && <option value={form.agent}>{form.agent} · existing conversation</option>}
        </select></label>
        <textarea aria-label="Local message" value={form.text} maxLength={65536} disabled={!snapshot.loaded || working || unresolved}
          placeholder="Message Veyra…" onChange={event => update({ text: event.target.value })}
          onKeyDown={event => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing && !event.repeat) {
              event.preventDefault(); if (eligible && !working && !unresolved) void run(false);
            }
          }} />
        <button type="button" disabled={!snapshot.loaded || !eligible || working || unresolved || !form.text.trim() || (!sessionID && !form.agent)}
          onClick={() => { void run(false); }}>{working ? "Checking original…" : journal?.plan ? "Continue prepared original" : "Send message"}</button>
        <p className="native-local-help">Enter to send · Shift+Enter for a new line</p>
      </div>
      <details><summary>Saved local originals</summary>
        <p>These private records can contain your prompt and local paths. They are not an engine transcript.</p>
        {journal?.error && <p>First failure: {journal.error}</p>}
        <pre>{journal ? JSON.stringify(journal, null, 2) : "No retained original is loaded."}</pre>
      </details>
    </section>
  </NativeWorkPresentation>;
}
