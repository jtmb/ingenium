"use client";
export const dynamic = "force-dynamic";
import { useState, useEffect, useRef } from "react";
import { useProject } from "../../lib/ProjectContext";
import { api, Skill } from "../../lib/api";
import FileTree from "../components/FileTree";
import MarkdownViewer from "../components/MarkdownViewer";

/**
 * Skills browser page with file tree navigation and inline editing.
 * Click a skill card to open an overlay with a split-pane layout:
 * file tree on the left, content viewer/editor on the right.
 */
export default function SkillsPage() {
  const project = useProject();
  const [skills, setSkills] = useState<Skill[]>([]);
  const [search, setSearch] = useState("");
  const [selectedSkill, setSelectedSkill] = useState<Skill | null>(null);
  const [selectedFile, setSelectedFile] = useState<string>("SKILL.md");
  const [fileContent, setFileContent] = useState<string>("");
  const [editMode, setEditMode] = useState(false);
  const [editText, setEditText] = useState("");
  const [saving, setSaving] = useState(false);
  const [uploadStatus, setUploadStatus] = useState<"idle" | "uploading" | "success" | "error">("idle");
  const [sortMode, setSortMode] = useState<"alpha" | "newest">("alpha");
  const fileRef = useRef<HTMLInputElement>(null);

  useEffect(() => { api.skills.list(project).then((r) => setSkills(r.data)).catch(() => {}); }, [project]);

  const fetchSkill = async (name: string) => {
    try {
      const r = await api.skills.get(name, project);
      setSelectedSkill(r.data);
      setSelectedFile("SKILL.md");
      setFileContent(r.data.content);
      setEditMode(false);
    } catch {}
  };

  const handleSelectFile = (path: string, content: string) => {
    setSelectedFile(path);
    setFileContent(content);
    setEditMode(false);
  };

  const handleEdit = () => {
    setEditText(fileContent);
    setEditMode(true);
  };

  const handleSave = async () => {
    if (!selectedSkill) return;
    setSaving(true);
    try {
      // Build updated file_tree if editing a reference file
      let fileTree = selectedSkill.file_tree;
      if (selectedFile !== "SKILL.md" && fileTree) {
        const tree = JSON.parse(fileTree);
        tree[selectedFile] = editText;
        fileTree = JSON.stringify(tree);
      }
      
      await api.skills.update(selectedSkill.name, selectedFile === "SKILL.md" ? editText : selectedSkill.content, {
        tags: selectedSkill.tags,
        always_apply: selectedSkill.always_apply,
        files: fileTree,
      }, project);
      
      setFileContent(editText);
      setEditMode(false);
      // Refresh skill data
      await fetchSkill(selectedSkill.name);
    } catch { /* save failed — let the user retry */ }
    setSaving(false);
  };

  const filtered = [...skills]
    .sort((a, b) => {
      if (sortMode === "newest") return new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime();
      return a.name.localeCompare(b.name);
    })
    .filter((s) => !search || s.name.includes(search) || s.description.includes(search));

  const handleUpload = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    if (!file) return;
    setUploadStatus("uploading");
    try {
      const text = await file.text();
      const match = text.match(/^---\s*\nname:\s*(.+)\ndescription:\s*(.+)\n---\s*\n([\s\S]*)$/m);
      if (!match) {
        setUploadStatus("error");
        setTimeout(() => setUploadStatus("idle"), 3000);
        return;
      }
      await api.skills.create(match[1]!.trim(), match[2]!.trim(), match[3]!.trim(), project);
      setUploadStatus("success");
      setTimeout(() => setUploadStatus("idle"), 3000);
      const res = await api.skills.list(project);
      setSkills(res.data);
    } catch {
      setUploadStatus("error");
      setTimeout(() => setUploadStatus("idle"), 3000);
    }
    // Reset file input so the same file can be re-uploaded
    if (fileRef.current) fileRef.current.value = "";
  };

  const isMarkdown = selectedFile.endsWith(".md") || selectedFile === "SKILL.md";
  const lang = selectedFile.split(".").pop() || "";

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Skills ({skills.length})</h1>
      
      {/* Search + Upload */}
      <div className="flex gap-2 items-stretch">
        <input value={search} onChange={(e) => setSearch(e.target.value)} placeholder="Search skills..." className="border border-gray-200 p-2 rounded text-sm flex-1 h-10" />
        <select value={sortMode} onChange={(e) => setSortMode(e.target.value as any)} className="border border-gray-200 rounded p-2 text-sm bg-white text-gray-600 hover:bg-gray-50 cursor-pointer h-10">
          <option value="alpha">Alphabetical</option>
          <option value="newest">Newest first</option>
        </select>
        <input ref={fileRef} type="file" accept=".md" onChange={handleUpload} className="hidden" />
        <button onClick={() => fileRef.current?.click()} disabled={uploadStatus === "uploading"}
                className="bg-blue-600 text-white p-2 rounded hover:bg-blue-700 disabled:opacity-50 h-10">
          {uploadStatus === "uploading" ? "Uploading..." : "Upload Skill"}
        </button>
        {uploadStatus === "success" && <span className="text-sm text-green-600">Uploaded!</span>}
        {uploadStatus === "error" && <span className="text-sm text-red-600">Invalid file. Use a .md with name: and description: frontmatter.</span>}
      </div>

      {/* Card grid */}
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {filtered.map((s) => (
          <div key={s.id} onClick={() => fetchSkill(s.name)} className="bg-white p-4 rounded border hover:shadow-md transition-shadow cursor-pointer">
            <h3 className="font-medium">{s.name}</h3>
            <p className="text-sm text-gray-500 truncate">{s.description}</p>
            {s.tags && <p className="text-xs text-blue-500 mt-1">{s.tags}</p>}
          </div>
        ))}
      </div>

      {/* Overlay with split layout */}
      {selectedSkill && (
        <div className="fixed inset-0 z-50 flex items-start justify-center">
          <div className="absolute inset-0 bg-black/50" onClick={() => setSelectedSkill(null)} />
          <div className="relative mt-8 mb-8 w-11/12 max-w-7xl bg-white rounded-lg shadow-2xl flex flex-col max-h-[90vh]">
            {/* Header */}
            <div className="flex items-center justify-between px-6 py-4 border-b shrink-0">
              <div>
                <h2 className="text-xl font-bold">{selectedSkill.name}</h2>
                <p className="text-sm text-gray-500">{selectedSkill.description}</p>
              </div>
              <button onClick={() => setSelectedSkill(null)} className="p-2 text-gray-400 hover:text-gray-600 rounded-full">✕</button>
            </div>

            {/* Body: split layout */}
            <div className="flex flex-1 overflow-hidden">
              {/* File tree sidebar */}
              <FileTree
                fileTreeJson={selectedSkill.file_tree}
                skillContent={selectedSkill.content}
                skillName={selectedSkill.name}
                tags={selectedSkill.tags}
                alwaysApply={selectedSkill.always_apply}
                onSelectFile={handleSelectFile}
                selectedFile={selectedFile}
              />

              {/* Content viewer + editor */}
              <div className="flex-1 overflow-y-auto p-4">
                <div className="flex items-center justify-between mb-4">
                  <span className="text-sm text-gray-500 font-mono">{selectedFile}</span>
                  <div className="flex gap-2">
                    {!editMode && (
                      <button onClick={handleEdit} className="text-xs px-3 py-1 border rounded hover:bg-gray-100">Edit</button>
                    )}
                    {editMode && (
                      <>
                        <button onClick={() => { setEditMode(false); setEditText(fileContent); }} className="text-xs px-3 py-1 border rounded hover:bg-gray-100">Cancel</button>
                        <button onClick={handleSave} disabled={saving} className="text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50">{saving ? "Saving..." : "Save"}</button>
                      </>
                    )}
                  </div>
                </div>

                {editMode ? (
                  <textarea value={editText} onChange={(e) => setEditText(e.target.value)} className="w-full h-full min-h-[400px] p-4 border rounded font-mono text-sm resize-none" />
                ) : (
                  <MarkdownViewer content={fileContent} isMarkdown={isMarkdown} language={lang} />
                )}
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
