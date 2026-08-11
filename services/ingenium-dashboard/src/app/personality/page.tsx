"use client";
export const dynamic = "force-dynamic";
import { useState, useEffect } from "react";
import { useProject } from "../../lib/ProjectContext";
import { api, PersonalityTrait } from "../../lib/api";
import { formatRelativeTime } from "../../lib/time";
import Overlay from "../components/Overlay";
import Select from "../components/Select";

const ESTABLISHED_CONFIDENCE_THRESHOLD = 0.3;
type PersonalityTraitDetails = PersonalityTrait & { metadata?: string };

const TYPE_ICONS: Record<string, string> = {
  communication_style: "💬",
  code_preference: "💻",
  workflow_pattern: "🔄",
  terminology: "📖",
  priority_signal: "🎯",
  feedback_style: "📝",
  interaction_pattern: "⏰",
  domain_knowledge: "🧠",
  learned_skill: "⚡",
  personality_trait: "🌟",
};

function confidencePercent(trait: PersonalityTrait): number {
  return Math.round((trait.confidence || 0) * 100);
}

function ConfidenceBar({ trait, width = "w-20" }: { trait: PersonalityTrait; width?: string }) {
  const percent = confidencePercent(trait);

  return (
    <div
      className={`${width} h-2 bg-[var(--color-border-muted)] rounded-full overflow-hidden`}
      role="progressbar"
      aria-label={`${percent}% confidence`}
      aria-valuemin={0}
      aria-valuemax={100}
      aria-valuenow={percent}
    >
      <div
        className="h-full bg-[var(--color-accent)] rounded-full"
        style={{ width: `${percent}%` }}
      />
    </div>
  );
}

/**
 * PersonalityPage — Learned personality traits from the self-learning pipeline.
 *
 * Traits are generated from observations by the synthesis engine. They have
 * a confidence score (0.0–1.0). Traits at or above the 0.30 threshold are
 * established; active traits below the threshold remain visible as emerging
 * traits so external projects can see what is still awaiting confirmation.
 */
export default function PersonalityPage() {
  const project = useProject();
  const [traits, setTraits] = useState<PersonalityTrait[]>([]);
  const [selectedTrait, setSelectedTrait] = useState<PersonalityTraitDetails | null>(null);
  const [sortMode, setSortMode] = useState<"grouped" | "newest">("grouped");
  const [error, setError] = useState<string | null>(null);
  useEffect(() => {
    api.personality.list(project)
      .then((r) => {
        setError(null);
        setTraits(r.data || []);
      })
      .catch(() => setError("Failed to load personality traits — API may be unreachable"));
  }, [project]);

  // The API contract describes is_active as a boolean, but SQLite-backed
  // responses can still contain 0/1. Treat both false and 0 as inactive.
  const activeTraits = traits.filter((trait) => trait.is_active === undefined || Boolean(trait.is_active));
  const establishedTraits = activeTraits.filter(
    (trait) => (trait.confidence || 0) >= ESTABLISHED_CONFIDENCE_THRESHOLD,
  );
  const emergingTraits = activeTraits.filter(
    (trait) => (trait.confidence || 0) < ESTABLISHED_CONFIDENCE_THRESHOLD,
  );

  const handleDismiss = async (id: number) => {
    const dismissedTrait = traits.find((trait) => trait.id === id);
    setTraits((prev) => prev.filter((trait) => trait.id !== id));
    if (selectedTrait?.id === id) setSelectedTrait(null);

    try {
      await api.personality.dismiss(id, project);
    } catch {
      if (dismissedTrait) {
        setTraits((prev) => prev.some((trait) => trait.id === id) ? prev : [...prev, dismissedTrait]);
      }
      setError("Failed to dismiss personality trait — please try again");
    }
  };

  const grouped = establishedTraits.reduce((acc: Record<string, PersonalityTrait[]>, t: PersonalityTrait) => {
    (acc[t.trait_type] ??= []).push(t);
    return acc;
  }, {});

  const newestEmergingTraits = [...emergingTraits].sort(
    (a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime(),
  );

  return (
    <div className="space-y-6 min-w-0">
      <div className="flex flex-col items-start gap-3 sm:flex-row sm:items-center sm:justify-between">
        <h1 className="min-w-0 break-words text-3xl font-bold">Personality Profile</h1>
        <div className="flex w-full flex-wrap items-center gap-3 sm:w-auto sm:justify-end">
          <span className="text-sm text-[var(--color-text-muted)]">Sort:</span>
          <Select aria-label="Sort personality traits" value={sortMode} onChange={(e) => {
            const nextMode = e.target.value;
            if (nextMode === "grouped" || nextMode === "newest") setSortMode(nextMode);
          }} className="border border-[var(--color-border)] rounded px-3 py-1.5 text-sm bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] cursor-pointer">
            <option value="grouped">Grouped by type</option>
            <option value="newest">Newest first</option>
          </Select>
          <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm text-[var(--color-text-muted)]" role="status" aria-label="Personality trait counts">
            <span>Established: <strong className="text-[var(--color-text-secondary)]">{establishedTraits.length}</strong></span>
            <span>Emerging: <strong className="text-[var(--color-warning-text)]">{emergingTraits.length}</strong></span>
          </div>
        </div>
      </div>

      {emergingTraits.length > 0 && (
        <section
          aria-labelledby="emerging-traits-heading"
          data-testid="emerging-traits-section"
          className="bg-[var(--color-warning-bg)] rounded border border-[var(--color-warning-border)] overflow-hidden"
        >
          <div className="px-4 py-3 border-b border-[var(--color-warning-border)] flex items-start justify-between gap-4">
            <div>
              <h2 id="emerging-traits-heading" className="font-semibold text-[var(--color-warning-text)]">
                Emerging traits — awaiting confirmation
              </h2>
              <p className="text-sm text-[var(--color-warning-text)] mt-1">
                These active traits are visible while they build enough confidence to become established.
              </p>
            </div>
            <span className="shrink-0 rounded-full border border-[var(--color-warning-border)] px-2 py-1 text-xs font-medium text-[var(--color-warning-text)]">
              {emergingTraits.length} emerging
            </span>
          </div>
          <div className="divide-y divide-[var(--color-warning-border)]">
            {newestEmergingTraits.map((t) => (
              <div
                key={t.id}
                data-testid={`emerging-trait-${t.id}`}
                className="flex flex-col items-start gap-3 px-4 py-3 hover:bg-[var(--color-surface-hover)] sm:flex-row sm:items-center sm:justify-between sm:gap-4"
              >
                <button
                  type="button"
                  className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-link)]"
                  onClick={() => setSelectedTrait(t)}
                  aria-label={`View trait ${t.display_label || t.trait_value}`}
                >
                  <span aria-hidden="true">{TYPE_ICONS[t.trait_type] || "📌"}</span>
                  <span className="min-w-0">
                    <span className="flex flex-wrap items-center gap-2">
                      <span className="font-medium break-words">{t.display_label || t.trait_value}</span>
                      <span className="rounded-full border border-[var(--color-warning-border)] px-2 py-0.5 text-xs font-medium text-[var(--color-warning-text)]">
                        Emerging · {confidencePercent(t)}% confidence
                      </span>
                    </span>
                    <span className="text-xs text-[var(--color-warning-text)] capitalize">{t.trait_type?.replace(/_/g, " ")}</span>
                  </span>
                </button>
                <div className="flex w-full items-center justify-end gap-3 sm:w-auto sm:shrink-0">
                  <button type="button" onClick={() => void handleDismiss(t.id)} className="-m-2 p-2 text-lg leading-none text-[var(--color-text-muted)] hover:text-[var(--color-error-text)]" title="Dismiss trait" aria-label="Dismiss trait">&times;</button>
                  <span className="hidden sm:inline text-xs text-[var(--color-warning-text)]">{formatRelativeTime(t.created_at)}</span>
                  <ConfidenceBar trait={t} width="w-16" />
                </div>
              </div>
            ))}
          </div>
        </section>
      )}

      {sortMode === "newest" && establishedTraits.length > 0 && (
        <div className="bg-[var(--color-surface)] rounded border border-[var(--color-border)] divide-y hover:shadow-md transition-shadow">
          {[...establishedTraits]
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .map((t) => (
            <div key={t.id} className="flex flex-col items-start gap-3 px-4 py-3 hover:bg-[var(--color-surface-hover)] sm:flex-row sm:items-center sm:justify-between">
              <button
                type="button"
                className="flex min-w-0 flex-1 items-center gap-3 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-link)]"
                onClick={() => setSelectedTrait(t)}
                aria-label={`View trait ${t.display_label || t.trait_value}`}
              >
                <span>{TYPE_ICONS[t.trait_type] || "📌"}</span>
                <span className="min-w-0">
                  <span className="font-medium break-words">{t.display_label || t.trait_value}</span>
                  <span className="ml-2 text-xs capitalize text-[var(--color-text-muted)]">{t.trait_type?.replace(/_/g, " ")}</span>
                </span>
              </button>
              <div className="flex w-full items-center justify-end gap-3 sm:w-auto sm:shrink-0">
                <button type="button" onClick={() => void handleDismiss(t.id)} className="-m-2 p-2 text-lg leading-none text-[var(--color-text-muted)] hover:text-[var(--color-error-text)]" title="Dismiss trait" aria-label="Dismiss trait">&times;</button>
                <span className="text-xs text-[var(--color-text-muted)]">{formatRelativeTime(t.created_at)}</span>
                <ConfidenceBar trait={t} width="w-16" />
              </div>
            </div>
          ))}
        </div>
      )}

      {error && (
        <div className="bg-[var(--color-error-bg)] border border-[var(--color-error-border)] rounded p-6 text-center text-[var(--color-error-text)] text-sm">
          {error}
        </div>
      )}
      {!error && activeTraits.length === 0 && (
        <div className="bg-[var(--color-surface-muted)] p-8 rounded border border-[var(--color-border)] text-center text-[var(--color-text-muted)]">
          No personality traits learned yet. Traits are generated automatically from observations via the synthesis pipeline.
        </div>
      )}

      {sortMode === "grouped" && Object.entries(grouped).map(([type, typeTraits]) => {
        return (
        <div key={type} className="bg-[var(--color-surface)] rounded border border-[var(--color-border)] overflow-hidden hover:shadow-md transition-shadow">
          <div className="flex items-center gap-2 border-b bg-[var(--color-surface-muted)] px-4 py-2 text-sm font-semibold">
            <span>{TYPE_ICONS[type] || "📌"}</span>
            <span className="capitalize">{type.replace(/_/g, " ")}</span>
          </div>
          <div className="divide-y">
            {(typeTraits as PersonalityTrait[]).map((t: PersonalityTrait) => (
              <div key={t.id} className="flex items-center gap-3 px-4 py-3 hover:bg-[var(--color-surface-hover)]">
                <button
                  type="button"
                  className="min-w-0 flex-1 text-left focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-link)]"
                  onClick={() => setSelectedTrait(t)}
                  aria-label={`View trait ${t.display_label || t.trait_value}`}
                >
                  <span className="block min-w-0">
                    <span className="font-medium break-words">{t.display_label || t.trait_value}</span>
                    {t.exemplar_text && <span className="mt-0.5 block break-words text-xs text-[var(--color-text-muted)]">“{t.exemplar_text.substring(0, 100)}”</span>}
                  </span>
                </button>
                <div className="flex shrink-0 items-center gap-2">
                  <button type="button" onClick={() => void handleDismiss(t.id)} className="-m-2 p-2 text-lg leading-none text-[var(--color-text-muted)] hover:text-[var(--color-error-text)]" title="Dismiss trait" aria-label="Dismiss trait">&times;</button>
                  <ConfidenceBar trait={t} />
                  <span className="w-8 text-xs text-[var(--color-text-muted)]">{confidencePercent(t)}%</span>
                </div>
              </div>
            ))}
          </div>
        </div>
      )})}

      <Overlay isOpen={selectedTrait !== null} onClose={() => setSelectedTrait(null)}
        title={selectedTrait?.display_label || selectedTrait?.trait_value || "Trait Detail"}
        subtitle={`${selectedTrait?.trait_type?.replace(/_/g, " ")} — ${Math.round((selectedTrait?.confidence || 0) * 100)}% confidence`}>
        {selectedTrait && (
          <div className="space-y-4">
            <div className="grid grid-cols-1 gap-4 text-sm sm:grid-cols-2">
              <div className="break-words"><span className="font-semibold">Type:</span> <span className="text-[var(--color-text-secondary)]">{selectedTrait.trait_type}</span></div>
              <div className="break-words"><span className="font-semibold">Value:</span> <span className="text-[var(--color-text-secondary)]">{selectedTrait.trait_value}</span></div>
              <div className="break-words"><span className="font-semibold">Confidence:</span> <span className="text-[var(--color-text-secondary)]">{Math.round((selectedTrait.confidence || 0) * 100)}%</span></div>
              <div className="break-words"><span className="font-semibold">Source:</span> <span className="text-[var(--color-text-secondary)]">{selectedTrait.source}</span></div>
            </div>
            {selectedTrait.exemplar_text && (
              <div>
                <h3 className="font-semibold mb-1">Exemplar</h3>
                <pre className="overflow-x-auto break-words rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4 text-sm whitespace-pre-wrap">{selectedTrait.exemplar_text}</pre>
              </div>
            )}
            {selectedTrait.metadata && (
              <div>
                <h3 className="font-semibold mb-1">Metadata</h3>
                <pre className="overflow-x-auto break-all rounded border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-4 text-xs font-mono whitespace-pre-wrap">{selectedTrait.metadata}</pre>
              </div>
            )}
            <div className="flex gap-2 pt-2">
              <button onClick={() => { handleDismiss(selectedTrait.id); setSelectedTrait(null); }} className="text-sm text-red-500 hover:text-[var(--color-error-text)]">Dismiss trait</button>
            </div>
          </div>
        )}
      </Overlay>
    </div>
  );
}
