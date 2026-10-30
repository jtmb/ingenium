import { useEffect, useLayoutEffect, useMemo, useRef, useState } from "react";
import type { Gateway } from "../../../platform/types";
import { createLocalTransport, same, type LocalIdentity } from "./local-protocol.mjs";
import { environmentSelections, identityFromContext, type LocalEnvironmentSelection } from "./local-observations.mjs";
import { browserOriginalStore } from "./local-original-store.mjs";
import { localFlows } from "./local-flow-index.mjs";
import { LocalChatController } from "./local-chat-controller.mjs";
import { LocalChatPanel } from "./LocalChatPanel";

/** No browser OS, default distro/user, Snapshot identity or Project ownership. */
export function LocalChatEntry({ gateway, available, connectionEpoch, startVersion = 0 }: {
  gateway: Pick<Gateway, "workbench">; available: boolean; connectionEpoch?: string | null; startVersion?: number;
}) {
  const transport = useMemo(() => createLocalTransport(gateway), [gateway]);
  const [storage] = useState(() => {
    try { return { store: browserOriginalStore(), error: null }; }
    catch { return { store: null, error: "Private chat storage is unavailable. Nothing was sent." }; }
  });
  const store = storage.store;
  const [context, setContext] = useState<LocalIdentity | null>(null), [flows, setFlows] = useState<string[]>([]);
  const [choices, setChoices] = useState<LocalEnvironmentSelection[]>([]), source = useRef<unknown>(null);
  const [selected, setSelected] = useState<string | null>(null), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const epoch = useRef(0), creating = useRef(false);
  useLayoutEffect(() => { epoch.current++; setContext(null); setSelected(null); setChoices([]); setFlows([]); setBusy(false); return () => { epoch.current++; }; }, [transport, available, connectionEpoch]);
  const adoptEnvironment = async (reply: unknown, candidate: LocalEnvironmentSelection, captured: number) => {
    const actual = identityFromContext(reply, candidate.environment), saved = await localFlows(store!, actual);
    if (captured === epoch.current) { setContext(actual); setFlows(saved); setSelected(saved.at(-1) ?? null); }
  };
  const readContext = async () => {
    if (!available || !store) return;
    const captured = ++epoch.current; setBusy(true); setError(null); setContext(null); setSelected(null); setChoices([]);
    try {
      const reply = await transport.readContext(() => captured === epoch.current), selection = environmentSelections(reply);
      if (captured !== epoch.current) return;
      source.current = reply; setChoices(selection.environments);
      const candidate = selection.environments.find(entry => same(entry.environment, selection.default_environment));
      if (candidate) await adoptEnvironment(reply, candidate, captured);
    } catch (cause) { if (captured === epoch.current) setError(cause instanceof Error ? cause.message : "Local chats are unavailable."); }
    finally { if (captured === epoch.current) setBusy(false); }
  };
  useEffect(() => { void readContext(); }, [transport, available, store, connectionEpoch]);
  const create = async () => {
    if (!context || busy || !store || creating.current) return;
    const captured = epoch.current; creating.current = true; setBusy(true); setError(null);
    try {
      const id = crypto.randomUUID(), saved = await localFlows(store, context, id);
      if (captured === epoch.current) { epoch.current++; setBusy(false); setFlows(saved); setSelected(id); }
    } catch (cause) { if (captured === epoch.current) setError(cause instanceof Error ? cause.message : "This chat could not be saved."); }
    finally { creating.current = false; if (captured === epoch.current) setBusy(false); }
  };
  // A root sidebar request creates only a retained selection, no workspace/effect.
  const started = useRef(0);
  useEffect(() => { if (startVersion !== started.current && context && !busy) { started.current = startVersion; void create(); } }, [startVersion, context, busy]);
  const controller = useMemo(() => {
    if (!context || !selected || !store) return null;
    const captured = epoch.current;
    return new LocalChatController({ identity: context, flowID: selected, store, transport, current: () => captured === epoch.current });
  }, [context, selected, store, transport]);
  return <section aria-label="Local chats">
    <div role="group" aria-label="Local chat selection">
      {choices.length > 0 && <label>Run in <select aria-label="Local chat environment" value={context ? JSON.stringify(context.environment) : ""} disabled={busy} onChange={event => {
        const candidate = choices.find(entry => JSON.stringify(entry.environment) === event.target.value);
        if (!candidate || !source.current) return;
        const captured = ++epoch.current; setContext(null); setSelected(null); setBusy(true); setError(null);
        void adoptEnvironment(source.current, candidate, captured).catch(cause => { if (captured === epoch.current) setError(cause instanceof Error ? cause.message : "This environment is unavailable."); }).finally(() => { if (captured === epoch.current) setBusy(false); });
      }}><option value="">Choose an environment</option>{choices.map(entry => <option key={JSON.stringify(entry.environment)} value={JSON.stringify(entry.environment)}>{entry.label}</option>)}</select></label>}
      <button type="button" disabled={!context || busy} onClick={() => { void create(); }}>New local chat</button>
      {context && flows.length > 0 && <label>Chat <select aria-label="Saved local chat" value={selected ?? ""} disabled={busy} onChange={event => { epoch.current++; setSelected(event.target.value || null); }}>
        <option value="">Choose a chat</option>{flows.map((id, index) => <option key={id} value={id}>Local chat {index + 1}</option>)}</select></label>}
    </div>
    {busy && <p role="status">Checking local chat availability…</p>}
    {!busy && !error && available && choices.length === 0 && <p role="status">No local environment is available. Existing chats and drafts are kept.</p>}
    {!available && <p role="status">Reconnect Veyra to open local chats. Existing drafts are kept.</p>}
    {(error || storage.error) && <p role="alert">{error ?? storage.error}</p>}
    <details><summary>Connection details</summary><p>Environment choices come from verified Windows custody or saved environments. They do not establish engine readiness.</p>
      <button type="button" disabled={!available || !store || busy} onClick={() => { void readContext(); }}>Check connection again</button></details>
    {controller && <LocalChatPanel controller={controller} admission={context ? { kind: "observed", identity: context, canRequest: available, message: "This chat is not ready to send. Your draft is kept." } : { kind: "unavailable", message: "Local chats are unavailable." }} />}
  </section>;
}
