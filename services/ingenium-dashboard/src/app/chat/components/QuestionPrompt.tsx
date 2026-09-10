"use client";

import { useState, useCallback } from "react";

export interface QuestionOption {
  label: string;
  description?: string;
}

export interface QuestionItem {
  id: string;
  question: string;
  header?: string;
  options?: QuestionOption[];
  multiple?: boolean;
}

interface QuestionPromptProps {
  requestId: string;
  questions: QuestionItem[];
  onReply: (requestId: string, answers: Record<string, string[]>) => void;
  isActive: boolean;
}

/**
 * QuestionPrompt — structured question flow for when the agent asks the
 * user a question. Supports both single-choice (radio) and multi-select
 * (checkbox) questions.
 *
 * Renders each question with its options as radio or checkbox buttons.
 * The user selects options and clicks "Submit Answer" to reply.
 */
export default function QuestionPrompt({
  requestId,
  questions,
  onReply,
  isActive,
}: QuestionPromptProps) {
  // Store selected option labels keyed by question id
  const [selected, setSelected] = useState<Record<string, string[]>>({});

  const toggleOption = useCallback(
    (questionId: string, optionLabel: string, multiple: boolean) => {
      if (!isActive) return;
      setSelected((prev) => {
        const current = prev[questionId] ?? [];
        if (multiple) {
          // Multi-select – toggle the label in/out
          const next = current.includes(optionLabel)
            ? current.filter((l) => l !== optionLabel)
            : [...current, optionLabel];
          return { ...prev, [questionId]: next };
        }
        // Single-select – replace
        return { ...prev, [questionId]: [optionLabel] };
      });
    },
    [isActive],
  );

  const handleSubmit = useCallback(() => {
    if (!isActive) return;
    // Ensure every question has at least one selected option
    const answers: Record<string, string[]> = {};
    for (const q of questions) {
      answers[q.id] = selected[q.id] ?? [];
    }
    onReply(requestId, answers);
  }, [isActive, questions, selected, onReply, requestId]);

  // Check if at least one option is selected across all questions
  const hasSelection = questions.some(
    (q) => (selected[q.id] ?? []).length > 0,
  );
  // Whether any question has structured options
  const hasOptions = questions.some((q) => q.options && q.options.length > 0);

  return (
    <div
      className={`relative my-3 ${
        !isActive ? "opacity-50 pointer-events-none" : ""
      }`}
      data-testid="chat-question-prompt"
    >
      {/* Header */}
      <div className="flex items-center gap-2">
        <svg
          width="16"
          height="16"
          viewBox="0 0 16 16"
          fill="none"
          stroke="currentColor"
          strokeWidth="1.5"
          className="text-[var(--color-text-link)] shrink-0"
          aria-hidden="true"
        >
          <circle cx="8" cy="8" r="6.67" />
          <path strokeLinecap="round" d="M8 5.33v3.34" />
          <circle cx="8" cy="10.67" r="0.67" fill="currentColor" />
        </svg>
        <span className="text-sm font-medium text-[var(--color-text-primary)]">
          Question
        </span>
      </div>

      {/* Questions */}
      <div className="mt-2 space-y-4">
        {questions.map((q) => {
          const currentSelections = selected[q.id] ?? [];
          const isMultiple = q.multiple === true;
          const hasOptions = q.options && q.options.length > 0;

          return (
            <div key={q.id}>
              {/* Question text */}
              <p className="text-sm font-semibold text-[var(--color-text-primary)] mb-2.5">
                {q.question}
              </p>

              {hasOptions ? (
                /* Structured options (radio/checkbox) */
                <div className="space-y-1.5">
                  {q.options!.map((opt, idx) => {
                    const isSelected = currentSelections.includes(opt.label);
                    return (
                      <button
                        key={`${q.id}-${idx}`}
                        type="button"
                        onClick={() => toggleOption(q.id, opt.label, isMultiple)}
                        disabled={!isActive}
                        className={[
                          "w-full flex items-start gap-2.5 py-1.5 text-left transition-colors",
                          isSelected
                            ? "text-[var(--color-text-primary)]"
                            : "text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)]",
                        ].join(" ")}
                        role={isMultiple ? "checkbox" : "radio"}
                        aria-checked={isSelected}
                      >
                        {/* Selection indicator */}
                        <span className="shrink-0 mt-0.5">
                          {isMultiple ? (
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 16 16"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              className={
                                isSelected
                                  ? "text-[var(--color-text-link)]"
                                  : "text-[var(--color-text-muted)]"
                              }
                              aria-hidden="true"
                            >
                              <rect
                                x="2.67"
                                y="2.67"
                                width="10.66"
                                height="10.66"
                                rx="2.67"
                              />
                              {isSelected && (
                                <path
                                  strokeLinecap="round"
                                  strokeLinejoin="round"
                                  d="M5.33 8l2 2 3.34-4"
                                />
                              )}
                            </svg>
                          ) : (
                            <svg
                              width="16"
                              height="16"
                              viewBox="0 0 16 16"
                              fill="none"
                              stroke="currentColor"
                              strokeWidth="1.5"
                              className={
                                isSelected
                                  ? "text-[var(--color-text-link)]"
                                  : "text-[var(--color-text-muted)]"
                              }
                              aria-hidden="true"
                            >
                              <circle cx="8" cy="8" r="5.33" />
                              {isSelected && (
                                <circle cx="8" cy="8" r="2.67" fill="currentColor" />
                              )}
                            </svg>
                          )}
                        </span>

                        {/* Label + description */}
                        <div className="min-w-0">
                          <span
                            className={`text-sm font-medium ${
                              isSelected
                                ? "text-[var(--color-text-primary)]"
                                : "text-[var(--color-text-secondary)]"
                            }`}
                          >
                            {opt.label}
                            {opt.label.toLowerCase().includes("recommended") && (
                              <span className="ml-1.5 text-xs text-[var(--color-text-link)] font-normal">
                                (Recommended)
                              </span>
                            )}
                          </span>
                          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
                            {opt.description}
                          </p>
                        </div>
                      </button>
                    );
                  })}
                </div>
              ) : (
                /* Text-only question — just a confirmation prompt */
                <p className="text-xs text-[var(--color-text-muted)] mt-1">
                  Answer in the chat input below.
                </p>
              )}
            </div>
          );
        })}
      </div>

      {/* Submit button — only for structured questions with options */}
      {hasOptions && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-xs text-[var(--color-text-muted)]">
            {!hasSelection
              ? "Select an option to continue"
              : `${
                  questions
                    .flatMap((q) => selected[q.id] ?? [])
                    .length
                } option(s) selected`}
          </p>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!isActive || !hasSelection}
            className="py-1 text-sm font-medium text-[var(--color-text-primary)] underline underline-offset-2 hover:text-[var(--color-text-secondary)] transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            Submit Answer
          </button>
        </div>
      )}

      {/* Inactive overlay */}
      {!isActive && (
        <span className="mt-1 block text-xs text-[var(--color-text-muted)]">
          Already answered
        </span>
      )}
    </div>
  );
}
