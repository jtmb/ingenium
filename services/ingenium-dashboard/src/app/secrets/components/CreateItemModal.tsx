"use client";

import { useState } from "react";
import { api, VaultFolder, VaultItemType } from "../../../lib/api";

interface CreateItemModalProps {
  isOpen: boolean;
  onClose: () => void;
  onCreated: () => void;
  folders: VaultFolder[];
  project: string;
}

const ITEM_TYPES: { value: VaultItemType; label: string }[] = [
  { value: "login", label: "Login" },
  { value: "api_key", label: "API Key" },
  { value: "note", label: "Note" },
  { value: "oauth", label: "OAuth" },
];

/**
 * CreateItemModal — form to create a new vault item.
 *
 * Fields: name, type (select), value (password with reveal toggle),
 * folder (select), tags (comma-separated), URLs (comma or space-separated).
 */
export default function CreateItemModal({
  isOpen,
  onClose,
  onCreated,
  folders,
  project,
}: CreateItemModalProps) {
  const [name, setName] = useState("");
  const [type, setType] = useState<VaultItemType>("login");
  const [value, setValue] = useState("");
  const [showValue, setShowValue] = useState(false);
  const [folderId, setFolderId] = useState("");
  const [tags, setTags] = useState("");
  const [urls, setUrls] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  if (!isOpen) return null;

  const handleCreate = async () => {
    if (!name.trim() || !value.trim()) return;
    setSaving(true);
    setError(null);
    try {
      await api.vault.items.create(
        {
          name: name.trim(),
          type,
          value: value,
          folder_id: folderId || undefined,
          tags: tags.trim() || undefined,
          urls: urls.trim() || undefined,
        },
        project,
      );
      onCreated();
    } catch (e: any) {
      setError(e.message ?? "Failed to create item");
    } finally {
      setSaving(false);
    }
  };

  const handleClose = () => {
    setName("");
    setType("login");
    setValue("");
    setShowValue(false);
    setFolderId("");
    setTags("");
    setUrls("");
    setError(null);
    onClose();
  };

  return (
    <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={handleClose}>
      <div
        className="bg-[var(--color-surface)] p-6 rounded-lg shadow-xl w-[28rem] max-h-[90vh] overflow-y-auto"
        onClick={(e) => e.stopPropagation()}
      >
        <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-4">
          New Item
        </h3>

        {error && (
          <div className="bg-[var(--color-error-bg)] border border-[var(--color-error-border)] p-2 rounded text-xs text-[var(--color-error-text)] mb-3">
            {error}
          </div>
        )}

        <div className="space-y-3">
          {/* Name */}
          <div>
            <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
              Name
            </label>
            <input
              type="text"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="e.g. GitHub"
              className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm mt-1 bg-[var(--color-surface)] text-[var(--color-text-primary)]"
              autoFocus
            />
          </div>

          {/* Type */}
          <div>
            <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
              Type
            </label>
            <select
              value={type}
              onChange={(e) => setType(e.target.value as VaultItemType)}
              className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm mt-1 bg-[var(--color-surface)] text-[var(--color-text-primary)] hover:bg-gray-50 cursor-pointer"
            >
              {ITEM_TYPES.map((t) => (
                <option key={t.value} value={t.value}>
                  {t.label}
                </option>
              ))}
            </select>
          </div>

          {/* Value */}
          <div>
            <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
              Secret Value
            </label>
            <div className="relative mt-1">
              <input
                type={showValue ? "text" : "password"}
                value={value}
                onChange={(e) => setValue(e.target.value)}
                placeholder="Enter secret value"
                className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm pr-10 bg-[var(--color-surface)] text-[var(--color-text-primary)]"
              />
              <button
                type="button"
                onClick={() => setShowValue(!showValue)}
                className="absolute right-2 top-1/2 -translate-y-1/2 text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] px-1"
              >
                {showValue ? "Hide" : "Show"}
              </button>
            </div>
          </div>

          {/* Folder */}
          <div>
            <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
              Folder
            </label>
            <select
              value={folderId}
              onChange={(e) => setFolderId(e.target.value)}
              className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm mt-1 bg-[var(--color-surface)] text-[var(--color-text-primary)] hover:bg-gray-50 cursor-pointer"
            >
              <option value="">No folder</option>
              {folders.map((f) => (
                <option key={f.id} value={f.id}>
                  {f.name}
                </option>
              ))}
            </select>
          </div>

          {/* Tags */}
          <div>
            <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
              Tags
            </label>
            <input
              type="text"
              value={tags}
              onChange={(e) => setTags(e.target.value)}
              placeholder="comma, separated, tags"
              className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm mt-1 bg-[var(--color-surface)] text-[var(--color-text-primary)]"
            />
          </div>

          {/* URLs */}
          <div>
            <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
              URLs
            </label>
            <input
              type="text"
              value={urls}
              onChange={(e) => setUrls(e.target.value)}
              placeholder="https://example.com"
              className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm mt-1 bg-[var(--color-surface)] text-[var(--color-text-primary)]"
            />
          </div>
        </div>

        <div className="flex gap-2 justify-end mt-5">
          <button
            onClick={handleClose}
            className="px-4 py-2 border border-[var(--color-border)] rounded text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
          >
            Cancel
          </button>
          <button
            onClick={handleCreate}
            disabled={!name.trim() || !value.trim() || saving}
            className="px-4 py-2 bg-blue-600 text-white rounded text-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
          >
            {saving ? "Creating..." : "Create Item"}
          </button>
        </div>
      </div>
    </div>
  );
}
