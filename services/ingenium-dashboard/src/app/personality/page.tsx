"use client";
export const dynamic = "force-dynamic";
import { useState, useEffect } from "react";
import { useProject } from "../../lib/ProjectContext";
import { api, PersonalityTrait } from "../../lib/api";
import Overlay from "../components/Overlay";

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
    api.personality.list(project).then((r) => setTraits(r.data || [])).catch(() => {});
    api.personality.profile(project).then((r) => setProfile(r.data || [])).catch(() => {});
  }, [project]);

  const grouped = traits.reduce((acc: Record<string, PersonalityTrait[]>, t: PersonalityTrait) => {
    (acc[t.trait_type] ??= []).push(t);
    return acc;
  }, {});

  return (
    <div className="space-y-6">
      <div className="flex justify-between items-center">
        <h1 className="text-3xl font-bold">Personality Profile</h1>
        <div className="flex items-center gap-3">
          <span className="text-sm text-gray-400">Sort:</span>
          <select value={sortMode} onChange={(e) => setSortMode(e.target.value as any)} className="border border-gray-200 rounded px-3 py-1.5 text-sm bg-white text-gray-600">
            <option value="grouped">Grouped by type</option>
            <option value="newest">Newest first</option>
          </select>
          <span className="text-sm text-gray-500">{traits.length} trait(s)</span>
        </div>
      </div>

      {sortMode === "newest" && (
        <div className="bg-white rounded border divide-y">
          {[...traits].sort((a, b) => new Date(b.created_at).getTime() - new Date(a.created_at).getTime()).map((t) => (
            <div key={t.id} className="px-4 py-3 cursor-pointer hover:bg-gray-50 flex justify-between items-center" onClick={() => setSelectedTrait(t)}>
              <div className="flex items-center gap-3">
                <span>{TYPE_ICONS[t.trait_type] || "📌"}</span>
                <div>
                  <span className="font-medium">{t.display_label || t.trait_value}</span>
                  <span className="text-xs text-gray-400 ml-2 capitalize">{t.trait_type?.replace(/_/g, " ")}</span>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-xs text-gray-400">{formatRelative(t.created_at)}</span>
                <div className="w-16 h-1.5 bg-gray-200 rounded-full overflow-hidden">
                  <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(t.confidence || 0) * 100}%` }} />
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {sortMode === "grouped" && Object.entries(grouped).length === 0 && (
        <div className="bg-gray-50 p-8 rounded border text-center text-gray-400">
          No personality traits learned yet. Traits are generated automatically from observations via the synthesis pipeline.
        </div>
      )}

      {sortMode === "grouped" && Object.entries(grouped).map(([type, typeTraits]) => (
        <div key={type} className="bg-white rounded border overflow-hidden">
          <div className="bg-gray-50 px-4 py-2 border-b font-semibold text-sm flex items-center gap-2">
            <span>{TYPE_ICONS[type] || "📌"}</span>
            <span className="capitalize">{type.replace(/_/g, " ")}</span>
          </div>
          <div className="divide-y">
            {(typeTraits as PersonalityTrait[]).map((t: PersonalityTrait) => (
              <div key={t.id} className="px-4 py-3 cursor-pointer hover:bg-gray-50" onClick={() => setSelectedTrait(t)}>
                <div className="flex justify-between items-center">
                  <div>
                    <span className="font-medium">{t.display_label || t.trait_value}</span>
                    {t.exemplar_text && <p className="text-xs text-gray-400 mt-0.5">"{t.exemplar_text.substring(0, 100)}"</p>}
                  </div>
                  <div className="flex items-center gap-2">
                    <div className="w-20 h-2 bg-gray-200 rounded-full overflow-hidden">
                      <div className="h-full bg-blue-500 rounded-full" style={{ width: `${(t.confidence || 0) * 100}%` }} />
                    </div>
                    <span className="text-xs text-gray-500 w-8">{Math.round((t.confidence || 0) * 100)}%</span>
                  </div>
                </div>
              </div>
            ))}
          </div>
        </div>
      ))}

      <Overlay isOpen={selectedTrait !== null} onClose={() => setSelectedTrait(null)}
        title={selectedTrait?.display_label || selectedTrait?.trait_value || "Trait Detail"}
        subtitle={`${selectedTrait?.trait_type?.replace(/_/g, " ")} — ${Math.round((selectedTrait?.confidence || 0) * 100)}% confidence`}>
        {selectedTrait && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="font-semibold">Type:</span> <span className="text-gray-600">{selectedTrait.trait_type}</span></div>
              <div><span className="font-semibold">Value:</span> <span className="text-gray-600">{selectedTrait.trait_value}</span></div>
              <div><span className="font-semibold">Confidence:</span> <span className="text-gray-600">{Math.round((selectedTrait.confidence || 0) * 100)}%</span></div>
              <div><span className="font-semibold">Source:</span> <span className="text-gray-600">{selectedTrait.source}</span></div>
            </div>
            {selectedTrait.exemplar_text && (
              <div>
                <h3 className="font-semibold mb-1">Exemplar</h3>
                <pre className="bg-gray-50 p-4 rounded border text-sm">{selectedTrait.exemplar_text}</pre>
              </div>
            )}
            {selectedTrait.metadata && (
              <div>
                <h3 className="font-semibold mb-1">Metadata</h3>
                <pre className="bg-gray-50 p-4 rounded border text-xs font-mono">{selectedTrait.metadata}</pre>
              </div>
            )}
          </div>
        )}
      </Overlay>
    </div>
  );
}
