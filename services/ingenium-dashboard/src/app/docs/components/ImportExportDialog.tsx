"use client";

import { useState, useEffect, useCallback, useRef } from "react";
import { createPortal } from "react-dom";
import { api } from "@/lib/api";
import type { ImportPreview } from "@/lib/docs-types";

type ImportExportDialogProps = {
  isOpen: boolean;
  onClose: () => void;
  spaceId: number;
};

type Tab = "import" | "export";

/**
 * ImportExportDialog — modal with Import/Export tabs.
 * Import: drag-drop or file picker for .md (with frontmatter) or .json (bulk export).
 * Export: Download JSON or (coming soon) Markdown archive of a space.
 * Uses createPortal to render outside the editor DOM tree for proper z-index stacking.
 */
export default function ImportExportDialog({ isOpen, onClose, spaceId }: ImportExportDialogProps) {
  const [activeTab, setActiveTab] = useState<Tab>("import");

  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose],
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center pt-[10vh]">
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      <div className="relative w-full max-w-lg bg-[var(--color-surface)] rounded-lg shadow-2xl border border-[var(--color-border)] mx-4 max-h-[80vh] flex flex-col">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-[var(--color-border)] shrink-0">
          <h2 className="text-base font-semibold text-[var(--color-text-primary)]">
            Import / Export
          </h2>
          <button
            className="p-1.5 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] rounded-full"
            onClick={onClose}
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Tabs */}
        <div className="flex border-b border-[var(--color-border)] shrink-0">
          <button
            className={`flex-1 px-4 py-2.5 text-sm font-medium text-center transition-colors ${
                activeTab === "import"
                ? "text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
            }`}
            onClick={() => setActiveTab("import")}
          >
            Import
          </button>
          <button
            className={`flex-1 px-4 py-2.5 text-sm font-medium text-center transition-colors ${
                activeTab === "export"
                ? "text-[var(--color-accent)] border-b-2 border-[var(--color-accent)]"
                : "text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)]"
            }`}
            onClick={() => setActiveTab("export")}
          >
            Export
          </button>
        </div>

        {/* Tab content */}
        <div className="flex-1 overflow-y-auto">
          {activeTab === "import" ? (
            <ImportTab spaceId={spaceId} onClose={onClose} />
          ) : (
            <ExportTab spaceId={spaceId} />
          )}
        </div>
      </div>
    </div>,
    document.body,
  );
}

/**
 * Import sub-tab — 4 states: empty (drop zone), preview (file parsed), success, error.
 * JSON: expects `[{title, slug, content, ...}]` or `{pages: [...]}` structure.
 * Markdown: single file with optional YAML frontmatter (title extracted from frontmatter or filename).
 */
function ImportTab({ spaceId, onClose }: { spaceId: number; onClose: () => void }) {
  const [file, setFile] = useState<File | null>(null);
  const [previews, setPreviews] = useState<ImportPreview[]>([]);
  const [uploading, setUploading] = useState(false);
  const [status, setStatus] = useState<{ type: "success" | "error"; message: string } | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const parseFile = async (f: File) => {
    setFile(f);
    setStatus(null);

    try {
      const text = await f.text();

      if (f.name.endsWith(".json")) {
        // JSON export format
        const data = JSON.parse(text);
        const pages = Array.isArray(data) ? data : data.pages ?? [];
        setPreviews(
          pages.map((p: any) => ({
            title: p.title || p.slug || "Untitled",
            slug: p.slug || "",
            content: p.content || "",
            spaceName: p.space_name || p.spaceName || "",
          })),
        );
      } else {
        // Markdown with optional frontmatter
        const fmMatch = text.match(/^---\n([\s\S]*?)\n---\n?([\s\S]*)$/);
        let title = f.name.replace(/\.md$/i, "");
        let content = text;
        if (fmMatch) {
          const fm = fmMatch[1]!;
          content = fmMatch[2]!.trimStart();
          const titleMatch = fm.match(/^title:\s*(.+)$/m);
          if (titleMatch) title = titleMatch[1]!.trim();
          else {
            const slugMatch = fm.match(/^slug:\s*(.+)$/m);
            if (slugMatch) title = slugMatch[1]!.trim();
          }
        }
        setPreviews([
          { title, slug: title.toLowerCase().replace(/\s+/g, "-"), content, spaceName: "" },
        ]);
      }
    } catch (e: any) {
      setStatus({ type: "error", message: `Failed to parse file: ${e.message}` });
      setPreviews([]);
    }
  };

  const handleFileChange = (e: React.ChangeEvent<HTMLInputElement>) => {
    const f = e.target.files?.[0];
    if (f) parseFile(f);
  };

  const handleDrop = (e: React.DragEvent) => {
    e.preventDefault();
    setDragging(false);
    const f = e.dataTransfer.files?.[0];
    if (f) parseFile(f);
  };

  const handleImport = async () => {
    if (!file) return;
    setUploading(true);
    setStatus(null);
    try {
      const text = await file.text();
      const format = file.name.endsWith(".json") ? "json" : "markdown";
      let data: unknown;
      if (format === "json") {
        data = JSON.parse(text);
      } else {
        // Single markdown file — wrap as array
        data = [{ title: file.name.replace(/\.md$/i, ""), slug: file.name.replace(/\.md$/i, "").toLowerCase().replace(/\s+/g, "-"), content: text }];
      }
      const res = await api.docs.importExport.importJson(spaceId, format, data);
      setStatus({
        type: "success",
        message: `Imported ${res?.data?.length ?? res?.total ?? previews.length} page(s) successfully.`,
      });
      setFile(null);
      setPreviews([]);
    } catch (e: any) {
      setStatus({ type: "error", message: e?.message ?? "Import failed" });
    } finally {
      setUploading(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      {/* Drop zone */}
      <div
        className={`border-2 border-dashed rounded-lg p-6 text-center transition-colors ${
          dragging
            ? "border-[var(--color-accent)] bg-[var(--color-surface-selected)]"
            : "border-[var(--color-border)] hover:border-[var(--color-accent)]"
        }`}
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={handleDrop}
        onClick={() => fileInputRef.current?.click()}
      >
        <svg
          className="w-10 h-10 text-[var(--color-text-muted)] mx-auto mb-2"
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            strokeWidth={1.5}
            d="M7 16a4 4 0 01-.88-7.903A5 5 0 1115.9 6L16 6a5 5 0 011 9.9M15 13l-3-3m0 0l-3 3m3-3v12"
          />
        </svg>
        <p className="text-sm text-[var(--color-text-secondary)]">
          {file ? file.name : "Drag & drop a file or click to browse"}
        </p>
        <p className="text-xs text-[var(--color-text-muted)] mt-1">
          Accepted: .md (Markdown), .json (JSON export)
        </p>
        <input
          ref={fileInputRef}
          type="file"
          accept=".md,.json"
          className="hidden"
          onChange={handleFileChange}
        />
      </div>

      {/* Preview */}
      {previews.length > 0 && (
        <div>
          <h4 className="text-sm font-medium text-[var(--color-text-primary)] mb-2">
            Preview ({previews.length} page{previews.length !== 1 ? "s" : ""})
          </h4>
          <div className="space-y-2 max-h-48 overflow-y-auto">
            {previews.map((p, idx) => (
              <div
                key={idx}
                className="p-2.5 border border-[var(--color-border)] rounded text-sm"
              >
                <span className="font-medium text-[var(--color-text-primary)]">{p.title}</span>
                <span className="text-[var(--color-text-muted)] ml-2">→ {p.slug}</span>
                <p className="text-xs text-[var(--color-text-muted)] mt-0.5 line-clamp-2">
                  {p.content.slice(0, 150)}
                </p>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Status */}
      {status && (
        <div
          className={`p-3 rounded text-sm ${
            status.type === "success"
              ? "bg-[var(--color-success-bg)] text-green-700 dark:text-green-300"
              : "bg-[var(--color-error-bg)] text-red-700 dark:text-red-300"
          }`}
        >
          {status.message}
        </div>
      )}

      {/* Actions */}
      {file && previews.length > 0 && (
        <div className="flex gap-2">
          <button
            className="flex-1 px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
            disabled={uploading || !file}
            onClick={handleImport}
          >
            {uploading ? (
              <span className="flex items-center justify-center gap-2">
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24">
                  <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                  <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                </svg>
                Importing…
              </span>
            ) : (
              "Import"
            )}
          </button>
          <button
            className="px-4 py-2 text-sm text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] border border-[var(--color-border)] rounded"
            onClick={() => {
              setFile(null);
              setPreviews([]);
              setStatus(null);
            }}
          >
            Clear
          </button>
        </div>
      )}
    </div>
  );
}

/** Export sub-tab */
function ExportTab({ spaceId }: { spaceId: number }) {
  const [exporting, setExporting] = useState(false);
  const [error, setError] = useState("");

  const handleExportJson = async () => {
    setExporting(true);
    setError("");
    try {
      const res = await api.docs.importExport.exportSpace(spaceId);
      if (res?.data) {
        const blob = new Blob([JSON.stringify(res.data, null, 2)], { type: "application/json" });
        const url = URL.createObjectURL(blob);
        const a = document.createElement("a");
        a.href = url;
        a.download = `space-${spaceId}-export.json`;
        a.click();
        URL.revokeObjectURL(url);
      }
    } catch (e: any) {
      setError(e?.message ?? "Export failed");
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="p-4 space-y-4">
      <div className="p-4 border border-[var(--color-border)] rounded-lg space-y-3">
        <h4 className="text-sm font-medium text-[var(--color-text-primary)]">
          Export space as JSON
        </h4>
        <p className="text-xs text-[var(--color-text-muted)]">
          Downloads a JSON file containing all pages, attachments, and metadata. Suitable for backup or transferring to another workspace.
        </p>
        <button
          className="w-full px-4 py-2 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed"
          disabled={exporting}
          onClick={handleExportJson}
        >
          {exporting ? "Exporting…" : "Download JSON"}
        </button>
      </div>

      <div className="p-4 border border-[var(--color-border)] rounded-lg space-y-3">
        <h4 className="text-sm font-medium text-[var(--color-text-primary)]">
          Export space as Markdown files
        </h4>
        <p className="text-xs text-[var(--color-text-muted)]">
          Downloads each page as a separate .md file with YAML frontmatter. Markdown export is currently available as individual file downloads through the page menu.
        </p>
        <button
          className="w-full px-4 py-2 text-sm text-[var(--color-text-muted)] border border-[var(--color-border)] rounded cursor-not-allowed opacity-50"
          disabled
        >
          Coming soon
        </button>
      </div>

      {error && (
        <div className="p-3 rounded text-sm bg-[var(--color-error-bg)] text-red-700 dark:text-red-300">
          {error}
        </div>
      )}
    </div>
  );
}
