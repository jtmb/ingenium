"use client";
export const dynamic = "force-dynamic";
import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import { useProject } from "../../lib/ProjectContext";
import { api, Observation } from "../../lib/api";
import Overlay from "../components/Overlay";

const TYPE_COLORS: Record<string, string> = {
  correction: "bg-red-100 text-[var(--color-error-text)]",
  preference: "bg-purple-100 text-purple-700",
  pattern: "bg-[var(--color-success-bg)] text-green-700",
  insight: "bg-blue-100 text-blue-700",
  feedback: "bg-yellow-100 text-yellow-700",
  behavior: "bg-orange-100 text-orange-700",
  terminology: "bg-indigo-100 text-indigo-700",
  workflow: "bg-teal-100 text-teal-700",
  error: "bg-red-200 text-red-800",
  goal: "bg-pink-100 text-pink-700",
};

const STATUS_COLORS: Record<string, string> = {
  pending: "bg-yellow-100 text-yellow-700",
  processed: "bg-[var(--color-success-bg)] text-green-700",
  skipped: "bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]",
  failed: "bg-red-100 text-[var(--color-error-text)]",
};

function safeParseJson(raw: string | undefined | null): object | null {
  if (!raw) return null;
  try {
    return JSON.parse(raw);
  } catch {
    return null;
  }
}

export default function ObservationsPage() {
  const router = useRouter();
  const project = useProject();
  const [observations, setObservations] = useState<Observation[]>([]);
  const [statusFilter, setStatusFilter] = useState("");
  const [typeFilter, setTypeFilter] = useState("");
  const [selected, setSelected] = useState<any>(null);
  const [stats, setStats] = useState({ total: 0, pending: 0 });
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setError(null);
    api.observations.list(project, statusFilter, typeFilter)
      .then((r) => setObservations(r.data || []))
      .catch(() => setError("Failed to load observations — API may be unreachable"));
    api.observations.stats(project)
      .then((r) => setStats(r.data || { total: 0, pending: 0 }))
      .catch(() => { /* stats are non-critical */ });
  }, [project, statusFilter, typeFilter]);

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Observations</h1>
        <div className="text-sm text-[var(--color-text-muted)] space-x-4">
          <span>Total: <strong>{stats.total}</strong></span>
          <span>Pending: <strong className="text-yellow-600">{stats.pending}</strong></span>
        </div>
      </div>

      <div className="flex gap-2">
        <select value={statusFilter} onChange={(e) => setStatusFilter(e.target.value)} className="border p-2 rounded text-sm hover:bg-[var(--color-surface-hover)] cursor-pointer">
          <option value="">All statuses</option>
          <option value="pending">Pending</option>
          <option value="processed">Processed</option>
          <option value="skipped">Skipped</option>
          <option value="failed">Failed</option>
        </select>
        <select value={typeFilter} onChange={(e) => setTypeFilter(e.target.value)} className="border p-2 rounded text-sm hover:bg-[var(--color-surface-hover)] cursor-pointer">
          <option value="">All types</option>
          <option value="correction">Correction</option>
          <option value="preference">Preference</option>
          <option value="pattern">Pattern</option>
          <option value="insight">Insight</option>
          <option value="feedback">Feedback</option>
          <option value="behavior">Behavior</option>
          <option value="terminology">Terminology</option>
          <option value="workflow">Workflow</option>
          <option value="error">Error</option>
          <option value="goal">Goal</option>
        </select>
      </div>

      <div className="space-y-2">
        {error && (
          <div className="bg-[var(--color-error-bg)] border border-[var(--color-error-border)] rounded p-6 text-center text-[var(--color-error-text)] text-sm">
            {error}
          </div>
        )}
        {!error && observations.length === 0 && (
          <div className="bg-[var(--color-surface-muted)] p-8 rounded border border-[var(--color-border)] text-center text-[var(--color-text-muted)]">
            No observations yet. The agent will record observations automatically during interactions.
          </div>
        )}
        {observations.map((o: Observation) => (
          <div
            key={o.id}
            className="bg-[var(--color-surface)] p-4 rounded border border-[var(--color-border)] cursor-pointer hover:shadow-md transition-shadow group"
            onClick={() => setSelected(o)}
          >
            <div className="flex gap-2 items-center mb-1 flex-wrap">
              <span className={`text-xs px-2 py-0.5 rounded ${TYPE_COLORS[o.observation_type] || "bg-[var(--color-surface-muted)] text-[var(--color-text-primary)]"}`}>
                {o.observation_type}
              </span>
              <span className={`text-xs px-2 py-0.5 rounded ${STATUS_COLORS[o.status] || ""}`}>{o.status}</span>
              <span className="text-xs text-[var(--color-text-muted)]">{new Date(o.created_at).toLocaleString()}</span>
              {o.importance && <span className="text-xs text-[var(--color-text-muted)]">Importance: {o.importance}/10</span>}
              <span className="ml-auto opacity-0 group-hover:opacity-100 transition-opacity">
                <button
                  onClick={(e) => {
                    e.stopPropagation();
                    router.push(`/observations/${o.id}`);
                  }}
                  className="text-xs text-[var(--color-text-link)] hover:text-blue-800 underline"
                  title="View full details"
                >
                  Open
                </button>
              </span>
            </div>
            <p className="text-sm">{o.content}</p>
            {o.context && <pre className="text-xs text-[var(--color-text-muted)] mt-1 truncate">{o.context}</pre>}
          </div>
        ))}
      </div>

      <Overlay isOpen={selected !== null} onClose={() => setSelected(null)} title={`Observation #${selected?.id ?? ""}`}
        subtitle={selected?.observation_type ? `Type: ${selected.observation_type}` : undefined}>
        {selected && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="font-semibold">Type:</span> <span className={`inline-block px-2 py-0.5 rounded text-xs ${TYPE_COLORS[selected.observation_type] || ""}`}>{selected.observation_type}</span></div>
              <div><span className="font-semibold">Status:</span> <span className={`inline-block px-2 py-0.5 rounded text-xs ${STATUS_COLORS[selected.status] || ""}`}>{selected.status}</span></div>
              <div><span className="font-semibold">Importance:</span> <span className="text-[var(--color-text-secondary)]">{selected.importance ?? 5}/10</span></div>
              <div><span className="font-semibold">Source:</span> <span className="text-[var(--color-text-secondary)]">{selected.source || "agent"}</span></div>
              <div><span className="font-semibold">Created:</span> <span className="text-[var(--color-text-secondary)]">{new Date(selected.created_at).toLocaleString()}</span></div>
            </div>
            <div>
              <h3 className="font-semibold mb-1">Content</h3>
              <pre className="bg-[var(--color-surface-muted)] p-4 rounded border border-[var(--color-border)] overflow-x-auto text-sm font-mono whitespace-pre-wrap">{selected.content}</pre>
            </div>
            {selected.context && (
              <div>
                <h3 className="font-semibold mb-1">Context</h3>
                {(() => {
                  const parsed = safeParseJson(selected.context);
                  return parsed ? (
                    <pre className="bg-[var(--color-surface-muted)] p-4 rounded border border-[var(--color-border)] overflow-x-auto text-xs font-mono">{JSON.stringify(parsed, null, 2)}</pre>
                  ) : (
                    <pre className="bg-[var(--color-surface-muted)] p-4 rounded border border-[var(--color-border)] overflow-x-auto text-xs font-mono whitespace-pre-wrap text-[var(--color-text-secondary)]">{selected.context}</pre>
                  );
                })()}
              </div>
            )}
          </div>
        )}
      </Overlay>
    </div>
  );
}
