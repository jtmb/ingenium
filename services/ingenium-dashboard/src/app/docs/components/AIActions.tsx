"use client";

import { useState, useCallback } from "react";

// ── Types ──────────────────────────────────────────────────────────────────────

export type AIAction =
  | "outline"
  | "continue"
  | "rewrite"
  | "summarize"
  | "fix_grammar"
  | "tone_professional"
  | "tone_casual"
  | "tone_technical";

interface AIActionsProps {
  selectedText?: string;
  fullContent: string;
  pageTitle: string;
  onApply: (newContent: string) => void;
}

interface AIActionDef {
  action: AIAction;
  label: string;
  description: string;
  requiresSelection?: boolean;
}

// ── Action definitions ─────────────────────────────────────────────────────────

const ACTIONS: AIActionDef[] = [
  { action: "outline", label: "Outline", description: "Generate an outline for this page" },
  { action: "continue", label: "Continue", description: "Continue writing from the end" },
  { action: "rewrite", label: "Rewrite", description: "Rewrite selected text", requiresSelection: true },
  { action: "summarize", label: "Summarize", description: "Summarize this page" },
  { action: "fix_grammar", label: "Fix grammar", description: "Fix grammar and spelling" },
  { action: "tone_professional", label: "Professional", description: "Rewrite with professional tone" },
  { action: "tone_casual", label: "Casual", description: "Rewrite with casual tone" },
  { action: "tone_technical", label: "Technical", description: "Rewrite with technical tone" },
];

// ── API call helper ────────────────────────────────────────────────────────────

const API_BASE = process.env.NEXT_PUBLIC_API_URL || "http://localhost:4097/api/v1";

interface AIResponse {
  data: { result: string };
}

interface AIError {
  error: { code: string; message: string };
}

async function callDocAI(
  action: AIAction,
  content: string,
  title: string,
  selectedText?: string,
): Promise<string> {
  const res = await fetch(`${API_BASE}/docs/ai`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ action, content, title, selectedText }),
  });

  if (!res.ok) {
    const err = (await res.json().catch(() => ({ error: { message: res.statusText } }))) as AIError;
    throw new Error(err.error?.message || res.statusText);
  }

  const data = (await res.json()) as AIResponse;
  // 🔴 NEVER expose reasoning_content — only use content
  return data.data?.result || "";
}

// ── Component ──────────────────────────────────────────────────────────────────

const AIActions: React.FC<AIActionsProps> = ({ selectedText, fullContent, pageTitle, onApply }) => {
  const [loading, setLoading] = useState<AIAction | null>(null);
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isOpen, setIsOpen] = useState(false);

  const handleAction = useCallback(async (actionDef: AIActionDef) => {
    // Check selection requirement
    if (actionDef.requiresSelection && !selectedText) {
      setError("Please select some text first.");
      return;
    }

    setLoading(actionDef.action);
    setResult(null);
    setError(null);

    try {
      const text = await callDocAI(
        actionDef.action,
        fullContent,
        pageTitle,
        selectedText,
      );
      setResult(text);
    } catch (err: any) {
      const msg = err.message || "AI request failed";
      setError(msg);
    } finally {
      setLoading(null);
    }
  }, [fullContent, pageTitle, selectedText]);

  const handleApply = useCallback(() => {
    if (result) {
      onApply(result);
      setResult(null);
      setIsOpen(false);
    }
  }, [result, onApply]);

  const handleDiscard = useCallback(() => {
    setResult(null);
    setError(null);
  }, []);

  return (
    <div className="relative">
      {/* Trigger button */}
      <button
        type="button"
        onClick={() => setIsOpen(!isOpen)}
        title="AI Assistance"
        className={`shrink-0 p-1.5 rounded transition-colors flex items-center gap-1 text-xs
          ${isOpen
            ? "bg-purple-100 text-purple-700 dark:bg-purple-900 dark:text-purple-300"
            : "text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)]"
          }`}
      >
        {/* Sparkle icon */}
        <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2" />
        </svg>
        <span className="hidden sm:inline">AI</span>
      </button>

      {/* Dropdown panel */}
      {isOpen && (
        <div className="absolute right-0 top-full mt-1 w-64 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg z-50 p-2">
          {/* Action buttons */}
          <div className="space-y-1">
            {ACTIONS.map((actionDef) => {
              const isDisabled = actionDef.requiresSelection && !selectedText;
              const isLoading = loading === actionDef.action;

              return (
                <button
                  key={actionDef.action}
                  type="button"
                  onClick={() => handleAction(actionDef)}
                  disabled={!!loading || isDisabled}
                  title={actionDef.description}
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
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Result preview panel */}
      {(result || error) && (
        <div className="absolute right-0 top-full mt-1 w-96 bg-[var(--color-surface)] border border-[var(--color-border)] rounded-lg shadow-lg z-50 p-3">
          {error ? (
            <div>
              <p className="text-xs text-red-600 dark:text-red-400 mb-2">{error}</p>
              <button
                type="button"
                onClick={handleDiscard}
                className="text-xs px-2 py-1 rounded bg-[var(--color-surface-hover)] hover:bg-[var(--color-border)]"
              >
                Dismiss
              </button>
            </div>
          ) : (
            <div>
              <div className="text-xs text-[var(--color-text-secondary)] mb-2 font-medium">
                AI Result
              </div>
              <div className="max-h-48 overflow-y-auto text-xs text-[var(--color-text-primary)] whitespace-pre-wrap border border-[var(--color-border)] rounded p-2 mb-2 bg-[var(--color-surface-hover)]">
                {result}
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
    </div>
  );
};

export default AIActions;
