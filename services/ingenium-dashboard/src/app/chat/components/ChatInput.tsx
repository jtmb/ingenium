"use client";

import ComposerMenu from "./ComposerMenu";
import { useState, useRef, useCallback, useEffect, useLayoutEffect, type ReactNode } from "react";

export interface SendOptions {
  providerId?: string;
  modelId?: string;
  agentName?: string;
  useProjectContext?: boolean;
  useSavedMemory?: boolean;
  saveToMemory?: boolean;
}

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  dataUrl?: string; // Base64 data URL for images
  content?: string; // Text content
  isImage: boolean;
  pending?: boolean;
  error?: string;
}

interface ChatInputProps {
  onSend: (message: string, options?: SendOptions) => Promise<boolean>;
  onStop: () => void;
  isLoading: boolean;
  providerId?: string;
  modelId?: string;
  agentName?: string;
  attachments: Attachment[];
  onAttachmentsChange: (attachments: Attachment[]) => void;
  hasSelectableModel?: boolean;
  /** Display-only reminder of the validated project that optional context searches use. */
  projectContextProject?: string;
  memoryWorkspaceId?: string | null;
  memoryCanRead?: boolean;
  memoryCanSave?: boolean;
  memoryUnavailableReason?: string | null;
  memorySavePending?: boolean;
  modelControl?: ReactNode;
  showSuggestions?: boolean;
  variant?: "chat" | "home";
  projectControl?: ReactNode;
  onOpenTools?: () => void;
  renderConversationOptions?: (close: () => HTMLButtonElement | null) => ReactNode;
}

const MAX_FILE_SIZE = 10 * 1024 * 1024; // 10MB
const MAX_FILES = 5;
const TEXT_EXTENSIONS = /\.(txt|md|json|ts|tsx|js|jsx|py|rb|go|rs|java|cpp|c|h|hpp|css|scss|html|xml|yaml|yml|toml|ini|cfg|sh|bash|zsh|sql|graphql|vue|svelte|astro)$/i;

/** Generate a unique ID for each attachment. */
let _attachId = 0;
function nextAttachId(): string {
  return `attach-${Date.now()}-${++_attachId}`;
}

/** Format bytes to human-readable size. */
function formatSize(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

/** Truncate filename if too long. */
function truncateName(name: string, max = 24): string {
  if (name.length <= max) return name;
  const ext = name.lastIndexOf(".");
  if (ext > 0 && name.length - ext <= 6) {
    const base = name.slice(0, ext);
    const suffix = name.slice(ext);
    return `${base.slice(0, max - suffix.length - 3)}...${suffix}`;
  }
  return `${name.slice(0, max - 3)}...`;
}

/** Check if a MIME type is an image. */
function isImageMime(mime: string): boolean {
  return mime.startsWith("image/");
}

/** Check if a filename has a text extension. */
function isTextFile(name: string): boolean {
  return TEXT_EXTENSIONS.test(name);
}

/**
 * ChatGPT-style composer bar.
 *
 * Features:
 * - Rounded-2xl container with border
 * - Auto-growing textarea (max 200px, min 24px single-line)
 * - Enter to send, Shift+Enter for newline
 * - Send button (right arrow) when idle, Stop button (square) when loading
 * - Attachment button with file picker + drag-and-drop
 * - Attachment preview pills above textarea
 * - Passes provider/model/agent info to the send handler
 * - Footer: "Ingenium Chat" credit
 */
export default function ChatInput({
  onSend,
  onStop,
  isLoading,
  providerId,
  modelId,
  agentName,
  attachments,
  onAttachmentsChange,
  hasSelectableModel = true,
  projectContextProject,
  memoryWorkspaceId,
  memoryCanRead = false,
  memoryCanSave = false,
  memoryUnavailableReason,
  memorySavePending = false,
  modelControl,
  showSuggestions = false,
  variant = "chat",
  projectControl,
  onOpenTools,
  renderConversationOptions,
}: ChatInputProps) {
  const home = variant === "home";
  const [value, setValue] = useState("");
  const [useProjectContext, setUseProjectContext] = useState(false);
  const [useSavedMemory, setUseSavedMemory] = useState(false);
  const [saveToMemory, setSaveToMemory] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const [sending, setSending] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);
  const attachmentsRef = useRef(attachments);
  const readers = useRef(new Map<string, FileReader>());
  const mounted = useRef(true);
  const [attachmentSelectionError, setAttachmentSelectionError] = useState<string | null>(null);
  useLayoutEffect(() => { attachmentsRef.current = attachments; }, [attachments]);
  useEffect(() => {
    mounted.current = true;
    const activeReaders = readers.current;
    return () => { mounted.current = false; for (const reader of activeReaders.values()) reader.abort(); activeReaders.clear(); };
  }, []);

  const autoResize = useCallback(() => {
    const el = textareaRef.current;
    if (!el) return;
    el.style.height = "24px";
    const scrollHeight = el.scrollHeight;
    el.style.height = `${Math.min(scrollHeight, 200)}px`;
  }, []);

  useEffect(() => {
    autoResize();
  }, [value, autoResize]);

  /** Process selected files and add them as attachments. */
  const processFiles = useCallback(
    (files: FileList | File[]) => {
      if (isLoading || sending) return;
      const fileArr = Array.from(files);
      if (!fileArr.length) return;
      if (fileArr.length > MAX_FILES - attachmentsRef.current.length) {
        setAttachmentSelectionError(`Choose up to ${MAX_FILES} files in total. No files from this selection were added.`);
        if (fileInputRef.current) fileInputRef.current.value = "";
        return;
      }
      setAttachmentSelectionError(null);
      const selected = fileArr.map(file => ({ file, attachment: {
        id: nextAttachId(), name: file.name, mime: file.type || (isTextFile(file.name) ? "text/plain" : "application/octet-stream"),
        size: file.size, isImage: isImageMime(file.type), pending: file.size <= MAX_FILE_SIZE,
        ...(file.size > MAX_FILE_SIZE ? { error: "File exceeds the 10 MiB attachment limit." } : {}),
      } satisfies Attachment }));
      attachmentsRef.current = [...attachmentsRef.current, ...selected.map(item => item.attachment)];
      onAttachmentsChange(attachmentsRef.current);
      for (const { file, attachment } of selected) {
        if (attachment.error) continue;
        const reader = new FileReader();
        readers.current.set(attachment.id, reader);
        const finish = (error?: string) => {
          if (!mounted.current || readers.current.get(attachment.id) !== reader) return;
          readers.current.delete(attachment.id);
          const payload = typeof reader.result === "string" ? reader.result.match(/^data:[^,]*;base64,([A-Za-z0-9+/=]*)$/)?.[1] : undefined;
          const failure = error ?? (payload === undefined ? "The selected file could not be read." : undefined);
          attachmentsRef.current = attachmentsRef.current.map(item => item.id !== attachment.id ? item : {
            ...item, pending: false, ...(failure ? { error: failure } : { dataUrl: `data:${attachment.mime};base64,${payload}` }),
          });
          onAttachmentsChange(attachmentsRef.current);
        };
        reader.onload = () => finish();
        reader.onerror = () => finish("The selected file could not be read. Remove it and choose the file again.");
        try { reader.readAsDataURL(file); } catch { finish("The selected file could not be read."); }
      }

      // Reset file input so the same file can be re-selected
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [isLoading, sending, onAttachmentsChange],
  );

  /** Remove a single attachment by ID. */
  const removeAttachment = useCallback(
    (id: string) => {
      const reader = readers.current.get(id);
      readers.current.delete(id);
      reader?.abort();
      attachmentsRef.current = attachmentsRef.current.filter(item => item.id !== id);
      onAttachmentsChange(attachmentsRef.current);
    },
    [onAttachmentsChange],
  );

  /** File input change handler. */
  const handleFileChange = useCallback(
    (e: React.ChangeEvent<HTMLInputElement>) => {
      if (e.target.files && e.target.files.length > 0) {
        processFiles(e.target.files);
      }
    },
    [processFiles],
  );

  /** Drag-and-drop handlers. */
  const handleDragOver = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(true);
  }, []);

  const handleDragLeave = useCallback((e: React.DragEvent) => {
    e.preventDefault();
    e.stopPropagation();
    setIsDragOver(false);
  }, []);

  const handleDrop = useCallback(
    (e: React.DragEvent) => {
      e.preventDefault();
      e.stopPropagation();
      setIsDragOver(false);
      if (e.dataTransfer.files && e.dataTransfer.files.length > 0) {
        processFiles(e.dataTransfer.files);
      }
    },
    [processFiles],
  );

  const handleSend = async (overrides?: Pick<SendOptions, "useProjectContext" | "saveToMemory">) => {
    const trimmed = value.trim();
    if (!trimmed || isLoading || sending || !hasSelectableModel || attachmentSelectionError
      || attachmentsRef.current.some(item => item.pending || item.error || !item.dataUrl)) return;
    setSending(true);
    try {
      const accepted = await onSend(trimmed, {
        providerId,
        modelId,
        agentName,
        useProjectContext,
        useSavedMemory: Boolean(memoryWorkspaceId) && memoryCanRead && useSavedMemory,
        saveToMemory: Boolean(memoryWorkspaceId) && memoryCanSave && !memorySavePending && saveToMemory,
        ...overrides,
      });
      if (accepted) {
        setValue("");
        // Reset textarea height
        if (textareaRef.current) {
          textareaRef.current.style.height = "24px";
        }
        setUseProjectContext(false);
        setSaveToMemory(false);
      }
    } catch {
      // Swallow — input text is preserved so user can retry
    } finally {
      setSending(false);
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === "Enter" && !e.shiftKey) {
      e.preventDefault();
      if (!hasSelectableModel) return;
      handleSend();
    }
  };

  const hasText = value.trim().length > 0;
  const canAttachMore = attachments.length < MAX_FILES;
  const attachmentsBlocked = !!attachmentSelectionError || attachments.some(item => item.pending || item.error || !item.dataUrl);

  const contextOptions = (
        <details className="veyra-context-options">
          <summary className="cursor-pointer px-4 py-2 text-xs text-[var(--color-text-secondary)]">{home ? "Tools⌄" : "Context and memory"}</summary>
        <div className="flex flex-wrap items-center gap-1 border-b border-[var(--color-border-muted)] px-3 py-1.5">
          <button
            type="button"
            onClick={() => setUseSavedMemory((value) => !value)}
            disabled={!memoryWorkspaceId || !memoryCanRead || isLoading || sending}
            className={[
              "rounded-md px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              useSavedMemory && memoryWorkspaceId && memoryCanRead
                ? "bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]"
                : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]",
            ].join(" ")}
            aria-pressed={Boolean(memoryWorkspaceId) && memoryCanRead && useSavedMemory}
            aria-label="Use saved memory"
          >
            Use memory
          </button>
          <button
            type="button"
            onClick={() => setSaveToMemory((value) => !value)}
            disabled={!memoryWorkspaceId || !memoryCanSave || memorySavePending || isLoading || sending}
            className={[
              "rounded-md px-2 py-1 text-xs transition-colors disabled:cursor-not-allowed disabled:opacity-40",
              saveToMemory && memoryWorkspaceId && memoryCanSave
                ? "bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]"
                : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]",
            ].join(" ")}
            aria-pressed={Boolean(memoryWorkspaceId) && memoryCanSave && saveToMemory}
            aria-label="Save this message to memory"
          >
            Save message
          </button>
          <button
            type="button"
            onClick={() => setUseProjectContext((value) => !value)}
            disabled={isLoading || sending}
            className={[
              "inline-flex min-w-0 max-w-full items-center gap-1 rounded-md px-1.5 py-1 text-xs transition-colors",
              useProjectContext
                ? "bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]"
                : "text-[var(--color-text-muted)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)]",
              "disabled:cursor-not-allowed disabled:opacity-40",
            ].join(" ")}
            aria-label={projectContextProject ? `Use project context: ${projectContextProject}` : "Use project context: unavailable"}
            aria-pressed={useProjectContext}
            title={projectContextProject ? `Selected project: ${projectContextProject}` : "No project selected"}
            data-testid="chat-use-project-context"
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 14 14"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.25"
              aria-hidden="true"
            >
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                d="M2.33 4.08L7 2.33l4.67 1.75L7 5.83 2.33 4.08zM2.33 7L7 8.75 11.67 7M2.33 9.92L7 11.67l4.67-1.75"
              />
            </svg>
            <span className="hidden shrink-0 sm:inline" data-testid="chat-context-prefix">Context project: </span>
            <span
              className="min-w-0 max-w-[32vw] truncate font-normal sm:max-w-48"
              data-testid="chat-context-project"
            >
              {projectContextProject ?? "Unavailable"}
            </span>
          </button>
        </div>
        {memoryUnavailableReason && <p role="status" className="px-3 py-1 text-xs text-[var(--color-text-muted)]">{memoryUnavailableReason}</p>}
        {home && onOpenTools && <button type="button" onClick={onOpenTools} className="px-3 py-2 text-sm">Available tools</button>}
        </details>
  );

  return (
    <div className={`veyra-composer shrink-0 w-full overflow-y-auto [scrollbar-gutter:stable] px-4 pb-4 pt-2${home ? " veyra-home-composer" : ""}`}>
      {/* Attachment preview pills */}
      {attachments.length > 0 && (
        <div className="mb-2 mx-auto flex w-full max-w-3xl flex-wrap gap-1.5">
          {attachments.map((att) => (
            <div
              key={att.id}
              className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-2 py-1 text-xs"
            >
              {att.isImage && att.dataUrl ? (
                <img
                  src={att.dataUrl}
                  alt={att.name}
                  className="w-5 h-5 rounded object-cover shrink-0"
                />
              ) : (
                <svg
                  width="14"
                  height="14"
                  viewBox="0 0 14 14"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  className="text-[var(--color-text-muted)] shrink-0"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M7.58 1.75H3.5a1.17 1.17 0 00-1.17 1.17v8.16c0 .65.52 1.17 1.17 1.17h7c.65 0 1.17-.52 1.17-1.17V4.67L7.58 1.75z"
                  />
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M7.58 1.75v2.92h2.92"
                  />
                </svg>
              )}
              <span className="max-w-[120px] truncate text-[var(--color-text-primary)]">
                {truncateName(att.name)}
              </span>
              <span className="text-[var(--color-text-muted)] shrink-0">
                {formatSize(att.size)}
              </span>
              {att.pending && <span role="status">Reading…</span>}
              {att.error && <span role="alert">{att.error}</span>}
              <button
                type="button"
                onClick={() => removeAttachment(att.id)}
                className="p-0.5 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors shrink-0"
                aria-label={`Remove ${att.name}`}
              >
                <svg
                  width="12"
                  height="12"
                  viewBox="0 0 12 12"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M3 3l6 6M9 3l-6 6"
                  />
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}
      {attachmentSelectionError && <div role="alert"><p>{attachmentSelectionError}</p><button type="button" onClick={() => setAttachmentSelectionError(null)}>Dismiss attachment notice</button></div>}

      {/* Composer bar */}
      <div
        className={[
          "max-w-3xl mx-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] shadow-sm transition-colors",
          isDragOver ? "border-blue-400 ring-2 ring-blue-400/20" : "",
        ].join(" ")}
        data-testid="chat-composer-shell"
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        {home && <div className="veyra-home-composer-controls">{projectControl}{modelControl}</div>}
        {home && contextOptions}

        <div className={`veyra-composer-row flex min-w-0 items-end gap-2 px-3 py-2${home ? " veyra-home-composer-body" : ""}`}>
          {/* Left buttons */}
          <div className="flex min-w-0 items-center gap-1 pb-0.5">
            {/* Attachment button with file picker */}
            <input
              ref={fileInputRef}
              type="file"
              multiple
              accept="image/*,.txt,.md,.json,.ts,.tsx,.js,.jsx,.py,.rb,.go,.rs,.java,.cpp,.c,.h,.hpp,.css,.scss,.html,.xml,.yaml,.yml,.toml,.ini,.cfg,.sh,.bash,.zsh,.sql,.graphql,.vue,.svelte,.astro,.pdf,.csv"
              onChange={handleFileChange}
              className="hidden"
              aria-hidden="true"
            />
            {home ? (
            <button
              type="button"
              onClick={() => {
                if (canAttachMore) {
                  fileInputRef.current?.click();
                }
              }}
              className={[
                "p-1.5 rounded-lg transition-colors",
                canAttachMore
                  ? "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]"
                  : "text-[var(--color-text-muted)] opacity-40 cursor-not-allowed",
              ].join(" ")}
              aria-label="Attach files"
              title={canAttachMore ? "Attach files" : `Max ${MAX_FILES} files`}
              disabled={!canAttachMore || isLoading || sending}
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                {home ? <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.96 3.54L5.45 8.05a2 2 0 102.83 2.83L12.79 6.37a4 4 0 10-5.66-5.66L2.62 5.22a6 6 0 108.49 8.49"
                /> : <path d="M8 2v12M2 8h12" strokeLinecap="round" />}
              </svg>
              {home && <span>Attach</span>}
            </button>
            ) : <ComposerMenu canAttach={canAttachMore && !isLoading && !sending} onAttach={() => fileInputRef.current?.click()} onFocusNext={() => textareaRef.current?.focus()}>
              {close => <>{projectControl}{renderConversationOptions?.(close)}{contextOptions}</>}
            </ComposerMenu>}
            {home && <details className="veyra-home-search">
              <summary>Search</summary>
              <div className="veyra-home-search-panel">
                <label><input type="checkbox" checked={useProjectContext} disabled={!projectContextProject || sending || isLoading}
                  onChange={event => setUseProjectContext(event.target.checked)}/> Search project context</label>
                <p>Uses indexed context from {projectContextProject ?? "the selected project"}.</p>
              </div>
            </details>}
          </div>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder={home ? "Ask anything…" : "Ask Veyra"}
            rows={1}
            disabled={isLoading || sending}
            className="min-w-0 flex-1 resize-none bg-transparent text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none py-1 min-h-[24px] max-h-[200px] disabled:opacity-50"
            aria-label="Chat message input"
            data-testid="chat-composer"
          />

          {!home && modelControl}
          {!home && <button type="button" disabled title="Dictation is not configured for this edition" aria-label="Dictation unavailable" className="p-2 text-[var(--color-text-muted)] opacity-50">
            <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" aria-hidden="true"><rect x="6" y="1" width="4" height="8" rx="2"/><path d="M3 6v1a5 5 0 0 0 10 0V6M8 12v3M5 15h6"/></svg>
          </button>}
          {/* Send / Stop button */}
          <div className="veyra-send-controls">
          {isLoading ? (
            <button
              type="button"
              onClick={onStop}
              className="rounded-lg bg-[var(--color-surface-hover)] text-[var(--color-text-primary)] p-2 transition-colors hover:bg-[var(--color-surface-selected)] shrink-0"
              aria-label="Stop generating"
              title="Stop generating"
              data-testid="chat-stop-btn"
            >
              <svg
                width="16"
                height="16"
                viewBox="0 0 16 16"
                fill="currentColor"
                aria-hidden="true"
              >
                <rect x="3" y="3" width="10" height="10" rx="1.5" />
              </svg>
            </button>
          ) : (
            <button
              type="button"
              onClick={() => void handleSend()}
              disabled={!hasText || !hasSelectableModel || sending || attachmentsBlocked}
              className={[
                "rounded-lg p-2 transition-colors shrink-0 flex items-center justify-center",
                hasText && !sending
                  ? "bg-blue-600 text-white hover:bg-blue-700"
                  : "bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] cursor-not-allowed",
              ].join(" ")}
              aria-label="Send message"
              title="Send message"
              data-testid="chat-send-btn"
            >
              {sending ? (
                <svg
                  className="animate-spin"
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  aria-hidden="true"
                >
                  <circle
                    cx="8"
                    cy="8"
                    r="6"
                    stroke="currentColor"
                    strokeWidth="1.5"
                    strokeDasharray="28"
                    strokeDashoffset="10"
                    strokeLinecap="round"
                    opacity="0.5"
                  />
                </svg>
              ) : (
                <svg
                  width="16"
                  height="16"
                  viewBox="0 0 16 16"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  aria-hidden="true"
                >
                  <path
                    strokeLinecap="round"
                    strokeLinejoin="round"
                    d="M8 13V3M3 8l5-5 5 5"
                  />
                </svg>
              )}
              {home && <span>Send</span>}
            </button>
          )}
          {home && !isLoading && <details className="veyra-home-send-options">
            <summary aria-label="Send options">⌄</summary>
            <div>
              <button type="button" disabled={!hasText || !hasSelectableModel || sending || attachmentsBlocked || !projectContextProject}
                onClick={() => void handleSend({ useProjectContext: true })}>Send with project context</button>
              <button type="button" disabled={!hasText || !hasSelectableModel || sending || attachmentsBlocked || !memoryWorkspaceId || !memoryCanSave || memorySavePending}
                onClick={() => void handleSend({ saveToMemory: true })}>Send and save to memory</button>
            </div>
          </details>}
          </div>
        </div>
      </div>

      {showSuggestions && <div className="veyra-chat-suggestions max-w-3xl mx-auto mt-5 flex flex-col items-start gap-1">
        {["Draft release notes", "Summarize a document"].map((prompt, index) => <button key={prompt} type="button" disabled={isLoading || sending} onClick={() => { setValue(prompt); textareaRef.current?.focus(); }} className="veyra-chat-suggestion rounded-lg px-4 py-2 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]">
          <svg width="18" height="18" viewBox="0 0 20 20" fill="none" stroke="currentColor" strokeWidth="1.4" aria-hidden="true">
            {index === 0 ? <><path d="M5 2.5h7l3 3v12H5z" strokeLinejoin="round"/><path d="M12 2.5v4h3M7.5 10h5M7.5 13h5" strokeLinecap="round"/></> : <><path d="m10 2 2.2 5.8L18 10l-5.8 2.2L10 18l-2.2-5.8L2 10l5.8-2.2z" strokeLinejoin="round"/></>}
          </svg><span>{prompt}</span>
        </button>)}
      </div>}
    </div>
  );
}
