"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
import { useState } from "react";
function parseTree(json, skillContent, skillName, tags, alwaysApply) {
    const nodes = [];
    // Root: SKILL.md
    nodes.push({ name: "SKILL.md", path: "SKILL.md", content: skillContent, children: [] });
    // Root: metadata.json — generated from skill fields
    const tagList = tags ? tags.split(",").map((t) => t.trim()).filter(Boolean) : [];
    const metaContent = JSON.stringify({ tags: tagList, alwaysApply: alwaysApply === 1 }, null, 2);
    nodes.push({ name: "metadata.json", path: "metadata.json", content: metaContent, children: [] });
    // Parse file_tree JSON
    if (!json)
        return nodes;
    try {
        const tree = JSON.parse(json);
        const folderMap = {};
        for (const [relPath, fileContent] of Object.entries(tree)) {
            const parts = relPath.split("/");
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                const isFile = i === parts.length - 1;
                const currentPath = parts.slice(0, i + 1).join("/");
                const parentPath = i > 0 ? parts.slice(0, i).join("/") : "";
                if (isFile) {
                    const fileNode = { name: part, path: relPath, content: fileContent, children: [] };
                    if (parentPath && folderMap[parentPath]) {
                        folderMap[parentPath].children.push(fileNode);
                    }
                    else {
                        nodes.push(fileNode);
                    }
                }
                else {
                    if (!folderMap[currentPath]) {
                        const dirNode = { name: part + "/", path: currentPath, children: [] };
                        if (parentPath && folderMap[parentPath]) {
                            folderMap[parentPath].children.push(dirNode);
                        }
                        else {
                            nodes.push(dirNode);
                        }
                        folderMap[currentPath] = dirNode;
                    }
                }
            }
        }
    }
    catch { }
    return nodes;
}
function TreeNodeItem({ node, depth, onSelect, selectedFile }) {
    const [expanded, setExpanded] = useState(true);
    const isFolder = node.children.length > 0;
    const isSelected = node.path === selectedFile;
    const hasContent = node.content !== undefined && node.content !== null;
    return (_jsxs("div", { children: [_jsxs("div", { onClick: () => {
                    if (isFolder)
                        setExpanded(!expanded);
                    else if (hasContent)
                        onSelect(node.path, node.content || "");
                }, className: `flex items-center gap-1 px-2 py-1 cursor-pointer rounded text-sm ${isSelected ? "bg-blue-100 text-blue-800" : "hover:bg-gray-100"}`, style: { paddingLeft: `${depth * 16 + 8}px` }, children: [isFolder ? _jsx("span", { className: "text-xs", children: expanded ? "▾" : "▸" }) : _jsx("span", { className: "text-xs opacity-30", children: "\u25B8" }), _jsx("span", { className: "mr-1", children: isFolder ? "📁" : "📄" }), _jsx("span", { className: "truncate", children: node.name })] }), isFolder && expanded && node.children.map((child) => (_jsx(TreeNodeItem, { node: child, depth: depth + 1, onSelect: onSelect, selectedFile: selectedFile }, child.path)))] }));
}
export default function FileTree({ fileTreeJson, skillContent, skillName, tags, alwaysApply, onSelectFile, selectedFile }) {
    const tree = parseTree(fileTreeJson, skillContent, skillName, tags, alwaysApply);
    return (_jsxs("div", { className: "border-r border-gray-200 h-full overflow-y-auto bg-gray-50 min-w-[220px] max-w-[300px]", children: [_jsx("div", { className: "p-2 font-semibold text-sm text-gray-500 border-b", children: skillName }), _jsx("div", { className: "py-1", children: tree.map((node) => (_jsx(TreeNodeItem, { node: node, depth: 0, onSelect: onSelectFile, selectedFile: selectedFile }, node.path))) })] }));
}
