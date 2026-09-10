"use client";

import { useState, useCallback } from "react";
import { dashboardFetch, getApiBase } from "@/lib/api";
import { Dropdown, DropdownItem, DropdownPanel, DropdownTrigger } from "@/app/components/Dropdown";

export type AIAction =
  | "outline"
  | "continue"
  | "rewrite"
  | "summarize"
  | "fix_grammar"
  | "tone_professional"
  | "tone_casual"
  | "tone_technical";

export interface AISelectionRange {
  start: number;
  end: number;
}

/** Captured at request time so the editor can apply the result safely later. */
export interface AIApplyPayload {
  action: AIAction;
  result: string;
  sourceContent: string;
  selectedText?: string;
  selectionRange?: AISelectionRange;
}

interface AIActionsProps {
  /** Currently selected text in the editor — enables action requiring selection */
  selectedText?: string;
  /** Range belonging to selectedText in fullContent, when the editor exposes one. */
  selectionRange?: AISelectionRange;
  /** Full page content sent as context for AI transformations */
  fullContent: string;
  pageTitle: string;
  /** Called with the captured AI operation when user clicks Apply. Return false to keep the preview open. */
  onApply: (application: AIApplyPayload) => void | boolean;
}

interface AIActionDef {
  action: AIAction;
  label: string;
  description: string;
  requiresSelection?: boolean;
  requiresContent?: boolean;
  requiresTitleForBlankContent?: boolean;
}

const ACTIONS: AIActionDef[] = [
  {
    action: "outline",
    label: "Outline",
    description: "Generate an outline for this page",
    requiresTitleForBlankContent: true,
  },
  {
    action: "continue",
    label: "Continue",
    description: "Continue writing from the end",
    requiresContent: true,
  },
  { action: "rewrite", label: "Rewrite", description: "Rewrite selected text", requiresSelection: true },
  { action: "summarize", label: "Summarize", description: "Summarize this page", requiresContent: true },
  { action: "fix_grammar", label: "Fix grammar", description: "Fix grammar and spelling", requiresContent: true },
  {
    action: "tone_professional",
    label: "Professional",
    description: "Rewrite with professional tone",
    requiresContent: true,
  },
  { action: "tone_casual", label: "Casual", description: "Rewrite with casual tone", requiresContent: true },
  {
    action: "tone_technical",
    label: "Technical",
    description: "Rewrite with technical tone",
    requiresContent: true,
  },
];

/** These operations replace the complete document rather than editing a known range. */
const PAGE_WIDE_ACTIONS = new Set<AIAction>([
  "outline",
  "summarize",
  "fix_grammar",
  "tone_professional",
  "tone_casual",
  "tone_technical",
]);

const STALE_RESULT_MESSAGE =
  "This AI result is stale because the page changed while AI was working. Your edits were kept. Discard this preview and run the action again.";

const API_BASE = getApiBase();

interface AIResponse {
  data?: { result?: unknown };
}

const DOCS_AI_SERVICE_UNAVAILABLE_MESSAGE =
  "Documentation AI is temporarily unavailable. Please try again later.";

const DOCS_AI_ERROR_MESSAGES: Readonly<Record<string, string>> = {
  INVALID_AI_REQUEST: "The documentation action cannot be processed. Review the page content and try again.",
  MALFORMED_JSON: "The documentation request could not be processed. Reload the page and try again.",
  DOCS_AI_CONTENT_TOO_LARGE: "Documentation content exceeds the 128 KiB AI limit. Shorten it and try again.",
  DOCS_AI_PROJECT_CONFLICT: DOCS_AI_SERVICE_UNAVAILABLE_MESSAGE,
  GLOBAL_PROJECT_UNAVAILABLE: "Documentation AI is not configured correctly. Please try again later.",
  LLM_CATALOG_UNAVAILABLE: "Documentation AI is temporarily unavailable. Please try again later.",
  LLM_UNAVAILABLE: "No documentation AI model is currently available. Open Chat or Settings → Providers, then try again.",
  LLM_BROKER_ERROR: DOCS_AI_SERVICE_UNAVAILABLE_MESSAGE,
  LLM_BROKER_TIMEOUT: "Documentation AI timed out. Please try again later.",
  INTERNAL_ERROR: DOCS_AI_SERVICE_UNAVAILABLE_MESSAGE,
};

class DocsAiRequestError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "DocsAiRequestError";
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function docsAiErrorMessage(status: number, body: unknown): string {
  if (isRecord(body) && isRecord(body.error) && typeof body.error.code === "string") {
    const knownMessage = DOCS_AI_ERROR_MESSAGES[body.error.code];
    if (knownMessage) return knownMessage;
  }

  if (status === 413) return DOCS_AI_ERROR_MESSAGES.DOCS_AI_CONTENT_TOO_LARGE!;
  if (status === 504) return DOCS_AI_ERROR_MESSAGES.LLM_BROKER_TIMEOUT!;
  if (status === 400) return DOCS_AI_ERROR_MESSAGES.INVALID_AI_REQUEST!;
  return DOCS_AI_SERVICE_UNAVAILABLE_MESSAGE;
}

async function callDocAI(
  action: AIAction,
  content: string,
  title: string,
  selectedText?: string,
): Promise<string> {
  try {
    const res = await dashboardFetch(`${API_BASE}/docs/ai`, {
      method: "POST",
      // The API resolves both the global project and server-owned Chat selection.
      // Provider/model IDs must never come from the browser or localStorage.
      body: JSON.stringify({
        action,
        content,
        title,
        selectedText,
      }),
    });
    const body: unknown = await res.json().catch(() => null);

    if (!res.ok) {
      throw new DocsAiRequestError(docsAiErrorMessage(res.status, body));
    }

    const data = body as AIResponse;
    // 🔴 NEVER expose reasoning_content — only use a validated text result.
    if (typeof data.data?.result !== "string" || !data.data.result.trim()) {
      throw new DocsAiRequestError(DOCS_AI_SERVICE_UNAVAILABLE_MESSAGE);
    }
    return data.data.result;
  } catch (error: unknown) {
    if (error instanceof DocsAiRequestError) throw error;
    // Network and response-decoding failures are not trusted error payloads.
    throw new DocsAiRequestError(DOCS_AI_SERVICE_UNAVAILABLE_MESSAGE);
  }
}

/**
 * AIActions — dropdown of AI-powered document transformations.
 * Calls /docs/ai endpoint with the action name and page content.
 * Results are previewed in a panel below the dropdown before applying.
 */
const AIActions: React.FC<AIActionsProps> = ({
  selectedText,
  selectionRange,
  fullContent,
  pageTitle,
  onApply,
}) => {
  const [loading, setLoading] = useState<AIAction | null>(null);
  const [result, setResult] = useState<AIApplyPayload | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const getDisabledReason = useCallback((actionDef: AIActionDef): string | undefined => {
    if (actionDef.requiresSelection && !selectedText?.trim()) {
      return "Select non-whitespace text to rewrite.";
    }
    if (actionDef.requiresContent && !fullContent.trim()) {
      return "Add non-whitespace content before using this action.";
    }
    if (actionDef.requiresTitleForBlankContent && !fullContent.trim() && !pageTitle.trim()) {
      return "Enter a page title before outlining a blank page.";
    }
    return undefined;
  }, [fullContent, pageTitle, selectedText]);

  /** Stable reference via useCallback — dependencies (fullContent, pageTitle, selectedText) are
   *  snapshots from the parent editor, not stale closures.
   *  PERF: We intentionally avoid debouncing here; actions are user-initiated clicks. */
  const handleAction = useCallback(async (actionDef: AIActionDef) => {
    const disabledReason = getDisabledReason(actionDef);
    if (disabledReason) {
      setError(disabledReason);
      return;
    }

    const sourceContent = fullContent;
    const selectedTextSnapshot = selectedText;
    const selectionRangeSnapshot = selectionRange;

    setLoading(actionDef.action);
    setResult(null);
    setError(null);

    try {
      const text = await callDocAI(
        actionDef.action,
        sourceContent,
        pageTitle,
        selectedTextSnapshot,
      );
      setResult({
        action: actionDef.action,
        result: text,
        sourceContent,
        selectedText: selectedTextSnapshot,
        selectionRange: selectionRangeSnapshot,
      });
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : "AI request failed";
      setError(msg);
    } finally {
      setLoading(null);
    }
  }, [fullContent, getDisabledReason, pageTitle, selectedText, selectionRange]);

  const handleApply = useCallback(() => {
    if (result?.result) {
      // A page-wide result is only safe when the document still matches the
      // snapshot that produced it. Continue appends to the latest document and
      // Rewrite validates its captured range in DocsEditor, so neither action
      // uses this whole-document guard.
      if (PAGE_WIDE_ACTIONS.has(result.action) && result.sourceContent !== fullContent) {
        setError(STALE_RESULT_MESSAGE);
        return;
      }

      try {
        const applied = onApply(result);
        if (applied !== false) {
          setResult(null);
          setIsOpen(false);
        } else {
          setError("AI result was not applied. Your edits were kept. Review the preview and retry or discard it.");
        }
      } catch (err: unknown) {
        setError(err instanceof Error ? err.message : "Unable to apply AI result");
      }
    }
  }, [fullContent, onApply, result]);

  const handleDiscard = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  const handleDismissError = useCallback(() => {
    setError(null);
  }, []);

  return (
    <div className="relative">
      <Dropdown open={isOpen} onOpenChange={setIsOpen}>
      <DropdownTrigger
        aria-label="AI"
        title="AI Assistance"
        className={`shrink-0 p-1.5 rounded transition-colors flex items-center gap-1 text-xs
          ${isOpen
            ? "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300"
            : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
          }`}
      >
         <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
        <span className="hidden sm:inline">AI</span>
      </DropdownTrigger>

      {isOpen && (
        <DropdownPanel aria-label="AI actions" className="right-0 top-full mt-1 w-64 p-2 shadow-lg">
          <div className="space-y-1">
            {ACTIONS.map((actionDef) => {
              const disabledReason = getDisabledReason(actionDef);
              const isDisabled = Boolean(disabledReason);
              const isLoading = loading === actionDef.action;

              return (
                <DropdownItem
                  key={actionDef.action}
                  onClick={() => handleAction(actionDef)}
                  disabled={!!loading || isDisabled}
                  closeOnSelect={false}
                  title={disabledReason ?? actionDef.description}
                  className={`w-full text-left px-2 py-1.5 text-xs rounded transition-colors flex items-center gap-2
                    ${isDisabled
                      ? "opacity-40 cursor-not-allowed"
                      : "hover:bg-[var(--color-surface-hover)] cursor-pointer"
                    }
                    ${isLoading ? "text-purple-600 dark:text-purple-400" : "text-[var(--color-text-primary)]"}
                  `}
                >
                  {isLoading && (
                    <svg className="w-3 h-3 animate-spin shrink-0" viewBox="0 0 24 24" fill="none">
                      <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" />
                      <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
                    </svg>
                  )}
                  <span>{actionDef.label}</span>
                </DropdownItem>
              );
            })}
          </div>
        </DropdownPanel>
      )}

      {/* Result/error overlay — stale results show both the actionable error and
          the preserved preview so the user can retry or discard it. */}
      {(result || error) && (
        <div className="absolute right-0 top-full z-50 mt-1 w-96 max-w-[calc(100vw-1rem)] rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-3 shadow-lg">
          {error && (
            <div role="alert" className={result ? "mb-3" : undefined}>
              <p className="text-xs text-red-600 dark:text-red-400 mb-2">{error}</p>
              <button
                type="button"
                onClick={handleDismissError}
                className="text-xs px-2 py-1 rounded bg-[var(--color-surface-hover)] hover:bg-[var(--color-border)]"
              >
                Dismiss
              </button>
            </div>
          )}
          {result && (
            <div>
              <div className="text-xs text-[var(--color-text-secondary)] mb-2 font-medium">
                AI Result
              </div>
              <div className="max-h-48 overflow-y-auto text-xs text-[var(--color-text-primary)] whitespace-pre-wrap border border-[var(--color-border)] rounded p-2 mb-2 bg-[var(--color-surface-hover)]">
                {result.result}
              </div>
              <div className="flex gap-2">
                <button
                  type="button"
                  onClick={handleApply}
                  className="text-xs px-3 py-1 rounded bg-blue-600 text-white hover:bg-blue-700"
                >
                  Apply
                </button>
                <button
                  type="button"
                  onClick={handleDiscard}
                  className="text-xs px-3 py-1 rounded bg-[var(--color-surface-hover)] hover:bg-[var(--color-border)] text-[var(--color-text-secondary)]"
                >
                  Discard
                </button>
              </div>
            </div>
          )}
        </div>
      )}
      </Dropdown>
    </div>
  );
};

export default AIActions;
