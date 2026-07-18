"use client";

import { useState } from "react";
import { api, VaultFolder } from "../../../lib/api";

interface FolderTreeProps {
  folders: VaultFolder[];
  selectedFolder: string | null;
  onSelectFolder: (folderId: string | null) => void;
  onRefresh: () => void;
  project: string;
}

/**
 * FolderTree — left pane of the Secrets page.
 *
 * Renders a list of vault folders with "All Items" as the default root.
 * Includes a "+ New Folder" button with inline name input.
 */
export default function FolderTree({
  folders,
  selectedFolder,
  onSelectFolder,
  onRefresh,
  project,
}: FolderTreeProps) {
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [newFolderName, setNewFolderName] = useState("");
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const handleCreateFolder = async () => {
    const name = newFolderName.trim();
    if (!name) return;
    setCreating(true);
    setError(null);
    try {
      await api.vault.folders.create(name, project);
      setNewFolderName("");
      setShowNewFolder(false);
      onRefresh();
    } catch (e: any) {
      setError(e.message ?? "Failed to create folder");
    } finally {
      setCreating(false);
    }
  };

  return (
    <div className="flex flex-col h-full">
      {/* Header */}
      <div className="px-3 py-3 border-b border-[var(--color-border)]">
        <h3 className="text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] mb-2">
          Folders
        </h3>

        {/* All Items */}
        <button
          onClick={() => onSelectFolder(null)}
          className={`w-full text-left px-3 py-1.5 rounded text-sm transition-colors ${
            selectedFolder === null
              ? "bg-[var(--color-selection-bg)] text-[var(--color-selection-text)] font-medium"
              : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
          }`}
        >
          All Items
        </button>
      </div>

      {/* Folder list */}
      <div className="flex-1 overflow-y-auto px-2 py-1">
        {folders.map((f) => (
          <button
            key={f.id}
            onClick={() => onSelectFolder(f.id)}
            className={`w-full text-left px-3 py-1.5 rounded text-sm transition-colors flex items-center justify-between ${
              selectedFolder === f.id
                ? "bg-[var(--color-selection-bg)] text-[var(--color-selection-text)] font-medium"
                : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
            }`}
          >
            <span className="truncate">{f.name}</span>
            <span className="text-xs text-[var(--color-text-muted)] shrink-0 ml-2">
              {f.item_count}
            </span>
          </button>
        ))}
        {folders.length === 0 && (
          <p className="text-xs text-[var(--color-text-muted)] px-3 py-2">
            No folders yet.
          </p>
        )}
      </div>

      {/* New Folder */}
      <div className="px-3 py-2 border-t border-[var(--color-border)]">
        {showNewFolder ? (
          <div className="space-y-2">
            <input
              type="text"
              value={newFolderName}
              onChange={(e) => setNewFolderName(e.target.value)}
              placeholder="Folder name"
              className="w-full border border-[var(--color-border)] rounded px-2 py-1.5 text-sm bg-[var(--color-surface)] text-[var(--color-text-primary)]"
              autoFocus
              onKeyDown={(e) => {
                if (e.key === "Enter") handleCreateFolder();
                if (e.key === "Escape") setShowNewFolder(false);
              }}
            />
            {error && (
              <p className="text-xs text-[var(--color-error-text)]">{error}</p>
            )}
            <div className="flex gap-1">
              <button
                onClick={handleCreateFolder}
                disabled={!newFolderName.trim() || creating}
                className="flex-1 bg-blue-600 text-white py-1 rounded text-xs hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {creating ? "Creating..." : "Create"}
              </button>
              <button
                onClick={() => {
                  setShowNewFolder(false);
                  setNewFolderName("");
                  setError(null);
                }}
                className="px-2 py-1 border border-[var(--color-border)] rounded text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <button
            onClick={() => setShowNewFolder(true)}
            className="w-full text-left px-3 py-1.5 rounded text-sm text-[var(--color-text-link)] hover:bg-[var(--color-surface-hover)] transition-colors"
          >
            + New Folder
          </button>
        )}
      </div>
    </div>
  );
}
