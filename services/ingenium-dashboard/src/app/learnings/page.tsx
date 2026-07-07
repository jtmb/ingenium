"use client";
import { useState, useEffect } from "react";
import { api, Learning } from "../../lib/api";

/**
 * Learnings log page.
 * Displays past entries with color-coded type badges and allows
 * creating new entries with a selectable entry type.
 */
export default function LearningsPage() {
  const [learnings, setLearnings] = useState<Learning[]>([]);
  const [content, setContent] = useState("");
  const [type, setType] = useState("pattern");
  const [error, setError] = useState("");

  useEffect(() => { api.learnings.list().then((r) => setLearnings(r.data)).catch(() => {}); }, []);

  /** Submits a new learning entry and prepends it to the list. */
  const log = async () => {
    if (!content) return;
    try {
      setError("");
      const res = await api.learnings.create(type, content);
      setLearnings([res.data, ...learnings]);
      setContent("");
    } catch (err) {
      setError("Failed to log learning. Please check that a project exists.");
    }
  };

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Learnings</h1>
      <div className="bg-white p-4 rounded border space-y-3">
        <select value={type} onChange={(e) => setType(e.target.value)} className="border p-2 rounded">
          <option value="pattern">Pattern</option>
          <option value="decision">Decision</option>
          <option value="bug">Bug</option>
          <option value="preference">Preference</option>
          <option value="research">Research</option>
        </select>
        <textarea value={content} onChange={(e) => setContent(e.target.value)} placeholder="What did you learn?" className="border p-2 rounded w-full h-24" />
        <button onClick={log} className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700">Log Learning</button>
        {error && <div className="text-red-600 text-sm">{error}</div>}
      </div>
      <div className="space-y-2">
        {learnings.map((l) => (
          <div key={l.id} className="bg-white p-4 rounded border">
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
    </div>
  );
}
