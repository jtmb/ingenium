"use client";

import { useState } from "react";

type FileTreeProps = {
  fileTreeJson: string | undefined;
  skillContent: string;
  skillName: string;
  tags?: string;
  alwaysApply?: number;
  onSelectFile: (path: string, content: string) => void;
  selectedFile: string;
};

type TreeNode = {
  name: string;
  path: string;
  content?: string;
  children: TreeNode[];
};

function parseTree(json: string | undefined, skillContent: string, skillName: string, tags?: string, alwaysApply?: number): TreeNode[] {
  const nodes: TreeNode[] = [];
  
  // Root: SKILL.md
  nodes.push({ name: "SKILL.md", path: "SKILL.md", content: skillContent, children: [] });
  
  // Root: metadata.json — generated from skill fields
  const tagList = tags ? tags.split(",").map((t: string) => t.trim()).filter(Boolean) : [];
  const metaContent = JSON.stringify({ tags: tagList, alwaysApply: alwaysApply === 1 }, null, 2);
  nodes.push({ name: "metadata.json", path: "metadata.json", content: metaContent, children: [] });
  
  // Parse file_tree JSON
  if (!json) return nodes;
  try {
    const tree = JSON.parse(json) as Record<string, string>;
    const folderMap: Record<string, TreeNode> = {};
    
    for (const [relPath, fileContent] of Object.entries(tree) as [string, string][]) {
      const parts = relPath.split("/");
      
      for (let i = 0; i < parts.length; i++) {
        const part = parts[i]!;
        const isFile = i === parts.length - 1;
        const currentPath = parts.slice(0, i + 1).join("/");
        const parentPath = i > 0 ? parts.slice(0, i).join("/") : "";
        
        if (isFile) {
          const fileNode: TreeNode = { name: part, path: relPath, content: fileContent, children: [] };
          if (parentPath && folderMap[parentPath]) {
            folderMap[parentPath].children.push(fileNode);
          } else {
            nodes.push(fileNode);
          }
        } else {
          if (!folderMap[currentPath]) {
            const dirNode: TreeNode = { name: part + "/", path: currentPath, children: [] };
            if (parentPath && folderMap[parentPath]) {
              folderMap[parentPath].children.push(dirNode);
            } else {
              nodes.push(dirNode);
            }
            folderMap[currentPath] = dirNode;
          }
        }
      }
    }
  } catch {}
  return nodes;
}

function TreeNodeItem({ node, depth, onSelect, selectedFile }: { node: TreeNode; depth: number; onSelect: (path: string, content: string) => void; selectedFile: string }) {
  const [expanded, setExpanded] = useState(true);
  const isFolder = node.children.length > 0;
  const isSelected = node.path === selectedFile;
  const hasContent = node.content !== undefined && node.content !== null;

  return (
    <div>
      <div
        onClick={() => {
          if (isFolder) setExpanded(!expanded);
          else if (hasContent) onSelect(node.path, node.content || "");
        }}
        className={`flex items-center gap-1 px-2 py-1 cursor-pointer rounded text-sm ${
          isSelected ? "bg-blue-100 text-blue-800" : "hover:bg-gray-100"
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
      >
        {isFolder ? <span className="text-xs">{expanded ? "▾" : "▸"}</span> : <span className="text-xs opacity-30">▸</span>}
        <span className="mr-1">{isFolder ? "📁" : "📄"}</span>
        <span className="truncate">{node.name}</span>
      </div>
      {isFolder && expanded && node.children.map((child) => (
        <TreeNodeItem key={child.path} node={child} depth={depth + 1} onSelect={onSelect} selectedFile={selectedFile} />
      ))}
    </div>
  );
}

export default function FileTree({ fileTreeJson, skillContent, skillName, tags, alwaysApply, onSelectFile, selectedFile }: FileTreeProps) {
  const tree = parseTree(fileTreeJson, skillContent, skillName, tags, alwaysApply);

  return (
    <div className="border-r border-gray-200 h-full overflow-y-auto bg-gray-50 min-w-[220px] max-w-[300px]">
      <div className="p-2 font-semibold text-sm text-gray-500 border-b">{skillName}</div>
      <div className="py-1">
        {tree.map((node) => (
          <TreeNodeItem key={node.path} node={node} depth={0} onSelect={onSelectFile} selectedFile={selectedFile} />
        ))}
      </div>
    </div>
  );
}
