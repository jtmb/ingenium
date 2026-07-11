"use client";
import { jsxs as _jsxs, jsx as _jsx, Fragment as _Fragment } from "react/jsx-runtime";
export const dynamic = "force-dynamic";
import { useState, useEffect, useRef } from "react";
import { useProject } from "../../lib/ProjectContext";
import { api } from "../../lib/api";
import FileTree from "../components/FileTree";
import MarkdownViewer from "../components/MarkdownViewer";
/**
 * Skills browser page with file tree navigation and inline editing.
 * Click a skill card to open an overlay with a split-pane layout:
 * file tree on the left, content viewer/editor on the right.
 */
export default function SkillsPage() {
    const project = useProject();
    const [skills, setSkills] = useState([]);
    const [search, setSearch] = useState("");
    const [selectedSkill, setSelectedSkill] = useState(null);
    const [selectedFile, setSelectedFile] = useState("SKILL.md");
    const [fileContent, setFileContent] = useState("");
    const [editMode, setEditMode] = useState(false);
    const [editText, setEditText] = useState("");
    const [saving, setSaving] = useState(false);
    const [uploadStatus, setUploadStatus] = useState("idle");
    const [sortMode, setSortMode] = useState("alpha");
    const fileRef = useRef(null);
    useEffect(() => { api.skills.list(project).then((r) => setSkills(r.data)).catch(() => { }); }, [project]);
    const fetchSkill = async (name) => {
        try {
            const r = await api.skills.get(name, project);
            setSelectedSkill(r.data);
            setSelectedFile("SKILL.md");
            setFileContent(r.data.content);
            setEditMode(false);
        }
        catch { }
    };
    const handleSelectFile = (path, content) => {
        setSelectedFile(path);
        setFileContent(content);
        setEditMode(false);
    };
    const handleEdit = () => {
        setEditText(fileContent);
        setEditMode(true);
    };
    const handleSave = async () => {
        if (!selectedSkill)
            return;
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
        }
        catch { /* save failed — let the user retry */ }
        setSaving(false);
    };
    const filtered = [...skills]
        .sort((a, b) => {
        if (sortMode === "newest")
            return new Date(b.created_at || "").getTime() - new Date(a.created_at || "").getTime();
        return a.name.localeCompare(b.name);
    })
        .filter((s) => !search || s.name.includes(search) || s.description.includes(search));
    const handleUpload = async (e) => {
        const file = e.target.files?.[0];
        if (!file)
            return;
        setUploadStatus("uploading");
        try {
            const text = await file.text();
            const match = text.match(/^---\s*\nname:\s*(.+)\ndescription:\s*(.+)\n---\s*\n([\s\S]*)$/m);
            if (!match) {
                setUploadStatus("error");
                setTimeout(() => setUploadStatus("idle"), 3000);
                return;
            }
            await api.skills.create(match[1].trim(), match[2].trim(), match[3].trim(), project);
            setUploadStatus("success");
            setTimeout(() => setUploadStatus("idle"), 3000);
            const res = await api.skills.list(project);
            setSkills(res.data);
        }
        catch {
            setUploadStatus("error");
            setTimeout(() => setUploadStatus("idle"), 3000);
        }
        // Reset file input so the same file can be re-uploaded
        if (fileRef.current)
            fileRef.current.value = "";
    };
    const isMarkdown = selectedFile.endsWith(".md") || selectedFile === "SKILL.md";
    const lang = selectedFile.split(".").pop() || "";
    return (_jsxs("div", { className: "space-y-8", children: [_jsxs("h1", { className: "text-3xl font-bold", children: ["Skills (", skills.length, ")"] }), _jsxs("div", { className: "flex gap-2 items-center", children: [_jsx("input", { value: search, onChange: (e) => setSearch(e.target.value), placeholder: "Search skills...", className: "border p-2 rounded flex-1" }), _jsxs("select", { value: sortMode, onChange: (e) => setSortMode(e.target.value), className: "border border-gray-200 rounded px-3 py-1.5 text-sm bg-white text-gray-600 hover:bg-gray-50 cursor-pointer", children: [_jsx("option", { value: "alpha", children: "Alphabetical" }), _jsx("option", { value: "newest", children: "Newest first" })] }), _jsx("input", { ref: fileRef, type: "file", accept: ".md", onChange: handleUpload, className: "hidden" }), _jsx("button", { onClick: () => fileRef.current?.click(), disabled: uploadStatus === "uploading", className: "bg-blue-600 text-white p-2 rounded hover:bg-blue-700 disabled:opacity-50", children: uploadStatus === "uploading" ? "Uploading..." : "Upload Skill" }), uploadStatus === "success" && _jsx("span", { className: "text-sm text-green-600", children: "Uploaded!" }), uploadStatus === "error" && _jsx("span", { className: "text-sm text-red-600", children: "Invalid file. Use a .md with name: and description: frontmatter." })] }), _jsx("div", { className: "grid grid-cols-1 md:grid-cols-3 gap-4", children: filtered.map((s) => (_jsxs("div", { onClick: () => fetchSkill(s.name), className: "bg-white p-4 rounded border hover:shadow-md transition-shadow cursor-pointer", children: [_jsx("h3", { className: "font-medium", children: s.name }), _jsx("p", { className: "text-sm text-gray-500 truncate", children: s.description }), s.tags && _jsx("p", { className: "text-xs text-blue-500 mt-1", children: s.tags })] }, s.id))) }), selectedSkill && (_jsxs("div", { className: "fixed inset-0 z-50 flex items-start justify-center", children: [_jsx("div", { className: "absolute inset-0 bg-black/50", onClick: () => setSelectedSkill(null) }), _jsxs("div", { className: "relative mt-8 mb-8 w-11/12 max-w-7xl bg-white rounded-lg shadow-2xl flex flex-col max-h-[90vh]", children: [_jsxs("div", { className: "flex items-center justify-between px-6 py-4 border-b shrink-0", children: [_jsxs("div", { children: [_jsx("h2", { className: "text-xl font-bold", children: selectedSkill.name }), _jsx("p", { className: "text-sm text-gray-500", children: selectedSkill.description })] }), _jsx("button", { onClick: () => setSelectedSkill(null), className: "p-2 text-gray-400 hover:text-gray-600 rounded-full", children: "\u2715" })] }), _jsxs("div", { className: "flex flex-1 overflow-hidden", children: [_jsx(FileTree, { fileTreeJson: selectedSkill.file_tree, skillContent: selectedSkill.content, skillName: selectedSkill.name, tags: selectedSkill.tags, alwaysApply: selectedSkill.always_apply, onSelectFile: handleSelectFile, selectedFile: selectedFile }), _jsxs("div", { className: "flex-1 overflow-y-auto p-4", children: [_jsxs("div", { className: "flex items-center justify-between mb-4", children: [_jsx("span", { className: "text-sm text-gray-500 font-mono", children: selectedFile }), _jsxs("div", { className: "flex gap-2", children: [!editMode && (_jsx("button", { onClick: handleEdit, className: "text-xs px-3 py-1 border rounded hover:bg-gray-100", children: "Edit" })), editMode && (_jsxs(_Fragment, { children: [_jsx("button", { onClick: () => { setEditMode(false); setEditText(fileContent); }, className: "text-xs px-3 py-1 border rounded hover:bg-gray-100", children: "Cancel" }), _jsx("button", { onClick: handleSave, disabled: saving, className: "text-xs px-3 py-1 bg-blue-600 text-white rounded hover:bg-blue-700 disabled:opacity-50", children: saving ? "Saving..." : "Save" })] }))] })] }), editMode ? (_jsx("textarea", { value: editText, onChange: (e) => setEditText(e.target.value), className: "w-full h-full min-h-[400px] p-4 border rounded font-mono text-sm resize-none" })) : (_jsx(MarkdownViewer, { content: fileContent, isMarkdown: isMarkdown, language: lang }))] })] })] })] }))] }));
}
