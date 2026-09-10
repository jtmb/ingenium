"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { api, VaultItem, VaultItemDetail } from "../../../lib/api";
import { badgeTones, BADGE_BASE } from "../../../lib/badgeTones";

interface ItemDetailProps {
  item: VaultItem | null;
  onItemUpdated: () => void;
  onItemDeleted: () => void;
  project: string;
}

const TYPE_HUE: Record<string, string> = {
  login: "blue",
  api_key: "red",
  note: "slate",
  oauth: "purple",
};

const TYPE_LABEL: Record<string, string> = {
  login: "Login",
  api_key: "API Key",
  note: "Note",
  oauth: "OAuth",
};

/**
 * ItemDetail — right pane of the Secrets page.
 *
 * Shows full item metadata: name, type, tags, URLs, username.
 * Actions: Reveal (decrypt for 30s), Copy, Edit, Delete, Rotate.
 */
export default function ItemDetail({
  item,
  onItemUpdated,
  onItemDeleted,
  project,
}: ItemDetailProps) {
  const [detail, setDetail] = useState<VaultItemDetail | null>(null);
  const [revealedValue, setRevealedValue] = useState<string | null>(null);
  const [revealTimer, setRevealTimer] = useState<ReturnType<typeof setTimeout> | null>(null);
  const [copied, setCopied] = useState(false);
  const [deleteConfirm, setDeleteConfirm] = useState(false);
  const [rotating, setRotating] = useState(false);
  const [editing, setEditing] = useState(false);
  const [editName, setEditName] = useState("");
  const [editUsername, setEditUsername] = useState("");
  const [editUrls, setEditUrls] = useState("");
  const [editTags, setEditTags] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const copyTimeoutRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // --- Load detail when item changes ---
  useEffect(() => {
    if (!item) {
      setDetail(null);
      setRevealedValue(null);
      setEditing(false);
      return;
    }
    let cancelled = false;
    const load = async () => {
      try {
        const r = await api.vault.items.get(item.id, project);
        if (cancelled) return;
        setDetail(r.data);
      } catch {
        if (!cancelled) setDetail(null);
      }
    };
    load();
    return () => { cancelled = true; };
  }, [item, project]);

  // --- Clear revealed value on unmount or item change ---
  useEffect(() => {
    setRevealedValue(null);
    if (revealTimer) clearTimeout(revealTimer);
    return () => {
      if (revealTimer) clearTimeout(revealTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [item?.id]);

  // --- Reveal ---
  const handleReveal = useCallback(async () => {
    if (!item) return;
    setError(null);
    try {
      const r = await api.vault.items.reveal(item.id, project);
      setRevealedValue(r.data.value);
      // Auto-hide after 30 seconds
      const timer = setTimeout(() => setRevealedValue(null), 30000);
      setRevealTimer(timer);
    } catch (e: any) {
      setError(e.message ?? "Failed to reveal secret");
    }
  }, [item, project]);

  // --- Copy ---
  const handleCopy = useCallback(async () => {
    if (!revealedValue) return;
    try {
      await navigator.clipboard.writeText(revealedValue);
      setCopied(true);
      if (copyTimeoutRef.current) clearTimeout(copyTimeoutRef.current);
      copyTimeoutRef.current = setTimeout(() => setCopied(false), 2000);
    } catch {
      // fallback — clipboard not available
    }
  }, [revealedValue]);

  // --- Delete ---
  const handleDelete = useCallback(async () => {
    if (!item) return;
    try {
      await api.vault.items.delete(item.id, project);
      setDeleteConfirm(false);
      onItemDeleted();
    } catch (e: any) {
      setError(e.message ?? "Failed to delete item");
    }
  }, [item, project, onItemDeleted]);

  // --- Rotate ---
  const handleRotate = useCallback(async () => {
    if (!item) return;
    setRotating(true);
    setError(null);
    try {
      const r = await api.vault.items.rotate(item.id, project);
      setRevealedValue(r.data.value);
      const timer = setTimeout(() => setRevealedValue(null), 30000);
      setRevealTimer(timer);
      onItemUpdated();
    } catch (e: any) {
      setError(e.message ?? "Failed to rotate secret");
    } finally {
      setRotating(false);
    }
  }, [item, project, onItemUpdated]);

  // --- Edit handlers ---
  const startEditing = useCallback(() => {
    if (!detail) return;
    setEditName(detail.name);
    setEditUsername(detail.username ?? "");
    setEditUrls(detail.urls ?? "");
    setEditTags(detail.tags ?? "");
    setEditing(true);
  }, [detail]);

  const handleSaveEdit = useCallback(async () => {
    if (!item) return;
    setSaving(true);
    setError(null);
    try {
      await api.vault.items.update(item.id, {
        name: editName,
        username: editUsername || undefined,
        urls: editUrls || undefined,
        tags: editTags || undefined,
      }, project);
      setEditing(false);
      onItemUpdated();
    } catch (e: any) {
      setError(e.message ?? "Failed to update item");
    } finally {
      setSaving(false);
    }
  }, [item, editName, editUsername, editUrls, editTags, project, onItemUpdated]);

  // --- Empty state ---
  if (!item) {
    return (
      <div className="flex items-center justify-center h-full">
        <p className="text-sm text-[var(--color-text-muted)]">
          Select an item to view details.
        </p>
      </div>
    );
  }

  const tags = detail?.tags
    ? detail.tags.split(",").map((t) => t.trim()).filter(Boolean)
    : [];

  const urls = detail?.urls
    ? detail.urls.split(/[\s,]+/).filter(Boolean)
    : [];

  return (
    <div className="flex flex-col h-full">
      {/* Item header */}
      <div className="px-4 py-3 border-b border-[var(--color-border)] shrink-0">
        {editing ? (
          <div className="space-y-2">
            <input
              type="text"
              value={editName}
              onChange={(e) => setEditName(e.target.value)}
              className="w-full border border-[var(--color-border)] rounded px-3 py-2 text-sm font-semibold bg-[var(--color-surface)] text-[var(--color-text-primary)]"
              autoFocus
            />
            <div className="flex gap-2">
              <button
                onClick={handleSaveEdit}
                disabled={!editName.trim() || saving}
                className="bg-blue-600 text-white py-1.5 px-3 rounded text-sm hover:bg-blue-700 transition-colors disabled:opacity-50"
              >
                {saving ? "Saving..." : "Save"}
              </button>
              <button
                onClick={() => setEditing(false)}
                className="border border-[var(--color-border)] py-1.5 px-3 rounded text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
              >
                Cancel
              </button>
            </div>
          </div>
        ) : (
          <div className="flex items-center justify-between">
            <div>
              <h2 className="text-lg font-semibold text-[var(--color-text-primary)]">
                {detail?.name ?? item.name}
              </h2>
              <div className="flex items-center gap-2 mt-1">
                <span
                  className={`${BADGE_BASE} ${badgeTones(
                    TYPE_HUE[item.type] ?? "gray"
                  )}`}
                >
                  {TYPE_LABEL[item.type] ?? item.type}
                </span>
                {detail?.folder_name && (
                  <span className="text-xs text-[var(--color-text-muted)]">
                    {detail.folder_name}
                  </span>
                )}
              </div>
            </div>
            <button
              onClick={startEditing}
              className="text-xs px-2 py-1 border border-[var(--color-border)] rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] transition-colors"
            >
              Edit
            </button>
          </div>
        )}
      </div>

      {/* Metadata */}
      <div className="px-4 py-3 space-y-3 flex-1 overflow-y-auto">
        {/* Error display */}
        {error && (
          <div className="bg-[var(--color-error-bg)] border border-[var(--color-error-border)] p-2 rounded text-xs text-[var(--color-error-text)]">
            {error}
          </div>
        )}

        {/* Username */}
        {detail?.username && (
          <div>
            <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
              Username
            </label>
            <p className="text-sm text-[var(--color-text-primary)] mt-0.5">
              {detail.username}
            </p>
          </div>
        )}

        {/* URLs */}
        {urls.length > 0 && (
          <div>
            <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
              URLs
            </label>
            <div className="mt-0.5 space-y-0.5">
              {urls.map((url, i) => (
                <a
                  key={i}
                  href={url.startsWith("http") ? url : `https://${url}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="block text-sm text-[var(--color-text-link)] hover:text-[var(--color-text-link-hover)] truncate"
                >
                  {url}
                </a>
              ))}
            </div>
          </div>
        )}

        {/* Tags */}
        {tags.length > 0 && (
          <div>
            <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
              Tags
            </label>
            <div className="flex flex-wrap gap-1 mt-0.5">
              {tags.map((tag, i) => (
                <span
                  key={i}
                  className="text-[10px] px-1.5 py-0.5 rounded bg-[var(--color-surface-muted)] text-[var(--color-text-muted)]"
                >
                  {tag}
                </span>
              ))}
            </div>
          </div>
        )}

        {/* Secret value section */}
        <div className="pt-2 border-t border-[var(--color-border-muted)]">
          <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
            Secret Value
          </label>
          <div className="mt-1">
            {revealedValue ? (
              <div className="space-y-2">
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={revealedValue}
                    readOnly
                    className="flex-1 border border-[var(--color-border)] rounded px-3 py-2 text-sm font-mono bg-[var(--color-surface-muted)] text-[var(--color-text-primary)]"
                  />
                  <button
                    onClick={handleCopy}
                    className={`shrink-0 py-2 px-3 rounded text-sm transition-colors ${
                      copied
                        ? "bg-[var(--color-success-bg)] text-[var(--color-success-text)]"
                        : "bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)]"
                    }`}
                  >
                    {copied ? "Copied!" : "Copy"}
                  </button>
                </div>
                <p className="text-xs text-[var(--color-text-muted)]">
                  Value hidden in {revealTimer ? "30 seconds" : "momentarily"}.
                </p>
              </div>
            ) : (
              <button
                onClick={handleReveal}
                className="bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)] py-2 px-4 rounded text-sm hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] border-dashed transition-colors"
              >
                Reveal Secret
              </button>
            )}
          </div>
        </div>

        {/* Dates */}
        {detail && (
          <div className="pt-2 border-t border-[var(--color-border-muted)]">
            <label className="text-xs font-medium text-[var(--color-text-muted)] uppercase tracking-wider">
              Details
            </label>
            <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
              Created: {new Date(detail.created_at).toLocaleString()}
            </p>
            <p className="text-xs text-[var(--color-text-muted)]">
              Updated: {new Date(detail.updated_at).toLocaleString()}
            </p>
          </div>
        )}
      </div>

      {/* Action bar */}
      <div className="px-4 py-3 border-t border-[var(--color-border)] flex gap-2 shrink-0">
        <button
          onClick={handleRotate}
          disabled={rotating}
          className="flex-1 bg-[var(--color-surface-muted)] text-[var(--color-text-secondary)] py-2 px-3 rounded text-sm hover:bg-[var(--color-surface-hover)] border border-[var(--color-border)] transition-colors disabled:opacity-50"
        >
          {rotating ? "Rotating..." : "Rotate"}
        </button>
        <button
          onClick={() => setDeleteConfirm(true)}
          className="flex-1 bg-[var(--color-error-bg)] text-[var(--color-error-text)] py-2 px-3 rounded text-sm hover:opacity-80 transition-colors"
        >
          Delete
        </button>
      </div>

      {/* Delete confirmation */}
      {deleteConfirm && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-center justify-center" onClick={() => setDeleteConfirm(false)}>
          <div
            className="bg-[var(--color-surface)] p-6 rounded-lg shadow-xl w-96"
            onClick={(e) => e.stopPropagation()}
          >
            <h3 className="text-lg font-semibold text-[var(--color-text-primary)] mb-2">
              Delete Item
            </h3>
            <p className="text-sm text-[var(--color-text-secondary)] mb-4">
              Are you sure you want to delete <strong>{detail?.name ?? item.name}</strong>?
              This action cannot be undone.
            </p>
            <div className="flex gap-2 justify-end">
              <button
                onClick={() => setDeleteConfirm(false)}
                className="px-4 py-2 border border-[var(--color-border)] rounded text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
              >
                Cancel
              </button>
              <button
                onClick={handleDelete}
                className="px-4 py-2 bg-red-600 text-white rounded text-sm hover:bg-red-700"
              >
                Delete
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
