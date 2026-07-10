"use client";
export const dynamic = "force-dynamic";
import { useState, useEffect } from "react";
import { useProject } from "../../lib/ProjectContext";
import { api, Learning } from "../../lib/api";
import Overlay from "../components/Overlay";

/**
 * Learnings log page.
 * Displays past entries with color-coded type badges and allows
 * creating new entries with a selectable entry type.
 */
export default function LearningsPage() {
  const project = useProject();
  const [learnings, setLearnings] = useState<Learning[]>([]);
  const [content, setContent] = useState("");
  const [type, setType] = useState("pattern");
  const [error, setError] = useState("");
  const [selectedLearning, setSelectedLearning] = useState<any>(null);

  useEffect(() => { api.learnings.list(project).then((r) => setLearnings(r.data)).catch(() => {}); }, [project]);

  /** Submits a new learning entry and prepends it to the list. */
  const log = async () => {
    if (!content) return;
    try {
      setError("");
      const res = await api.learnings.create(type, content, undefined, project);
      setLearnings([res.data, ...learnings]);
      setContent("");
    } catch (err) {
      setError("Failed to log learning. Please check that a project exists.");
    }
  };

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Learnings</h1>
      <div className="bg-yellow-50 border border-yellow-200 rounded p-3 text-sm text-yellow-800">
        Learnings are deprecated. Use the new <a href="/observations" className="underline">Observations</a> page. 
        The agent now records observations automatically during interactions — no self-reporting needed.
        Old learnings are automatically forwarded to the new pipeline.
      </div>
      <div className="bg-white p-4 rounded border space-y-3">
        <select value={type} onChange={(e) => setType(e.target.value)} className="border p-2 rounded">
          <option value="pattern">Pattern</option>
          <option value="decision">Decision</option>
          <option value="bug">Bug</option>
          <option value="preference">Preference</option>
          <option value="research">Research</option>
        </select>
        <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="What did you learn?" className="border p-2 rounded w-full h-24" />
        <button onClick={log} className="bg-blue-600 text-white p-2 rounded hover:bg-blue-700">Log Learning</button>
        {error && <div className="text-red-600 text-sm">{error}</div>}
      </div>
      <div className="space-y-2">
        {learnings.map((l) => (
          <div key={l.id} className="bg-white p-4 rounded border cursor-pointer" onClick={() => setSelectedLearning(l)}>
            <div className="flex gap-2 items-center mb-1">
              <span className={`text-xs px-2 py-0.5 rounded ${
                l.entry_type === "bug" ? "bg-red-100 text-red-700" :
                l.entry_type === "decision" ? "bg-purple-100 text-purple-700" :
                l.entry_type === "pattern" ? "bg-green-100 text-green-700" :
                "bg-gray-100 text-gray-700"
              }`}>{l.entry_type}</span>
              <span className="text-xs text-gray-400">{new Date(l.created_at).toLocaleString()}</span>
            </div>
            <p className="text-sm">{l.content}</p>
          </div>
        ))}
      </div>
      <Overlay
        isOpen={selectedLearning !== null}
        onClose={() => setSelectedLearning(null)}
        title={`Learning #${selectedLearning?.id ?? ""}`}
        subtitle={selectedLearning?.entry_type ? `Type: ${selectedLearning.entry_type}` : undefined}
      >
        {selectedLearning && (
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div>
                <span className="font-semibold">Type:</span>{" "}
                <span className={`inline-block px-2 py-0.5 rounded text-xs ${
                  selectedLearning.entry_type === "bug" ? "bg-red-100 text-red-800" :
                  selectedLearning.entry_type === "decision" ? "bg-purple-100 text-purple-800" :
                  selectedLearning.entry_type === "pattern" ? "bg-green-100 text-green-800" :
                  selectedLearning.entry_type === "skill" ? "bg-blue-100 text-blue-800" :
                  selectedLearning.entry_type === "architecture" ? "bg-orange-100 text-orange-800" :
                  "bg-gray-100 text-gray-600"
                }`}>{selectedLearning.entry_type}</span>
              </div>
              <div><span className="font-semibold">Priority:</span> <span className="text-gray-600">{selectedLearning.priority ?? 5}/10</span></div>
              <div><span className="font-semibold">Created:</span> <span className="text-gray-600">{new Date(selectedLearning.created_at).toLocaleString()}</span></div>
              {selectedLearning.tags && <div><span className="font-semibold">Tags:</span> <span className="text-gray-600">{selectedLearning.tags}</span></div>}
            </div>
            <div>
              <h3 className="font-semibold mb-1">Content</h3>
              <div className="space-y-2">
                <div className="flex items-center gap-2 border-b border-gray-200 pb-2">
                  <span className="px-3 py-1 text-sm rounded bg-gray-200 text-gray-400 cursor-not-allowed">Preview</span>
                  <span className="px-3 py-1 text-sm rounded bg-blue-600 text-white">Source</span>
                  <span className="text-xs text-gray-400 ml-auto">Plain text — not markdown</span>
                </div>
                <pre className="bg-gray-50 p-4 rounded border overflow-x-auto text-sm font-mono whitespace-pre-wrap">
                  {selectedLearning.content}
                </pre>
              </div>
            </div>
          </div>
        )}
      </Overlay>
    </div>
  );
}
