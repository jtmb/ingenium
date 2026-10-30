import { useLayoutEffect, useMemo, useRef, useState } from "react";
import type { LocalEnvironment } from "@veyra/contracts";
import type { Gateway } from "../../../platform/types";
import { createLocalTransport, type LocalIdentity } from "./local-protocol.mjs";
import { identityFromContext } from "./local-observations.mjs";
import { browserOriginalStore } from "./local-original-store.mjs";
import { localFlows } from "./local-flow-index.mjs";
import { LocalChatController } from "./local-chat-controller.mjs";
import { LocalChatPanel } from "./LocalChatPanel";

/** Root supplies its genuinely selected OS environment and custody availability.
 * Snapshot service identity and default distro/user are never substitutes. */
export function LocalChatEntry({ gateway, selectedEnvironment, available }: {
  gateway: Pick<Gateway, "workbench">; selectedEnvironment: LocalEnvironment | null; available: boolean;
}) {
  const transport = useMemo(() => createLocalTransport(gateway), [gateway]);
  const [storage] = useState(() => {
    try { return { store: browserOriginalStore(), error: null }; }
    catch { return { store: null, error: "Private original storage is unavailable. No local allocation or prompt was sent." }; }
  });
  const store = storage.store;
  const [context, setContext] = useState<LocalIdentity | null>(null), [flows, setFlows] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(null), [error, setError] = useState<string | null>(null), [busy, setBusy] = useState(false);
  const epoch = useRef(0), environmentKey = JSON.stringify(selectedEnvironment);
  useLayoutEffect(() => { epoch.current++; setContext(null); setSelected(null); setFlows([]); setBusy(false); return () => { epoch.current++; }; }, [transport, environmentKey, available]);
  const readContext = async () => {
    if (!available || !selectedEnvironment || !store) return;
    const captured = ++epoch.current; setBusy(true); setError(null); setContext(null); setSelected(null);
    const current = () => captured === epoch.current;
    try {
      const actual = identityFromContext(await transport.readContext(current), selectedEnvironment);
      const saved = await localFlows(store, actual);
      if (current()) { setContext(actual); setFlows(saved); setSelected(saved.at(-1) ?? null); }
    } catch (cause) { if (current()) setError(cause instanceof Error ? cause.message : "Local context unavailable."); }
    finally { if (current()) setBusy(false); }
  };
  const create = async () => {
    if (!context || busy || !store) return;
    const captured = epoch.current; setBusy(true); setError(null);
    try {
      const id = crypto.randomUUID(), saved = await localFlows(store, context, id);
      if (captured === epoch.current) { epoch.current++; setBusy(false); setFlows(saved); setSelected(id); }
    } catch (cause) { if (captured === epoch.current) setError(cause instanceof Error ? cause.message : "The local original could not be retained."); }
    finally { if (captured === epoch.current) setBusy(false); }
  };
  const controller = useMemo(() => {
    if (!context || !selected || !store) return null;
    const captured = epoch.current;
    return new LocalChatController({ identity: context, flowID: selected, store, transport, current: () => captured === epoch.current });
  }, [context, selected, store, transport]);
  return <>
    <div role="group" aria-label="Private local chat selection">
      <button type="button" disabled={!available || !selectedEnvironment || !store || busy} onClick={() => { void readContext(); }}>Read local ownership</button>
      <button type="button" disabled={!context || busy} onClick={() => { void create(); }}>New local chat</button>
      {context && <label>Retained local chat <select value={selected ?? ""} disabled={busy} onChange={event => { epoch.current++; setSelected(event.target.value || null); }}>
        <option value="">Choose a retained original</option>{flows.map((id, index) => <option key={id} value={id}>Local chat {index + 1} · {id.slice(-8)}</option>)}
      </select></label>}
    </div>
    {(error || storage.error) && <p role="alert">{error ?? storage.error}</p>}
    <LocalChatPanel controller={controller} admission={context ? { kind: "observed", identity: context, canRequest: available, message: "Read this private workspace's runtime before sending." } : { kind: "unavailable", message: "Read actual local ownership before selecting a chat." }} />
  </>;
}
