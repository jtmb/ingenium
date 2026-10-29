"use client";

import { useEffect, useState } from "react";
import { createOpenCodeClient } from "../../../../lib/opencode";

import type { ChatConfigResponse, ChatSelection } from "../../../../lib/api";
import SettingRow from "../SettingRow";
import Select from "../../Select";

const globalChat = createOpenCodeClient(null).chat;

export default function ChatDefaults() {
  const [config, setConfig] = useState<ChatConfigResponse | null>(null);
  const [draft, setDraft] = useState<ChatSelection>({ providerId: "", modelId: "" });
  const [error, setError] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [loading, setLoading] = useState(true);
  const [attempt, setAttempt] = useState(0);
  useEffect(() => {
    let current = true;
    setLoading(true); setError("");
    globalChat.config().then(result => {
      if (!current) return;
      setConfig(result);
      setDraft(result.defaultSelection ?? { providerId: "", modelId: "" });
    }).catch(() => { if (current) setError("Chat defaults could not be loaded."); })
      .finally(() => { if (current) setLoading(false); });
    return () => { current = false; };
  }, [attempt]);
  const provider = config?.providers.find(item => item.providerId === draft.providerId);
  const model = provider?.models.find(item => item.id === draft.modelId);
  const variants = Object.keys(model?.variants ?? {});
  function change(next: ChatSelection) { setDraft(next); setSaved(false); setError(""); }
  async function save() {
    setSaving(true); setError(""); setSaved(false);
    try { await globalChat.saveDefaults(draft); setSaved(true); window.dispatchEvent(new Event("veyra-chat-defaults-changed")); }
    catch { setError("Unable to confirm whether Chat defaults were saved. Reload to check before retrying."); }
    finally { setSaving(false); }
  }
  return <section aria-label="Chat defaults" className="min-w-0">
    <div className="px-6 pt-5 pb-2"><h3 className="text-sm font-medium text-[var(--color-text-primary)]">Chat defaults</h3>
      <p className="text-xs text-[var(--color-text-muted)] mt-1">Used for new conversations. Each conversation keeps its own choices.</p></div>
    {loading ? <p role="status" className="px-6 py-3 text-sm">Loading Chat defaults…</p> : <>
      <SettingRow label="Provider" controlId="chat-default-provider"><Select className="max-w-64 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] disabled:opacity-40" id="chat-default-provider" value={draft.providerId} disabled={saving || !config?.providers.length}
        onChange={event => { const next = config?.providers.find(p => p.providerId === event.target.value);
          if (next) change({ providerId: next.providerId, modelId: next.defaultModel }); }}>
        {!provider && <option value="">Choose a provider</option>}
        {config?.providers.map(p => <option key={p.providerId} value={p.providerId}>{p.label}</option>)}
      </Select></SettingRow>
      <SettingRow label="Model" controlId="chat-default-model"><Select className="max-w-64 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] disabled:opacity-40" id="chat-default-model" value={draft.modelId} disabled={saving || !provider}
        onChange={event => change({ providerId: draft.providerId, modelId: event.target.value })}>
        {!model && <option value="">Choose a model</option>}
        {provider?.models.map(m => <option key={m.id} value={m.id}>{m.label}</option>)}
      </Select></SettingRow>
      <SettingRow label="Reasoning effort" controlId="chat-default-effort" description={variants.length ? "Choose from the efforts supported by this model." : "This model does not advertise reasoning effort choices."}>
        <Select className="max-w-64 w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] disabled:opacity-40" id="chat-default-effort" value={draft.variant ?? ""} disabled={saving || !variants.length}
          onChange={event => change({ providerId: draft.providerId, modelId: draft.modelId, ...(event.target.value ? { variant: event.target.value } : {}) })}>
          <option value="">Model default</option>{variants.map(key => <option key={key} value={key}>{key}</option>)}
        </Select>
      </SettingRow>
      <div className="px-6 py-3 flex flex-wrap items-center gap-3">
        <button type="button" disabled={saving || !model} onClick={() => void save()} className="rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm disabled:opacity-40">{saving ? "Saving…" : "Save Chat defaults"}</button>
        {saved && <p role="status" className="text-sm text-[var(--color-text-secondary)]">Chat defaults saved.</p>}
      </div>
    </>}
    {error && <div role="alert" className="px-6 pb-3 text-sm text-[var(--color-error-text)]">{error}
      {!config && <button type="button" className="ml-3 underline" onClick={() => setAttempt(value => value + 1)}>Retry Chat defaults</button>}
    </div>}
  </section>;
}
