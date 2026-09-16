"use client";

import { useId, useState } from "react";

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

/**
 * Parse the DB `file_tree` JSON into a tree of TreeNode objects.
 *
 * The API stores file trees as a flat `Record<relativePath, content>` map.
 * We reconstruct a folder hierarchy by splitting each path on "/", using a
 * `folderMap` to de-duplicate directory nodes. Two synthetic roots are always
 * injected: `SKILL.md` (from skill content) and `metadata.json` (generated
 * from skill metadata fields — not stored in the DB file_tree).
 *
 * O(n*d) where n = file count, d = max path depth.
 */
function parseTree(json: string | undefined, skillContent: string, skillName: string, tags?: string, alwaysApply?: number): TreeNode[] {
  const nodes: TreeNode[] = [];
  
  // Root: SKILL.md — always present
  nodes.push({ name: "SKILL.md", path: "SKILL.md", content: skillContent, children: [] });
  
  // Root: metadata.json — synthesised from skill fields, not from file_tree JSON
  const tagList = tags ? tags.split(",").map((t: string) => t.trim()).filter(Boolean) : [];
  const metaContent = JSON.stringify({ tags: tagList, alwaysApply: alwaysApply === 1 }, null, 2);
  nodes.push({ name: "metadata.json", path: "metadata.json", content: metaContent, children: [] });
  
  // Parse file_tree JSON — silently skip malformed data
  if (!json) return nodes;
  try {
    const tree = JSON.parse(json) as Record<string, string>;
    const folderMap: Record<string, TreeNode> = {};
    
    for (const [relPath, fileContent] of Object.entries(tree) as [string, string][]) {
      const parts = relPath.split("/");
      
      // Walk or create each path segment, attaching children to the parent folder
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
  } catch {
    // Malformed JSON — render SKILL.md + metadata.json only
  }
  return nodes;
}

/** Recursive tree node renderer. Supports expand/collapse for directories and file selection for leaf nodes. */
function TreeNodeItem({ node, depth, onSelect, selectedFile }: { node: TreeNode; depth: number; onSelect: (path: string, content: string) => void; selectedFile: string }) {
  const [expanded, setExpanded] = useState(true);
  const childrenId = useId();
  const isFolder = node.children.length > 0;
  const isSelected = node.path === selectedFile;
  const hasContent = node.content !== undefined && node.content !== null;
  const accessibleName = isFolder
    ? `${expanded ? "Collapse" : "Expand"} ${node.path}`
    : `Open ${node.path}`;

  const activateNode = () => {
    if (isFolder) setExpanded((isExpanded) => !isExpanded);
    else if (hasContent) onSelect(node.path, node.content || "");
  };

  return (
    <li className="min-w-0">
      <button
        type="button"
        onClick={activateNode}
        onKeyDown={(event) => {
          if (!isFolder) return;
          if (event.key === "ArrowRight" && !expanded) {
            event.preventDefault();
            setExpanded(true);
          }
          if (event.key === "ArrowLeft" && expanded) {
            event.preventDefault();
            setExpanded(false);
          }
        }}
        className={`flex w-full min-w-0 items-center gap-1 px-2 py-1 text-left rounded text-sm ${
          isSelected ? "bg-[var(--color-selection-bg)] text-[var(--color-selection-text)]" : "hover:bg-[var(--color-surface-hover)]"
        }`}
        style={{ paddingLeft: `${depth * 16 + 8}px` }}
        aria-expanded={isFolder ? expanded : undefined}
        aria-controls={isFolder ? childrenId : undefined}
        aria-current={isSelected && !isFolder ? "page" : undefined}
        aria-label={accessibleName}
        title={node.path}
      >
        {isFolder ? <span className="text-xs" aria-hidden="true">{expanded ? "▾" : "▸"}</span> : <span className="text-xs opacity-30" aria-hidden="true">▸</span>}
        <span className="mr-1" aria-hidden="true">{isFolder ? "📁" : "📄"}</span>
        <span className="min-w-0 flex-1 truncate">{node.name}</span>
      </button>
      {isFolder && expanded && (
        <ul id={childrenId} className="min-w-0" role="group">
          {node.children.map((child) => (
            <TreeNodeItem key={child.path} node={child} depth={depth + 1} onSelect={onSelect} selectedFile={selectedFile} />
          ))}
        </ul>
      )}
    </li>
  );
}

/**
 * Sidebar file tree for a skill's reference files.
 *
 * Parses the skill's `file_tree` JSON (a flat map of paths → content) into
 * a navigable folder hierarchy, prepending the synthetic `SKILL.md` and
 * `metadata.json` roots. Clicking a file calls `onSelectFile` with its
 * path and content for display in a companion editor/preview pane.
 */
export default function FileTree({ fileTreeJson, skillContent, skillName, tags, alwaysApply, onSelectFile, selectedFile }: FileTreeProps) {
  const tree = parseTree(fileTreeJson, skillContent, skillName, tags, alwaysApply);

  return (
    <nav
      aria-label={`Files for ${skillName}`}
      data-testid="skill-file-tree"
      className="w-full min-w-0 shrink-0 max-h-[40%] overflow-y-auto border-b border-[var(--color-border)] bg-[var(--color-surface-muted)] md:h-full md:max-h-none md:w-72 md:min-w-[220px] md:max-w-[300px] md:border-b-0 md:border-r"
    >
      <div className="p-2 font-semibold text-sm text-[var(--color-text-muted)] border-b">{skillName}</div>
      <ul className="min-w-0 py-1">
        {tree.map((node) => (
          <TreeNodeItem key={node.path} node={node} depth={0} onSelect={onSelectFile} selectedFile={selectedFile} />
        ))}
      </ul>
    </nav>
  );
}
