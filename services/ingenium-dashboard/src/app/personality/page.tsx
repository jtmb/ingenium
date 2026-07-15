"use client";
export const dynamic = "force-dynamic";
import { useState, useEffect } from "react";
import { useProject } from "../../lib/ProjectContext";
import { api, PersonalityTrait } from "../../lib/api";
import Overlay from "../components/Overlay";
import PageProjectBar from "../components/PageProjectBar";

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

export default function PersonalityPage() {
  const project = useProject();
  const [traits, setTraits] = useState<PersonalityTrait[]>([]);
  const [profile, setProfile] = useState<any>(null);
  const [selectedTrait, setSelectedTrait] = useState<any>(null);
  const [sortMode, setSortMode] = useState<"grouped" | "newest">("grouped");
  const [showHidden, setShowHidden] = useState(false);
  const [error, setError] = useState<string | null>(null);

  function formatRelative(iso: string): string {
    const diff = Date.now() - new Date(iso).getTime();
    const sec = Math.abs(Math.floor(diff / 1000));
    if (sec < 60) return `${sec}s ago`;
    const min = Math.floor(sec / 60);
    if (min < 60) return `${min}m ago`;
    const hrs = Math.floor(min / 60);
    if (hrs < 24) return `${hrs}h ago`;
    return `${Math.floor(hrs / 24)}d ago`;
  }

  useEffect(() => {
    setError(null);
    api.personality.list(project)
      .then((r) => setTraits(r.data || []))
      .catch(() => setError("Failed to load personality traits — API may be unreachable"));
    api.personality.profile(project)
      .then((r) => setProfile(r.data || []))
      .catch(() => { /* profile is supplementary */ });
  }, [project]);

  const hiddenCount = traits.filter(t => (t.confidence || 0) < 0.3).length;

  const handleDismiss = async (id: number) => {
    try {
      await api.personality.dismiss(id, project);
      setTraits(prev => prev.map(t => t.id === id ? { ...t, is_active: false } : t));
    } catch {}
  };

  const grouped = traits.reduce((acc: Record<string, PersonalityTrait[]>, t: PersonalityTrait) => {
    (acc[t.trait_type] ??= []).push(t);
    return acc;
  }, {});

  const allHidden = Object.keys(grouped).length > 0 && Object.values(grouped).every(
    (typeTraits) => (typeTraits as PersonalityTrait[]).filter(t => (t.confidence || 0) >= 0.3).length === 0
  );

  return (
    <div className="space-y-6">
      <PageProjectBar />
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Personality Profile</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-[var(--color-text-muted)]">Sort:</span>
          <select value={sortMode} onChange={(e) => setSortMode(e.target.value as any)} className="border border-[var(--color-border)] rounded px-3 py-1.5 text-sm bg-[var(--color-surface)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] cursor-pointer">
            <option value="grouped">Grouped by type</option>
            <option value="newest">Newest first</option>
          </select>
          <span className="text-sm text-[var(--color-text-muted)]">
            {traits.filter(t => (t.confidence || 0) >= 0.3).length} trait(s)
            {hiddenCount > 0 && (
              <button onClick={() => setShowHidden(!showHidden)} className="ml-2 text-sm text-[var(--color-text-link)] font-medium hover:underline cursor-pointer">
                {showHidden ? "Hide" : `${hiddenCount} hidden`}
              </button>
            )}
          </span>
        </div>
      </div>

      {sortMode === "newest" && (
        <div className="bg-[var(--color-surface)] rounded border border-[var(--color-border)] divide-y hover:shadow-md transition-shadow">
          {[...traits]
            .filter(t => showHidden || (t.confidence || 0) >= 0.3)
            .sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime())
            .map((t) => (
            <div key={t.id} className="px-4 py-3 cursor-pointer hover:bg-[var(--color-surface-hover)] flex justify-between items-center" onClick={() => setSelectedTrait(t)}>
              <div className="flex items-center gap-3">
                <span>{TYPE_ICONS[t.trait_type] || "📌"}</span>
                <div>
                  <span className="font-medium">{t.display_label || t.trait_value}</span>
                  <span className="text-xs text-[var(--color-text-muted)] ml-2 capitalize">{t.trait_type?.replace(/_/g, " ")}</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <button onClick={(e) => { e.stopPropagation(); handleDismiss(t.id); }} className="text-gray-300 hover:text-red-500 text-lg leading-none" title="Dismiss trait">&times;</button>
                <span className="text-xs text-[var(--color-text-muted)]">{formatRelative(t.created_at)}</span>
                <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(t.confidence || 0) * 100}%` }} />
                </div>
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
      {!error && sortMode === "grouped" && Object.entries(grouped).length === 0 && (
        <div className="bg-[var(--color-surface-muted)] p-8 rounded border border-[var(--color-border)] text-center text-[var(--color-text-muted)]">
          No personality traits learned yet. Traits are generated automatically from observations via the synthesis pipeline.
        </div>
      )}

      {sortMode === "grouped" && allHidden && !showHidden && (
        <div className="bg-[var(--color-warning-bg)] border border-[var(--color-warning-border)] rounded p-6 text-center">
          <p className="text-[var(--color-warning-text)] font-medium mb-2">
            {Object.keys(grouped).length} trait type(s) found, but all below the display threshold.
          </p>
          <p className="text-[var(--color-warning-text)] text-sm mb-3">
            Traits need 2+ confirming observations to reach the 0.30 display threshold (confidence ≥ 30%).
          </p>
          <button onClick={() => setShowHidden(true)} className="px-4 py-2 bg-amber-100 text-[var(--color-warning-text)] rounded text-sm font-medium hover:bg-amber-200">
            Show all ({hiddenCount} hidden)
          </button>
        </div>
      )}

      {sortMode === "grouped" && Object.entries(grouped).map(([type, typeTraits]) => {
        const visibleTraits = (typeTraits as PersonalityTrait[]).filter(t => showHidden || (t.confidence || 0) >= 0.3);
        if (visibleTraits.length === 0) return null;
        return (
        <div key={type} className="bg-[var(--color-surface)] rounded border border-[var(--color-border)] overflow-hidden hover:shadow-md transition-shadow">
          <div className="bg-[var(--color-surface-muted)] px-4 py-2 border-b font-semibold text-sm flex items-center gap-2">
            <span>{TYPE_ICONS[type] || "📌"}</span>
            <span className="capitalize">{type.replace(/_/g, " ")}</span>
          </div>
          <div className="divide-y">
            {visibleTraits.map((t: PersonalityTrait) => (
              <div key={t.id} className="px-4 py-3 cursor-pointer hover:bg-[var(--color-surface-hover)]" onClick={() => setSelectedTrait(t)}>
                <div className="flex justify-between items-center">
                  <div>
                    <span className="font-medium">{t.display_label || t.trait_value}</span>
                    {t.exemplar_text && <p className="text-xs text-[var(--color-text-muted)] mt-0.5">"{t.exemplar_text.substring(0, 100)}"</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <button onClick={(e) => { e.stopPropagation(); handleDismiss(t.id); }} className="text-gray-300 hover:text-red-500 text-lg leading-none" title="Dismiss trait">&times;</button>
                    <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(t.confidence || 0) * 100}%` }} />
                    </div>
                    <span className="text-xs text-[var(--color-text-muted)] w-8">{Math.round((t.confidence || 0) * 100)}%</span>
                  </div>
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
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="font-semibold">Type:</span> <span className="text-[var(--color-text-secondary)]">{selectedTrait.trait_type}</span></div>
              <div><span className="font-semibold">Value:</span> <span className="text-[var(--color-text-secondary)]">{selectedTrait.trait_value}</span></div>
              <div><span className="font-semibold">Confidence:</span> <span className="text-[var(--color-text-secondary)]">{Math.round((selectedTrait.confidence || 0) * 100)}%</span></div>
              <div><span className="font-semibold">Source:</span> <span className="text-[var(--color-text-secondary)]">{selectedTrait.source}</span></div>
            </div>
            {selectedTrait.exemplar_text && (
              <div>
                <h3 className="font-semibold mb-1">Exemplar</h3>
                <pre className="bg-[var(--color-surface-muted)] p-4 rounded border border-[var(--color-border)] text-sm">{selectedTrait.exemplar_text}</pre>
              </div>
            )}
            {selectedTrait.metadata && (
              <div>
                <h3 className="font-semibold mb-1">Metadata</h3>
                <pre className="bg-[var(--color-surface-muted)] p-4 rounded border border-[var(--color-border)] text-xs font-mono">{selectedTrait.metadata}</pre>
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
