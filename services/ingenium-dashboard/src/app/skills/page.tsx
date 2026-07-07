"use client";
import { useState, useEffect } from "react";
import { api, Skill } from "../../lib/api";

/**
 * Skills browser page.
 * Loads the full skill list on mount and provides a client-side text filter
 * that searches across skill name and description.
 */
export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [search, setSearch] = useState("");

  useEffect(() => { api.skills.list().then((r) => setSkills(r.data)).catch(() => {}); }, []);

  const filtered = search
    ? skills.filter((s) => s.name.includes(search) || s.description.includes(search))
    : skills;

  return (
    <div className="space-y-6">
      <h1 className="text-2xl font-bold">Skills ({skills.length})</h1>
      <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search skills..." className="border p-2 rounded w-full" />
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        {filtered.map((s) => (
          <div key={s.id} className="bg-white p-4 rounded border">
            <h3 className="font-medium">{s.name}</h3>
            <p className="text-sm text-gray-500 truncate">{s.description}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
