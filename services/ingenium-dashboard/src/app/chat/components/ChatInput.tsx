"use client";

import { useState, useRef, useCallback, useEffect } from "react";

export interface SendOptions {
  providerId?: string;
  modelId?: string;
  agentName?: string;
}

export interface Attachment {
  id: string;
  name: string;
  mime: string;
  size: number;
  dataUrl?: string; // Base64 data URL for images
  content?: string; // Text content
  isImage: boolean;
}

interface ChatInputProps {
  onSend: (message: string, systemPrompt: string, options?: SendOptions) => void;
  onStop: () => void;
  isLoading: boolean;
  providerId?: string;
  modelId?: string;
  agentName?: string;
  attachments: Attachment[];
  onAttachmentsChange: (attachments: Attachment[]) => void;
  hasSelectableModel?: boolean;
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
 * - Instructions toggle for system prompt
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
}: ChatInputProps) {
  const [value, setValue] = useState("");
  const [systemPrompt, setSystemPrompt] = useState("");
  const [showInstructions, setShowInstructions] = useState(false);
  const [isDragOver, setIsDragOver] = useState(false);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const fileInputRef = useRef<HTMLInputElement>(null);

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
      const fileArr = Array.from(files);
      const available = MAX_FILES - attachments.length;
      if (available <= 0) return;

      const toProcess = fileArr.slice(0, available);

      for (const file of toProcess) {
        if (file.size > MAX_FILE_SIZE) continue;

        const id = nextAttachId();
        const isImg = isImageMime(file.type);

        if (isImg) {
          const reader = new FileReader();
          reader.onload = () => {
            onAttachmentsChange([
              ...attachments,
              {
                id,
                name: file.name,
                mime: file.type || "image/png",
                size: file.size,
                dataUrl: reader.result as string,
                isImage: true,
              },
            ]);
          };
          reader.readAsDataURL(file);
        } else if (isTextFile(file.name)) {
          const reader = new FileReader();
          reader.onload = () => {
            onAttachmentsChange([
              ...attachments,
              {
                id,
                name: file.name,
                mime: file.type || "text/plain",
                size: file.size,
                content: reader.result as string,
                isImage: false,
              },
            ]);
          };
          reader.readAsText(file);
        } else {
          onAttachmentsChange([
            ...attachments,
            {
              id,
              name: file.name,
              mime: file.type || "application/octet-stream",
              size: file.size,
              isImage: false,
            },
          ]);
        }
      }

      // Reset file input so the same file can be re-selected
      if (fileInputRef.current) {
        fileInputRef.current.value = "";
      }
    },
    [attachments, onAttachmentsChange],
  );

  /** Remove a single attachment by ID. */
  const removeAttachment = useCallback(
    (id: string) => {
      onAttachmentsChange(attachments.filter((a) => a.id !== id));
    },
    [attachments, onAttachmentsChange],
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

  const handleSend = () => {
    const trimmed = value.trim();
    if (!trimmed || isLoading || !hasSelectableModel) return;
    onSend(trimmed, systemPrompt.trim(), {
      providerId,
      modelId,
      agentName,
    });
    setValue("");
    // Reset textarea height
    if (textareaRef.current) {
      textareaRef.current.style.height = "24px";
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

  return (
    <div className="shrink-0 px-4 pb-4 pt-2 w-full">
      {/* Instructions drawer */}
      {showInstructions && (
        <div className="mb-2 max-w-3xl mx-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] p-3">
          <div className="flex items-center justify-between mb-2">
            <label
              htmlFor="chat-system-prompt"
              className="text-xs font-medium text-[var(--color-text-secondary)]"
            >
              System Instructions
            </label>
            <button
              type="button"
              onClick={() => setShowInstructions(false)}
              className="p-1 rounded text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] transition-colors"
              aria-label="Close instructions"
            >
              <svg
                width="14"
                height="14"
                viewBox="0 0 14 14"
                fill="none"
                stroke="currentColor"
                strokeWidth="1.5"
                aria-hidden="true"
              >
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M3.5 3.5l7 7M10.5 3.5l-7 7"
                />
              </svg>
            </button>
          </div>
          <textarea
            id="chat-system-prompt"
            value={systemPrompt}
            onChange={(e) => setSystemPrompt(e.target.value)}
            placeholder="Custom instructions for this conversation..."
            rows={3}
            className="w-full resize-none rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] px-3 py-2 outline-none focus:border-blue-500"
          />
        </div>
      )}

      {/* Attachment preview pills */}
      {attachments.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
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

      {/* Composer bar */}
      <div
        className={[
          "max-w-3xl mx-auto rounded-2xl border border-[var(--color-border)] bg-[var(--color-surface-muted)] shadow-sm transition-colors",
          isDragOver ? "border-blue-400 ring-2 ring-blue-400/20" : "",
        ].join(" ")}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
      >
        <div className="flex items-end gap-2 px-3 py-2">
          {/* Left buttons */}
          <div className="flex items-center gap-1 pb-0.5">
            {/* Instructions toggle */}
            <button
              type="button"
              onClick={() => setShowInstructions((v) => !v)}
              className={[
                "p-1.5 rounded-lg transition-colors",
                showInstructions
                  ? "bg-[var(--color-surface-selected)] text-[var(--color-text-primary)]"
                  : "text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)]",
              ].join(" ")}
              aria-label="Toggle instructions"
              title="Instructions"
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
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M8 10a2 2 0 100-4 2 2 0 000 4z"
                />
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M12.93 6.87c.09.37.11.75.07 1.13M3.07 9.13a5.6 5.6 0 00-.07-1.13M10.41 3.59a5.6 5.6 0 00-1.02-.65M5.59 12.41c.31.27.65.49 1.02.65M12.94 10.41a5.68 5.68 0 00.65-1.02M3.06 5.59a5.68 5.68 0 01.65 1.02M10.41 12.41a5.56 5.56 0 01-4.82 0M5.59 3.59a5.56 5.56 0 014.82 0"
                />
              </svg>
            </button>

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
              disabled={!canAttachMore}
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
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M9.96 3.54L5.45 8.05a2 2 0 102.83 2.83L12.79 6.37a4 4 0 10-5.66-5.66L2.62 5.22a6 6 0 108.49 8.49"
                />
              </svg>
            </button>
          </div>

          {/* Textarea */}
          <textarea
            ref={textareaRef}
            value={value}
            onChange={(e) => setValue(e.target.value)}
            onKeyDown={handleKeyDown}
            placeholder="Ask Ingenium anything..."
            rows={1}
            disabled={isLoading}
            className="flex-1 resize-none bg-transparent text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none py-1 min-h-[24px] max-h-[200px] disabled:opacity-50"
            aria-label="Chat message input"
            data-testid="chat-composer"
          />

          {/* Send / Stop button */}
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
              onClick={handleSend}
              disabled={!hasText || !hasSelectableModel}
              className={[
                "rounded-lg p-2 transition-colors shrink-0",
                hasText
                  ? "bg-blue-600 text-white hover:bg-blue-700"
                  : "bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] cursor-not-allowed",
              ].join(" ")}
              aria-label="Send message"
              title="Send message"
              data-testid="chat-send-btn"
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
                <path
                  strokeLinecap="round"
                  strokeLinejoin="round"
                  d="M14 2L7 9M14 2l-4.67 12L7 9l-3.33-1.33L14 2z"
                />
              </svg>
            </button>
          )}
        </div>
      </div>

      {/* Footer */}
      <p className="max-w-3xl mx-auto text-center text-xs text-[var(--color-text-muted)] mt-2">
        Ingenium Chat
      </p>
    </div>
  );
}
