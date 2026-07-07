"use client";
import { useState, useEffect, useRef } from "react";
import { api, Skill } from "../../lib/api";

/**
 * Skills browser page.
 * Loads the full skill list on mount and provides a client-side text filter
 * that searches across skill name and description.
 * Supports uploading skills from .md files with YAML frontmatter.
 */
export default function SkillsPage() {
  const [skills, setSkills] = useState<Skill[]>([]);
  const [search, setSearch] = useState("");
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { api.skills.list().then((r) => setSkills(r.data)).catch(() => {}); }, []);

  const filtered = search
    ? skills.filter((s) => s.name.includes(search) || s.description.includes(search))
    : skills;

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadStatus("uploading");
    try {
      const text = await file.text();
      // Parse YAML frontmatter: --- name: ... description: ... --- content
      const match = text.match(/^---\s*\nname:\s*(.+)\ndescription:\s*(.+)\n---\s*\n([\s\S]*)$/m);
      if (!match) {
        setUploadStatus("error");
        setTimeout(() => setUploadStatus("idle"), 3000);
        return;
      }
      await api.skills.create(match[1]!.trim(), match[2]!.trim(), match[3]!.trim(), "ingenium");
      setUploadStatus("success");
      setTimeout(() => setUploadStatus("idle"), 3000);
      const res = await api.skills.list();
      setSkills(res.data);
    } catch {
      setUploadStatus("error");
      setTimeout(() => setUploadStatus("idle"), 3000);
    }
    // Reset file input so the same file can be re-uploaded
    if (fileRef.current) fileRef.current.value = "";
  };

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Skills ({skills.length})</h1>
      <div className="flex gap-2 items-center">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search skills..." className="border p-2 rounded flex-1" />
        <input ref={fileRef} type="file" accept=".md" onChange={handleUpload} className="hidden" />
        <button onClick={() => fileRef.current?.click()} disabled={uploadStatus === "uploading"}
                className="bg-blue-600 text-white px-4 py-2 rounded hover:bg-blue-700 text-sm disabled:opacity-50">
          {uploadStatus === "uploading" ? "Uploading..." : "Upload Skill"}
        </button>
        {uploadStatus === "success" && <span className="text-sm text-green-600">Uploaded!</span>}
        {uploadStatus === "error" && <span className="text-sm text-red-600">Invalid file. Use a .md with name: and description: frontmatter.</span>}
      </div>
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
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
