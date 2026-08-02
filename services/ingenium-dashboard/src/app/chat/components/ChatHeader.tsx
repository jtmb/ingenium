"use client";

import { useState, useRef, useEffect } from "react";
import Select from "../../components/Select";

interface Provider {
  id: string;
  label: string;
  source?: string;
}

interface Model {
  id: string;
  label: string;
  variants?: Record<string, { reasoningEffort?: string }>;
}

interface Agent {
  name: string;
  label: string;
}

interface ChatHeaderProps {
  sessionTitle: string;
  onRename: (title: string) => void;
  onFork: () => void;
  onShare: () => void;
  onCompact: () => void;
  shareState?: "idle" | "loading" | "success" | "error";
  compactState?: "idle" | "loading" | "success" | "error";
  providerId: string;
  modelId: string;
  agentName: string;
  variant?: string;
  onProviderChange: (providerId: string) => void;
  onModelChange: (modelId: string) => void;
  onAgentChange: (agentId: string) => void;
  onVariantChange?: (variant: string) => void;
  providers: Provider[];
  agents: Agent[];
  availableModels: Model[];
  isBusy: boolean;
  onMobileMenuOpen: () => void;
  /** MCP drawer trigger. */
  onMcpOpen?: () => void;
  /** Number of pending permission requests (badge). */
  permissionCount?: number;
  /** Disable all selectors (loading, error, or no selectable model). */
  disabled?: boolean;
  /** The selected provider has no valid model yet; provider recovery stays available. */
  modelDisabled?: boolean;
  /** Open the task capture flow for the active conversation. */
  onCreateTask?: () => void;
  /** Disable task capture until the active session has been validated and loaded. */
  createTaskDisabled?: boolean;
}

/**
 * ChatHeader — top bar for the chat area.
 *
 * Contains session title (editable on double-click), provider/model/agent/variant
 * selectors, and action buttons (fork, share, compact). On mobile it shows
 * a hamburger to open the sidebar drawer.
 */
export default function ChatHeader({
  sessionTitle,
  onRename,
  onFork,
  onShare,
  onCompact,
  shareState = "idle",
  compactState = "idle",
  providerId,
  modelId,
  agentName,
  variant,
  onProviderChange,
  onModelChange,
  onAgentChange,
  onVariantChange,
  providers,
  agents,
  availableModels,
  isBusy,
  onMobileMenuOpen,
  onMcpOpen,
  permissionCount = 0,
  disabled = false,
  modelDisabled = false,
  onCreateTask,
  createTaskDisabled = false,
}: ChatHeaderProps) {
  const [editing, setEditing] = useState(false);
  const [draftTitle, setDraftTitle] = useState(sessionTitle);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    setDraftTitle(sessionTitle);
  }, [sessionTitle]);

  useEffect(() => {
    if (editing && inputRef.current) {
      inputRef.current.focus();
      inputRef.current.select();
    }
  }, [editing]);

  const handleTitleSubmit = () => {
    const trimmed = draftTitle.trim();
    if (trimmed && trimmed !== sessionTitle) {
      onRename(trimmed);
    } else {
      setDraftTitle(sessionTitle);
    }
    setEditing(false);
  };

  // Compute available variants for the current model
  const selectedModel = availableModels.find((m) => m.id === modelId);
  const modelVariants = selectedModel?.variants ?? {};
  const variantKeys = Object.keys(modelVariants);
  const hasVariants = variantKeys.length > 0 && onVariantChange;

  return (
    <>
      <header className="flex min-w-0 items-center gap-2 px-4 py-2 border-b border-[var(--color-border)] bg-[var(--color-surface)] shrink-0 min-h-[48px]">
      {/* Mobile hamburger — hidden from keyboard focus on desktop */}
      <button
        type="button"
        onClick={onMobileMenuOpen}
        className="md:hidden p-1.5 rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] transition-colors shrink-0"
        aria-label="Open sessions"
        data-testid="chat-header-hamburger"
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
            d="M2.67 4h10.66M2.67 8h10.66M2.67 12h10.66"
          />
        </svg>
      </button>

      {/* Session title */}
      <div className="flex-1 min-w-0 mr-2">
        {editing ? (
          <input
            ref={inputRef}
            type="text"
            value={draftTitle}
            onChange={(e) => setDraftTitle(e.target.value)}
            onBlur={handleTitleSubmit}
            onKeyDown={(e) => {
              if (e.key === "Enter") handleTitleSubmit();
              if (e.key === "Escape") {
                setDraftTitle(sessionTitle);
                setEditing(false);
              }
            }}
            className="w-full bg-[var(--color-surface-muted)] border border-[var(--color-border)] rounded px-2 py-1 text-sm text-[var(--color-text-primary)] outline-none focus:border-blue-500"
            aria-label="Session title"
          />
        ) : (
          <h1
            className="text-sm font-medium text-[var(--color-text-primary)] truncate cursor-pointer hover:text-[var(--color-text-link)] transition-colors"
            onDoubleClick={() => setEditing(true)}
            title="Double-click to rename"
          >
            {sessionTitle}
          </h1>
        )}
      </div>

      {/* Selectors */}
      <div className="hidden sm:flex items-center gap-2">
        {/* Provider */}
        <Select
            wrapperClassName="shrink-0"
            value={providerId}
            onChange={(e) => onProviderChange(e.target.value)}
            disabled={disabled}
            className="shrink-0 border border-[var(--color-border)] rounded-md text-sm bg-[var(--color-surface)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] cursor-pointer px-2 py-1.5 pr-7 disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Select provider"
            data-testid="chat-header-provider"
          >
            {providers.length === 0 && <option value="">No providers available</option>}
            {providers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.label}{p.source === "builtin" ? " (Free)" : ""}
              </option>
            ))}
          </Select>

        {/* Model */}
        <Select
            wrapperClassName="shrink-0 max-w-[160px]"
            value={modelId}
            onChange={(e) => onModelChange(e.target.value)}
            disabled={disabled || modelDisabled}
            className="w-full shrink-0 max-w-[160px] border border-[var(--color-border)] rounded-md text-sm bg-[var(--color-surface)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] cursor-pointer px-2 py-1.5 pr-7 disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Select model"
            data-testid="chat-header-model"
          >
            {availableModels.length === 0 && <option value="">No models available</option>}
            {availableModels.map((m) => (
              <option key={m.id} value={m.id}>
                {m.label}
              </option>
            ))}
          </Select>

        {/* Variant selector — shown when model has variants */}
        {hasVariants && (
          <Select
              wrapperClassName="shrink-0"
              value={variant ?? variantKeys[0]}
              onChange={(e) => onVariantChange?.(e.target.value)}
              disabled={disabled}
              className="shrink-0 border border-[var(--color-border)] rounded-md text-sm bg-[var(--color-surface)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] cursor-pointer px-2 py-1.5 pr-7 disabled:opacity-40 disabled:cursor-not-allowed"
              aria-label="Select variant"
              data-testid="chat-header-variant"
            >
              {variantKeys.map((key) => (
                <option key={key} value={key}>
                  {key}
                </option>
              ))}
            </Select>
        )}

        {/* Agent */}
        <Select
            wrapperClassName="shrink-0 max-w-[150px]"
            value={agentName}
            onChange={(e) => onAgentChange(e.target.value)}
            disabled={disabled}
            className="w-full shrink-0 max-w-[150px] border border-[var(--color-border)] rounded-md text-sm bg-[var(--color-surface)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] cursor-pointer px-2 py-1.5 pr-7 disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Select agent"
            data-testid="chat-header-agent"
          >
            {agents.length === 0 && <option value="">No agents available</option>}
            {agents.map((a) => (
              <option key={a.name} value={a.name}>
                {a.label}
              </option>
            ))}
          </Select>
      </div>

      {/* Action buttons */}
      <div className="flex items-center gap-1 shrink-0">
        {/* Create task from the active conversation */}
        <button
          type="button"
          onClick={onCreateTask}
          disabled={!onCreateTask || createTaskDisabled || isBusy}
          className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md p-1.5 text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Create task from conversation"
          title="Create task from conversation"
          data-testid="chat-header-create-task"
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
            <path strokeLinecap="round" d="M8 3.33v9.34M3.33 8h9.34" />
            <rect x="2.33" y="2.33" width="11.34" height="11.34" rx="2" />
          </svg>
        </button>

        {/* MCP servers */}
        {onMcpOpen && (
          <button
            type="button"
            onClick={onMcpOpen}
            className="relative inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] transition-colors"
            aria-label="MCP servers"
            title="MCP servers"
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
              <rect x="2" y="3" width="4" height="10" rx="0.75" />
              <rect x="7" y="1" width="4" height="14" rx="0.75" />
              <rect x="12" y="4.5" width="4" height="7" rx="0.75" />
            </svg>
            {/* Permission notification badge */}
            {permissionCount > 0 && (
              <span className="absolute -top-1 -right-1 flex items-center justify-center w-4 h-4 rounded-full bg-amber-500 text-[10px] font-bold text-white leading-none">
                {permissionCount > 9 ? "9+" : permissionCount}
              </span>
            )}
          </button>
        )}

        {/* Fork */}
        <button
          type="button"
          onClick={onFork}
          disabled={isBusy}
          className="p-1.5 rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Fork conversation"
          title="Fork conversation"
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
              d="M3.33 6v4M6 3.33a2.67 2.67 0 100 5.34 2.67 2.67 0 000-5.34zM10 7.33a2.67 2.67 0 100 5.34 2.67 2.67 0 000-5.34zM12.67 6V4.67c0-.74-.6-1.34-1.34-1.34H7.67"
            />
          </svg>
        </button>

        {/* Share */}
        <button
          type="button"
          onClick={onShare}
          disabled={isBusy || shareState === "loading"}
          className="p-1.5 rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label={
            shareState === "loading" ? "Sharing..." :
            shareState === "success" ? "Link copied!" :
            shareState === "error" ? "Share failed" :
            "Share conversation"
          }
          title={
            shareState === "loading" ? "Sharing..." :
            shareState === "success" ? "Link copied!" :
            shareState === "error" ? "Share failed" :
            "Share conversation"
          }
        >
          {shareState === "loading" ? (
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="animate-spin"
              aria-hidden="true"
            >
              <circle cx="8" cy="8" r="6" strokeOpacity="0.25" />
              <path strokeLinecap="round" d="M8 2a6 6 0 016 6" />
            </svg>
          ) : shareState === "success" ? (
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-emerald-500"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l3.33 3.33L13 4.67" />
            </svg>
          ) : shareState === "error" ? (
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-red-500"
              aria-hidden="true"
            >
              <path strokeLinecap="round" d="M4.67 4.67l6.66 6.66M11.33 4.67L4.67 11.33" />
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
                d="M8 2.67v6.66M4.67 5.33L8 2l3.33 3.33M3.33 9.33v2c0 .74.6 1.34 1.34 1.34h6.66c.74 0 1.34-.6 1.34-1.34v-2"
              />
            </svg>
          )}
        </button>

        {/* Compact */}
        <button
          type="button"
          onClick={onCompact}
          disabled={isBusy || compactState === "loading"}
          className="p-1.5 rounded-md text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label={
            compactState === "loading" ? "Compacting..." :
            compactState === "success" ? "Compacted!" :
            compactState === "error" ? "Compact failed" :
            "Compact conversation"
          }
          title={
            compactState === "loading" ? "Compacting..." :
            compactState === "success" ? "Compacted!" :
            compactState === "error" ? "Compact failed" :
            "Compact conversation"
          }
        >
          {compactState === "loading" ? (
            /* Spinner when compacting */
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="animate-spin"
              aria-hidden="true"
            >
              <circle cx="8" cy="8" r="6" strokeOpacity="0.25" />
              <path
                strokeLinecap="round"
                d="M8 2a6 6 0 016 6"
              />
            </svg>
          ) : compactState === "success" ? (
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-emerald-500"
              aria-hidden="true"
            >
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 8l3.33 3.33L13 4.67" />
            </svg>
          ) : compactState === "error" ? (
            <svg
              width="16"
              height="16"
              viewBox="0 0 16 16"
              fill="none"
              stroke="currentColor"
              strokeWidth="1.5"
              className="text-red-500"
              aria-hidden="true"
            >
              <path strokeLinecap="round" d="M4.67 4.67l6.66 6.66M11.33 4.67L4.67 11.33" />
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
                d="M2.67 4.67h10.66M2.67 8h8M2.67 11.33h5.33"
              />
            </svg>
          )}
        </button>
      </div>
    </header>
    {/* Mobile provider/model/agent selectors — horizontal scroll below header */}
    <div data-testid="chat-header-mobile-selectors" className="sm:hidden flex gap-2 px-4 py-2 overflow-x-auto border-b border-[var(--color-border)] bg-[var(--color-surface)] min-w-0">
      {/* Provider */}
      <Select
        wrapperClassName="shrink-0 max-w-[120px]"
          value={providerId}
          onChange={(e) => onProviderChange(e.target.value)}
          disabled={disabled}
          className="w-full shrink-0 max-w-[120px] border border-[var(--color-border)] rounded-md text-xs bg-[var(--color-surface)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] cursor-pointer px-2 py-1.5 pr-7 disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Select provider"
          data-testid="chat-header-mobile-provider"
        >
          {providers.length === 0 && <option value="">No providers available</option>}
          {providers.map((p) => (
            <option key={p.id} value={p.id}>
              {p.label}{p.source === "builtin" ? " (Free)" : ""}
            </option>
          ))}
        </Select>

      {/* Model */}
      <Select
        wrapperClassName="shrink-0 max-w-[100px]"
          value={modelId}
          onChange={(e) => onModelChange(e.target.value)}
          disabled={disabled || modelDisabled}
          className="w-full shrink-0 max-w-[100px] border border-[var(--color-border)] rounded-md text-xs bg-[var(--color-surface)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] cursor-pointer px-2 py-1.5 pr-7 disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Select model"
          data-testid="chat-header-mobile-model"
        >
          {availableModels.length === 0 && <option value="">No models available</option>}
          {availableModels.map((m) => (
            <option key={m.id} value={m.id}>
              {m.label}
            </option>
          ))}
        </Select>

      {/* Variant selector — shown when model has variants */}
      {hasVariants && (
        <Select
          wrapperClassName="shrink-0 max-w-[90px]"
            value={variant ?? variantKeys[0]}
            onChange={(e) => onVariantChange?.(e.target.value)}
            disabled={disabled}
            className="w-full shrink-0 max-w-[90px] border border-[var(--color-border)] rounded-md text-xs bg-[var(--color-surface)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] cursor-pointer px-2 py-1.5 pr-7 disabled:opacity-40 disabled:cursor-not-allowed"
            aria-label="Select variant"
            data-testid="chat-header-mobile-variant"
          >
            {variantKeys.map((key) => (
              <option key={key} value={key}>
                {key}
              </option>
            ))}
          </Select>
      )}

      {/* Agent */}
      <Select
        wrapperClassName="shrink-0 max-w-[110px]"
          value={agentName}
          onChange={(e) => onAgentChange(e.target.value)}
          disabled={disabled}
          className="w-full shrink-0 max-w-[110px] border border-[var(--color-border)] rounded-md text-xs bg-[var(--color-surface)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] cursor-pointer px-2 py-1.5 pr-7 disabled:opacity-40 disabled:cursor-not-allowed"
          aria-label="Select agent"
          data-testid="chat-header-mobile-agent"
        >
          {agents.length === 0 && <option value="">No agents available</option>}
          {agents.map((a) => (
            <option key={a.name} value={a.name}>
              {a.label}
            </option>
          ))}
        </Select>
    </div>
  </>);
}
