"use client";

import { useState, useEffect, useRef, useCallback, useMemo } from "react";
import { marked } from "marked";
import DOMPurify from "dompurify";
import { EditorView, lineNumbers, highlightActiveLine } from "@codemirror/view";
import { EditorState } from "@codemirror/state";
import { markdown } from "@codemirror/lang-markdown";
import { oneDark } from "@codemirror/theme-one-dark";
import EditorToolbar, { type EditorMode } from "./EditorToolbar";
import AIActions from "./AIActions";
import DictationButton from "./DictationButton";
import type { DocPage, DocDraft } from "@/lib/docs-types";

interface DocsEditorProps {
  page: DocPage;
  mode: EditorMode;
  onSave: (content: string) => Promise<void>;
  /** Pre-loaded draft content from a previous autosave session */
  draftContent?: string;
  onModeChange?: (mode: EditorMode) => void;
}

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4097/api/v1";
/** PERF: 5s interval balances responsiveness vs write pressure on SQLite WAL. */
const AUTOSAVE_INTERVAL = 5000;
/** PREVIEW_DEBOUNCE: shorter than autosave — only drives the live preview panel, not persistence. */
const PREVIEW_DEBOUNCE = 300;

marked.setOptions({ gfm: true, breaks: false });

/**
 * Render Markdown to safe HTML with custom handling:
 * - [[page-slug]] → internal link placeholder
 * - > **Note:** ... → callout block with colored left border
 */
function renderMarkdown(content: string): string {
  if (!content) return "";

  // Pre-process: convert [[page-slug]] to internal links
  let processed = content.replace(
    /\[\[([^\]]+)\]\]/g,
    (_match, slug) => `<a href="/docs/${slug}" class="internal-link" data-internal="true">${slug}</a>`,
  );

  // Pre-process: convert callout blocks (only when they start a line)
  // Pattern: > **Note:** or > **Warning:** etc.
  processed = processed.replace(
    /^>\s*\*\*(Note|Warning|Info|Tip|Danger|Success):\*\*(.*?)(?:\n> (.*?))*(?=\n\n|\n(?!>)|$)/gm,
    (_match, type: string, ...rest: string[]) => {
      // Reconstruct the full block content
      const fullMatch = _match;
      const contentWithoutCallout = fullMatch
        .replace(/^>\s*\*\*(Note|Warning|Info|Tip|Danger|Success):\*\*/m, "")
        .replace(/^>\s?/gm, "")
        .trim();
      const typeLower = type.toLowerCase();
      const colors: Record<string, string> = {
        note: "#3b82f6",
        warning: "#f59e0b",
        danger: "#ef4444",
        info: "#06b6d4",
        tip: "#10b981",
        success: "#22c55e",
      };
      const borderColor = colors[typeLower] || "#3b82f6";
      return `<div class="callout callout-${typeLower}" style="border-left: 4px solid ${borderColor}; padding: 0.5rem 1rem; margin: 0.75rem 0; background: var(--color-surface-hover); border-radius: 0 4px 4px 0;">
<strong>${type}:</strong> ${contentWithoutCallout}
</div>`;
    },
  );

  const html = marked.parse(processed, { async: false }) as string;
  return DOMPurify.sanitize(html, {
    ADD_ATTR: ["target", "data-internal"],
  });
}

async function fetchDraft(pageId: number): Promise<DocDraft | null> {
  try {
    const res = await fetch(`${API_BASE}/docs/pages/${pageId}/draft`);
    if (!res.ok) return null;
    const json = await res.json();
    return json.data || null;
  } catch {
    return null;
  }
}

async function saveDraft(pageId: number, content: string): Promise<void> {
  try {
    await fetch(`${API_BASE}/docs/pages/${pageId}/draft`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ content }),
    });
  } catch {
    // Silently fail — drafts are best-effort
  }
}

async function deleteDraft(pageId: number): Promise<void> {
  try {
    await fetch(`${API_BASE}/docs/pages/${pageId}/draft`, { method: "DELETE" });
  } catch {
    // silently fail
  }
}

/**
 * Build the string to insert for a markdown syntax template.
 * Returns { newValue, cursorOffset } where cursorOffset is the position
 * of the cursor within the inserted text.
 */
function buildMarkdownInsertion(
  currentValue: string,
  selectionStart: number,
  selectionEnd: number,
  syntax: string,
): { newValue: string; cursorOffset: number } {
  const before = currentValue.slice(0, selectionStart);
  const selected = currentValue.slice(selectionStart, selectionEnd);
  const after = currentValue.slice(selectionEnd);

  // Handle different syntax types
  switch (syntax) {
    case "**text**": {
      const wrap = selected ? `**${selected}**` : "****";
      const newValue = before + wrap + after;
      return { newValue, cursorOffset: before.length + (selected ? wrap.length : 2) };
    }
    case "*text*": {
      const wrap = selected ? `*${selected}*` : "**";
      const newValue = before + wrap + after;
      return { newValue, cursorOffset: before.length + (selected ? wrap.length : 1) };
    }
    case "[text](url)": {
      const wrap = selected ? `[${selected}](url)` : "[](url)";
      const newValue = before + wrap + after;
      return { newValue, cursorOffset: before.length + (selected ? selected.length + 3 : 1) };
    }
    case "![alt](url)": {
      const wrap = selected ? `![${selected}](url)` : "![](url)";
      const newValue = before + wrap + after;
      return { newValue, cursorOffset: before.length + (selected ? selected.length + 3 : 2) };
    }
    case "```\ncode\n```": {
      const wrap = selected ? `\`\`\`\n${selected}\n\`\`\`` : "\`\`\`\n\n\`\`\`";
      const newValue = before + wrap + after;
      return { newValue, cursorOffset: before.length + (selected ? wrap.length : 4) };
    }
    case "| Col 1 | Col 2 |\n|-------|-------|\n|       |       |": {
      const table = "| Col 1 | Col 2 |\n|-------|-------|\n|       |       |";
      const newValue = before + "\n" + table + after;
      return { newValue, cursorOffset: before.length + 3 };
    }
    case "\n---\n": {
      const newValue = before + "\n---\n" + after;
      return { newValue, cursorOffset: before.length + 5 };
    }
    default: {
      // Line-level prefixes: "# ", "## ", "### ", "- ", "1. ", "- [ ] ", "> "
      const lineStart = before.lastIndexOf("\n") + 1;
      const newValue = before.slice(0, lineStart) + syntax + before.slice(lineStart) + selected + after;
      return { newValue, cursorOffset: lineStart + syntax.length + selected.length };
    }
  }
}

/**
 * DocsEditor — multi-mode document editor supporting View/Edit/Source/Split modes.
 *
 * Architecture:
 *   - View: Renders Markdown → sanitized HTML (DOMPurify).
 *   - Edit: Plain <textarea> with manual markdown insertion buttons.
 *   - Source: CodeMirror 6 with markdown language extension + oneDark theme.
 *   - Split: CodeMirror (left) + live-rendered preview (right).
 *
 * Autosave writes drafts to the API every 5s. On mount, checks for an existing
 * draft and offers to restore it. Draft is deleted after a successful explicit save.
 */
const DocsEditor: React.FC<DocsEditorProps> = ({ page, mode, onSave, draftContent, onModeChange }) => {
  const [content, setContent] = useState<string>(page.content || "");
  const [editorMode, setEditorMode] = useState<EditorMode>(mode);
  const [saveStatus, setSaveStatus] = useState<"idle" | "saving" | "saved" | "error">("idle");
  const [saveError, setSaveError] = useState<string | null>(null);
  const [hasDraft, setHasDraft] = useState<boolean>(!!draftContent);
  const [showDraftPrompt, setShowDraftPrompt] = useState<boolean>(false);
  const [isSaving, setIsSaving] = useState(false);

  /**
   * contentRef tracks latest content for the autosave interval callback,
   * avoiding stale closures without adding `content` to the effect dependency array.
   * CodeMirror refs are managed separately to control lifecycle (mount/destroy) explicitly.
   */
  const codeMirrorRef = useRef<HTMLDivElement>(null);
  const codeMirrorViewRef = useRef<EditorView | null>(null);
  const previewRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const contentRef = useRef(content);
  const autosaveTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const previewTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const splitPreviewContentRef = useRef(content);

  useEffect(() => { contentRef.current = content; }, [content]);

  // Sync external mode prop
  useEffect(() => {
    setEditorMode(mode);
  }, [mode]);

  /**
   * Draft check on mount — queries the API for an autosaved draft.
   * Uses a cancellation flag to avoid state updates after unmount.
   * HACK: Draft content must differ from page.content, or we assume the page was saved.
   */
  useEffect(() => {
    let cancelled = false;
    async function checkDraft() {
      const draft = await fetchDraft(page.id);
      if (cancelled) return;
      if (draft && draft.content && draft.content !== page.content) {
        setHasDraft(true);
        setShowDraftPrompt(true);
      }
    }
    checkDraft();
    return () => { cancelled = true; };
  }, [page.id, page.content]);

  /**
   * Autosave — writes a draft every AUTOSAVE_INTERVAL ms.
   * Skipped in "view" mode because the user isn't editing.
   * PERF: Uses contentRef to avoid restarting the interval on every keystroke change to `content`.
   * The interval only restarts when editorMode, page.id, or page.content reference changes.
   */
  useEffect(() => {
    if (editorMode === "view") return;
    autosaveTimerRef.current = setInterval(() => {
      const current = contentRef.current;
      if (current !== page.content) {
        saveDraft(page.id, current).then(() => {
          setSaveStatus("saved");
          setTimeout(() => setSaveStatus("idle"), 2000);
        }).catch(() => {
          setSaveStatus("error");
        });
      }
    }, AUTOSAVE_INTERVAL);
    return () => {
      if (autosaveTimerRef.current) clearInterval(autosaveTimerRef.current);
    };
  }, [editorMode, page.id, page.content]);

  /** Split preview — debounced so rapid typing doesn't re-render the preview on every keystroke. */
  const [splitPreview, setSplitPreview] = useState(content);
  useEffect(() => {
    if (editorMode !== "split") return;
    previewTimerRef.current = setTimeout(() => {
      setSplitPreview(content);
      splitPreviewContentRef.current = content;
    }, PREVIEW_DEBOUNCE);
    return () => { if (previewTimerRef.current) clearTimeout(previewTimerRef.current); };
  }, [content, editorMode]);

  /**
   * CodeMirror lifecycle — managed by editorMode transitions:
   *   - Entering source or split mode: create EditorView with markdown + lineNumbers + oneDark.
   *   - Already mounted in target mode: update doc content if it changed externally.
   *   - Leaving source or split mode: destroy the EditorView instance.
   *
   * NOTE: eslint-disable react-hooks/exhaustive-deps intentional — adding `content` as a dep
   * would re-create the EditorView on every keystroke. Content sync is handled separately
   * via the effect below this one.
   */
  useEffect(() => {
    if (editorMode !== "source" && editorMode !== "split") {
      if (codeMirrorViewRef.current) {
        codeMirrorViewRef.current.destroy();
        codeMirrorViewRef.current = null;
      }
      return;
    }
    if (!codeMirrorRef.current) return;
    if (codeMirrorViewRef.current) {
      const currentContent = codeMirrorViewRef.current.state.doc.toString();
      if (currentContent !== content) {
        codeMirrorViewRef.current.dispatch({
          changes: { from: 0, to: currentContent.length, insert: content },
        });
      }
      return;
    }
    const updateListener = EditorView.updateListener.of((update) => {
      if (update.docChanged) {
        const newContent = update.state.doc.toString();
        setContent(newContent);
      }
    });
    const view = new EditorView({
      doc: content,
      extensions: [
        lineNumbers(),
        highlightActiveLine(),
        markdown(),
        oneDark,
        updateListener,
        EditorView.lineWrapping,
        EditorState.tabSize.of(2),
      ],
      parent: codeMirrorRef.current,
    });
    codeMirrorViewRef.current = view;
    return () => { /* destroy handled in mode-switch path above */ };
  }, [editorMode]); // eslint-disable-line react-hooks/exhaustive-deps

  /**
   * Push content into CodeMirror when mode switches TO source/split.
   * Without this, switching from "edit" to "source" would show stale content
   * because CodeMirror was created with the initial doc value.
   * NOTE: Dep exclusion on `content` is intentional — we only need to sync on mode transition,
   * not on every keystroke (which is already handled by the updateListener inside CodeMirror).
   */
  useEffect(() => {
    if ((editorMode === "source" || editorMode === "split") && codeMirrorViewRef.current) {
      const currentContent = codeMirrorViewRef.current.state.doc.toString();
      if (currentContent !== content) {
        codeMirrorViewRef.current.dispatch({
          changes: { from: 0, to: currentContent.length, insert: content },
        });
      }
    }
  }, [editorMode]); // eslint-disable-line react-hooks/exhaustive-deps

  // ── Mode change handler ────────────────────────────────────────────────────
  const handleModeChange = useCallback(
    (newMode: EditorMode) => {
      setEditorMode(newMode);
      onModeChange?.(newMode);
    },
    [onModeChange],
  );

  // ── Insert markdown (for textarea in edit mode) ────────────────────────────
  const handleInsertMarkdown = useCallback(
    (syntax: string) => {
      if (editorMode === "edit" && textareaRef.current) {
        const ta = textareaRef.current;
        const start = ta.selectionStart;
        const end = ta.selectionEnd;
        const { newValue, cursorOffset } = buildMarkdownInsertion(content, start, end, syntax);
        setContent(newValue);
        // Restore cursor position after React re-render
        requestAnimationFrame(() => {
          ta.focus();
          ta.setSelectionRange(cursorOffset, cursorOffset);
        });
      } else if ((editorMode === "source" || editorMode === "split") && codeMirrorViewRef.current) {
        const view = codeMirrorViewRef.current;
        const selection = view.state.selection.main;
        const start = selection.from;
        const end = selection.to;
        const currentContent = view.state.doc.toString();
        const { newValue, cursorOffset } = buildMarkdownInsertion(currentContent, start, end, syntax);
        view.dispatch({
          changes: { from: 0, to: currentContent.length, insert: newValue },
          selection: { anchor: cursorOffset, head: cursorOffset },
        });
        view.focus();
      }
    },
    [content, editorMode],
  );

  // ── Content change handler (textarea) ──────────────────────────────────────
  const handleContentChange = useCallback(
    (e: React.ChangeEvent<HTMLTextAreaElement>) => {
      setContent(e.target.value);
    },
    [],
  );

  /**
   * Explicit save — calls onSave (parent handler, e.g. PUT /api/docs/pages/:id),
   * then deletes the autosave draft. On 409 conflict, shows a user-facing message
   * instead of silently overwriting another session's changes.
   */
  const handleSave = useCallback(async () => {
    setIsSaving(true);
    setSaveError(null);
    try {
      await onSave(content);
      setSaveStatus("saved");
      await deleteDraft(page.id);
      setHasDraft(false);
      setTimeout(() => setSaveStatus("idle"), 2000);
    } catch (err: any) {
      const message = err.message || "Save failed";
      if (message.includes("409") || message.includes("conflict") || message.includes("modified since")) {
        setSaveError("Page was modified by another session. Reload to see latest.");
      } else {
        setSaveError(message);
      }
      setSaveStatus("error");
    } finally {
      setIsSaving(false);
    }
  }, [content, onSave, page.id]);

  // ── Restore draft ──────────────────────────────────────────────────────────
  const handleRestoreDraft = useCallback(async () => {
    const draft = await fetchDraft(page.id);
    if (draft && draft.content) {
      setContent(draft.content);
    }
    setShowDraftPrompt(false);
  }, [page.id]);

  const handleDiscardDraft = useCallback(async () => {
    await deleteDraft(page.id);
    setHasDraft(false);
    setShowDraftPrompt(false);
  }, [page.id]);

  // ── AI apply handler ───────────────────────────────────────────────────────
  const handleAIApply = useCallback(
    (aiResult: string) => {
      setContent(aiResult);
      if (textareaRef.current) {
        textareaRef.current.focus();
      }
      if (codeMirrorViewRef.current) {
        const view = codeMirrorViewRef.current;
        const current = view.state.doc.toString();
        view.dispatch({
          changes: { from: 0, to: current.length, insert: aiResult },
        });
        view.focus();
      }
    },
    [],
  );

  // ── Dictation handler ──────────────────────────────────────────────────────
  const handleDictation = useCallback(
    (text: string, isFinal: boolean) => {
      if (isFinal) {
        setContent((prev) => {
          const trimmed = prev.trimEnd();
          const separator = trimmed ? " " : "";
          return trimmed + separator + text;
        });
      }
      // Interim text is not appended — shown only during dictation
    },
    [],
  );

  // Save status indicator
  const saveIndicator = useMemo(() => {
    if (editorMode === "view") return null;
    return (
      <span className="text-xs text-[var(--color-text-muted)] shrink-0">
        {saveStatus === "saving" && "Saving..."}
        {saveStatus === "saved" && "Saved"}
        {saveStatus === "error" && "Error saving"}
        {saveStatus === "idle" && hasDraft && "Draft"}
      </span>
    );
  }, [editorMode, saveStatus, hasDraft]);

  // Draft restore prompt
  const draftPrompt = useMemo(() => {
    if (!showDraftPrompt) return null;
    return (
      <div className="mx-4 mt-2 p-3 bg-amber-50 dark:bg-amber-950 border border-amber-200 dark:border-amber-800 rounded flex items-center justify-between text-sm">
        <span className="text-[var(--color-text-primary)]">
          An autosaved draft was found. Would you like to restore it?
        </span>
        <div className="flex gap-2 shrink-0 ml-4">
          <button
            type="button"
            onClick={handleRestoreDraft}
            className="px-3 py-1 text-xs rounded bg-amber-600 text-white hover:bg-amber-700"
          >
            Restore
          </button>
          <button
            type="button"
            onClick={handleDiscardDraft}
            className="px-3 py-1 text-xs rounded bg-[var(--color-surface-hover)] hover:bg-[var(--color-border)] text-[var(--color-text-secondary)]"
          >
            Discard
          </button>
        </div>
      </div>
    );
  }, [showDraftPrompt, handleRestoreDraft, handleDiscardDraft]);

  return (
    <div className="flex flex-col h-full border border-[var(--color-border)] rounded overflow-hidden">
      {/* Toolbar */}
      <EditorToolbar
        mode={editorMode}
        onModeChange={handleModeChange}
        onInsertMarkdown={handleInsertMarkdown}
      />

      {/* Save bar (edit/source/split modes only) */}
      {editorMode !== "view" && (
        <div className="flex items-center gap-2 px-3 py-1.5 bg-[var(--color-surface)] border-b border-[var(--color-border)] text-xs">
          <button
            type="button"
            onClick={handleSave}
            disabled={isSaving}
            className="px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700 disabled:opacity-50 text-xs font-medium"
          >
            {isSaving ? "Saving..." : "Save"}
          </button>
          {saveIndicator}
          <div className="flex-1" />
          <DictationButton onText={handleDictation} />
          <AIActions
            selectedText={undefined}
            fullContent={content}
            pageTitle={page.title}
            onApply={handleAIApply}
          />
        </div>
      )}

      {/* Error bar */}
      {saveError && (
        <div className="px-3 py-1.5 bg-red-50 dark:bg-red-950 border-b border-red-200 dark:border-red-800 text-xs text-red-600 dark:text-red-400">
          {saveError}
          <button
            type="button"
            onClick={() => setSaveError(null)}
            className="ml-2 underline hover:no-underline"
          >
            Dismiss
          </button>
        </div>
      )}

      {/* Draft prompt */}
      {draftPrompt}

      {/* Editor content area */}
      <div className="flex-1 overflow-hidden">
        {/* View mode */}
        {editorMode === "view" && (
          <div
            className="prose prose-sm max-w-none dark:prose-invert p-6 overflow-y-auto h-full"
            dangerouslySetInnerHTML={{ __html: renderMarkdown(content) }}
          />
        )}

        {/* Edit mode — textarea */}
        {editorMode === "edit" && (
          <textarea
            ref={textareaRef}
            value={content}
            onChange={handleContentChange}
            className="w-full h-full resize-none p-4 font-mono text-sm leading-relaxed bg-[var(--color-surface)] text-[var(--color-text-primary)] focus:outline-none"
            placeholder="Write your documentation in Markdown..."
            spellCheck
          />
        )}

        {/* Source mode — CodeMirror */}
        {editorMode === "source" && (
          <div ref={codeMirrorRef} className="h-full overflow-auto" />
        )}

        {/* Split mode — CodeMirror + Preview */}
        {editorMode === "split" && (
          <div className="flex h-full">
            {/* Left: CodeMirror */}
            <div className="w-1/2 border-r border-[var(--color-border)] overflow-auto">
              <div ref={codeMirrorRef} className="h-full" />
            </div>
            {/* Right: Preview */}
            <div className="w-1/2 overflow-y-auto p-4 prose prose-sm max-w-none dark:prose-invert">
              <div
                ref={previewRef}
                dangerouslySetInnerHTML={{ __html: renderMarkdown(splitPreview) }}
              />
            </div>
          </div>
        )}
      </div>
    </div>
  );
};

export default DocsEditor;
