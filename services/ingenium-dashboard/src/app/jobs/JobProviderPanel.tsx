"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { api, type Job, type JobProviderState } from "@/lib/api";
import StepUpDialog from "../components/auth/StepUpDialog";

export default function JobProviderPanel({ job, project, onUpdated, busy }: {
  job: Job; project: string; onUpdated: (job: Job) => void; busy: boolean;
}) {
  const [state, setState] = useState<JobProviderState | null>(null);
  const [model, setModel] = useState("");
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pending, setPending] = useState<{ modelId: string | null; revision: number; generation: number } | null>(null);
  const [reload, setReload] = useState(0);
  const generation = useRef(0);
  useEffect(() => {
    const current = ++generation.current;
    const controller = new AbortController();
    setState(null); setModel(""); setError(null); setLoading(true); setPending(null); setSaving(false);
    void api.jobs.provider(job.id, project, controller.signal).then((response) => {
      if (current !== generation.current) return;
      setState(response.data);
      const selected = response.data.connection?.modelId ?? response.data.defaultModel;
      setModel(response.data.models.some((item) => item.id === selected) ? selected! : "");
    }).catch((failure: unknown) => {
      if (current === generation.current && !controller.signal.aborted) {
        setError(failure instanceof Error ? failure.message : "Provider setup could not be loaded.");
      }
    }).finally(() => { if (current === generation.current) setLoading(false); });
    return () => { generation.current++; controller.abort(); };
  }, [job.id, job.revision, project, reload]);

  const closeConfirmation = useCallback(() => setPending(null), []);
  const save = async () => {
    if (!pending || pending.generation !== generation.current) return;
    const current = generation.current;
    const choice = pending;
    setPending(null); setSaving(true); setError(null);
    try {
      const response = await api.jobs.configureProvider(job.id, choice.modelId, choice.revision, project);
      if (current !== generation.current) return;
      onUpdated(response.data.job);
      setReload((value) => value + 1);
    } catch (failure: unknown) {
      if (current === generation.current) setError(failure instanceof Error ? failure.message : "Provider setup could not be saved.");
    } finally { if (current === generation.current) setSaving(false); }
  };
  const refresh = async () => {
    setError(null);
    const current = generation.current;
    try {
      const latest = await api.jobs.get(job.id, project);
      if (current !== generation.current) return;
      onUpdated(latest.data);
      setReload((value) => value + 1);
    } catch (failure: unknown) {
      if (current === generation.current) setError(failure instanceof Error ? failure.message : "Job could not be reloaded.");
    }
  };
  const managed = state?.connection?.kind === "managed";
  return <section aria-label="Job provider" className="rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4 space-y-3">
    <div className="flex flex-wrap items-center justify-between gap-2">
      <h2 className="font-medium text-[var(--color-text-primary)]">Provider for this job</h2>
      <button type="button" onClick={() => void refresh()} disabled={loading || saving}
        className="rounded border border-[var(--color-border)] px-3 py-1 text-xs disabled:opacity-50">Reload job and provider</button>
    </div>
    {error && <p role="alert" className="text-sm text-[var(--color-error-text)]">{error}</p>}
    {loading ? <p role="status">Loading provider setup…</p> : state && <>
      <p className="text-sm">{state.connection?.authorized
        ? "Authorized: " + state.connection.providerId + (state.connection.modelId ? " / " + state.connection.modelId : "")
        : "No active provider access for this job."}</p>
      {managed ? <p className="text-sm text-[var(--color-text-muted)]">This job uses an existing managed provider connection.</p> : <>
        <p className="text-sm text-[var(--color-text-muted)]">Free Zen runs without an API key. This choice applies only to this job; model defaults stay unchanged. Provider usage limits still apply.</p>
        {!state.agentAvailable && <p role="alert">The selected project agent is unavailable. Select an enabled agent before configuring this provider.</p>}
        {!state.catalogAvailable && <p role="status">The free Zen catalog is unavailable. Reload to try again.</p>}
        {state.catalogAvailable && state.models.length === 0 && <p role="status">No active free Zen models are available.</p>}
        <label className="block text-sm font-medium" htmlFor="job-provider-model">Free Zen model</label>
        <select id="job-provider-model" value={model} onChange={(event) => setModel(event.target.value)}
          disabled={!state.catalogAvailable || saving || busy}
          className="w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm">
          <option value="">Select a model</option>
          {state.models.map((item) => <option key={item.id} value={item.id}>{item.label}</option>)}
        </select>
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={!model || !state.agentAvailable || saving || busy}
            onClick={() => setPending({ modelId: model, revision: job.revision, generation: generation.current })}
            className="rounded bg-blue-600 px-3 py-2 text-sm text-white disabled:opacity-50">Authorize Free Zen for this job</button>
          {state.connection?.kind === "anonymous" && <button type="button" disabled={saving || busy}
            onClick={() => setPending({ modelId: null, revision: job.revision, generation: generation.current })}
            className="rounded border border-[var(--color-border)] px-3 py-2 text-sm disabled:opacity-50">Revoke provider access</button>}
        </div>
        {busy && <p className="text-xs text-[var(--color-text-muted)]">Finish or cancel the active run before changing its provider.</p>}
        {saving && <p role="status">Saving provider setup…</p>}
      </>}
    </>}
    <StepUpDialog open={pending !== null} onClose={closeConfirmation} onComplete={() => void save()} />
  </section>;
}
