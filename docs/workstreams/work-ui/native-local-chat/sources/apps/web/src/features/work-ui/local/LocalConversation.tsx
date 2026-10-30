import { useEffect, useRef, useState } from "react";
import type { LocalWorkspaceOwner } from "@veyra/contracts";
import type { LocalChatController } from "./local-chat-controller.mjs";
import { readConversation, type ConversationRead } from "./local-observations.mjs";

/** Actual normalized read projection, never client originals masquerading as chat. */
export function LocalConversation({ controller, owner, sessionID, locked, refreshVersion = 0 }: {
  controller: LocalChatController; owner: LocalWorkspaceOwner; sessionID: string; locked: boolean; refreshVersion?: number;
}) {
  const [view, setView] = useState<ConversationRead | null>(null), [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false), epoch = useRef(0);
  const ownerKey = JSON.stringify(owner);
  useEffect(() => { setView(null); void load(); return () => { epoch.current++; }; }, [controller, ownerKey, sessionID, refreshVersion]);
  const load = async (cursor: string | null = null) => {
    const captured = ++epoch.current; setBusy(true); setError(null);
    try {
      const value = await readConversation(controller.transport, owner, sessionID, () => captured === epoch.current && controller.current(), cursor);
      if (captured === epoch.current) setView(value);
    } catch (cause) { if (captured === epoch.current) { setView(null); setError(cause instanceof Error ? cause.message : "Conversation read unavailable."); } }
    finally { if (captured === epoch.current) setBusy(false); }
  };
  const stop = async () => {
    setBusy(true); setError(null);
    try { await controller.control({ kind: "session_interrupt", session_id: sessionID }); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : "Stop outcome is unknown. Check the original receipt."); }
    finally { setBusy(false); }
  };
  return <section aria-label="Observed local conversation">
    <button type="button" disabled={busy} onClick={() => { void load(); }}>Refresh conversation</button>
    {error && <p role="alert">{error}</p>}
    {!view && <p role="status">Read the current conversation to show its actual messages and activity.</p>}
    {view && <>
      <p role="status">{view.status.running ? "Conversation running" : "Conversation idle"} · {view.runtime.ready ? "Engine protocol ready" : "Engine unavailable"}</p>
      <button type="button" disabled={busy || locked || !view.status.running} onClick={() => { void stop(); }}>Stop current conversation</button>
      <p>Stop concerns current conversation activity. Terminal retirement and an exact turn are not confirmed.</p>
      <ol aria-label="Messages in server order">{view.page.data.map(message => <li key={message.id}>
        <strong>{message.type}</strong>{message.status && <span> · {message.status}</span>}
        {message.text !== null && <p style={{ whiteSpace: "pre-wrap" }}>{message.text}</p>}
        {(message.content.length > 0 || message.error) && <details><summary>Message details</summary><pre>{JSON.stringify({ content: message.content, error: message.error, reason: message.reason, outcome: message.outcome }, null, 2)}</pre></details>}
      </li>)}</ol>
      <p>This bounded page follows server order. A cursor does not prove older messages exist.</p>
      {view.page.cursor.next && <button type="button" disabled={busy} onClick={() => { void load(view.page.cursor.next); }}>Read next cursor page</button>}
      {view.page.cursor.previous && <button type="button" disabled={busy} onClick={() => { void load(view.page.cursor.previous); }}>Read previous cursor page</button>}
    </>}
  </section>;
}
