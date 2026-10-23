"use client";

import { useState, useCallback } from "react";

export interface QuestionOption {
  label: string;
  description?: string;
  value?: string;
}

export type QuestionAnswerValue = string | number | boolean | string[];

export interface QuestionItem {
  id: string;
  requestId?: string;
  question: string;
  header?: string;
  options?: QuestionOption[];
  multiple?: boolean;
  type?: "string" | "number" | "integer" | "boolean" | "multiselect" | "external";
  required?: boolean;
  hidden?: boolean;
  when?: Array<{ key: string; op: "eq" | "neq"; value: string | number | boolean }>;
  placeholder?: string;
  url?: string;
  default?: QuestionAnswerValue;
  format?: "email" | "uri" | "date" | "date-time";
  minimum?: number;
  maximum?: number;
  minLength?: number;
  maxLength?: number;
  pattern?: string;
  minItems?: number;
  maxItems?: number;
  custom?: boolean;
}

function matchesPattern(value: string, pattern?: string): boolean {
  if (!pattern) return true;
  try {
    return new RegExp(`^(?:${pattern})$`).test(value);
  } catch {
    return false;
  }
}

function externalHttpUrl(value?: string): string | undefined {
  if (typeof value !== "string" || !value || value.trim() !== value || /[\u0000-\u001F\u007F]/.test(value)) return undefined;
  try {
    const url = new URL(value);
    return url.protocol === "http:" || url.protocol === "https:" ? value : undefined;
  } catch {
    return undefined;
  }
}

interface QuestionPromptProps {
  requestId: string;
  questions: QuestionItem[];
  onReply: (requestId: string, answers: Record<string, QuestionAnswerValue>) => void;
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
  const [answers, setAnswers] = useState<Record<string, QuestionAnswerValue>>({});

  const valueFor = (question: QuestionItem): QuestionAnswerValue | undefined =>
    answers[question.id] ?? question.default;
  const applicableQuestions = questions.filter((question) =>
    question.when?.every((condition) => {
      const dependent = questions.find((candidate) => candidate.id === condition.key);
      const answer = dependent && valueFor(dependent);
      const matches = dependent && (dependent.type === "number" || dependent.type === "integer")
        && typeof condition.value === "number" && answer !== "" && answer !== undefined
        && (typeof answer === "string" || typeof answer === "number")
        ? Number.isFinite(Number(answer)) && Number(answer) === condition.value
        : answer === condition.value;
      return dependent && answer !== undefined && answer !== "" && (condition.op === "eq" ? matches : !matches);
    }) !== false);
  const visibleQuestions = applicableQuestions.filter((question) => !question.hidden);
  const answerableQuestions = visibleQuestions.filter((question) => question.type !== "external");
  const hasHiddenDefaultOnly = answerableQuestions.length === 0 && applicableQuestions.some((question) =>
    question.hidden && question.type !== "external" && question.default !== undefined
    && question.default !== "" && (!Array.isArray(question.default) || question.default.length > 0));
  const hasAnswer = hasHiddenDefaultOnly || answerableQuestions.some((question) => {
    const answer = valueFor(question);
    return Array.isArray(answer) ? answer.length > 0 : answer !== undefined && answer !== "";
  });

  const validAnswer = (question: QuestionItem): boolean => {
    const answer = valueFor(question);
    if (answer === undefined || answer === "" || Array.isArray(answer) && answer.length === 0) {
      return !question.required;
    }
    if (question.type === "number" || question.type === "integer") {
      const number = Number(answer);
      return Number.isFinite(number)
        && (question.type !== "integer" || Number.isInteger(number))
        && (question.minimum === undefined || number >= question.minimum)
        && (question.maximum === undefined || number <= question.maximum);
    }
    if (Array.isArray(answer)) {
      return (question.minItems === undefined || answer.length >= question.minItems)
        && (question.maxItems === undefined || answer.length <= question.maxItems);
    }
    if (typeof answer === "string") {
      return (question.minLength === undefined || answer.length >= question.minLength)
        && (question.maxLength === undefined || answer.length <= question.maxLength)
        && matchesPattern(answer, question.pattern)
        && (question.format !== "email" || /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(answer))
        && (question.format !== "uri" || URL.canParse(answer));
    }
    return true;
  };

  const toggleOption = useCallback(
    (questionId: string, optionValue: string, multiple: boolean) => {
      if (!isActive) return;
      setAnswers((prev) => {
        const current = Array.isArray(prev[questionId]) ? prev[questionId] : [];
        if (multiple) {
          const next = current.includes(optionValue)
            ? current.filter((value) => value !== optionValue)
            : [...current, optionValue];
          return { ...prev, [questionId]: next };
        }
        return { ...prev, [questionId]: optionValue };
      });
    },
    [isActive],
  );

  const handleSubmit = () => {
    if (!isActive || !hasAnswer || !answerableQuestions.every(validAnswer)) return;
    const submitted = Object.fromEntries(applicableQuestions.flatMap((question) => {
      if (question.hidden && question.default === undefined) return [];
      const answer = valueFor(question);
      if (question.type === "external" || answer === undefined || answer === "") return [];
      return [[question.id, question.type === "number" || question.type === "integer" ? Number(answer) : answer]];
    }));
    onReply(requestId, submitted);
  };

  const requiredComplete = answerableQuestions.every(validAnswer);

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
        {visibleQuestions.map((q) => {
          const currentAnswer = valueFor(q);
          const currentSelections = Array.isArray(currentAnswer) ? currentAnswer : [];
          const isMultiple = q.multiple === true;
          const hasOptions = q.options && q.options.length > 0;
          const externalUrl = q.type === "external" ? externalHttpUrl(q.url) : undefined;

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
                    const optionValue = opt.value ?? opt.label;
                    const isSelected = isMultiple
                      ? currentSelections.includes(optionValue)
                      : currentAnswer === optionValue;
                    return (
                      <button
                        key={`${q.id}-${idx}`}
                        type="button"
                        onClick={() => toggleOption(q.id, optionValue, isMultiple)}
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
              ) : q.type === "boolean" ? (
                <div className="flex gap-2" role="group" aria-label={q.question}>
                  {[true, false].map((value) => (
                    <button
                      key={String(value)}
                      type="button"
                      onClick={() => setAnswers((current) => ({ ...current, [q.id]: value }))}
                      disabled={!isActive}
                      aria-pressed={currentAnswer === value}
                      className="rounded-md border border-[var(--color-border)] px-3 py-1.5 text-sm text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] aria-pressed:bg-[var(--color-surface-selected)] aria-pressed:text-[var(--color-text-primary)]"
                    >
                      {value ? "Yes" : "No"}
                    </button>
                  ))}
                </div>
              ) : q.type === "external" ? (
                externalUrl ? (
                  <a
                    href={externalUrl}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-sm text-[var(--color-text-link)] underline underline-offset-2"
                  >
                    Continue in a new tab
                  </a>
                ) : (
                  <span role="status" className="text-sm text-[var(--color-text-muted)]">
                    External link unavailable
                  </span>
                )
              ) : (
                <input
                  type={q.type === "number" || q.type === "integer" ? "number" : q.format ?? "text"}
                  step={q.type === "integer" ? 1 : undefined}
                  min={q.minimum}
                  max={q.maximum}
                  minLength={q.minLength}
                  maxLength={q.maxLength}
                  pattern={q.pattern}
                  required={q.required}
                  value={typeof currentAnswer === "string" || typeof currentAnswer === "number" ? currentAnswer : ""}
                  placeholder={q.placeholder}
                  disabled={!isActive}
                  onChange={(event) => {
                    const value = event.target.value;
                    setAnswers((current) => ({ ...current, [q.id]: value }));
                  }}
                  className="w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)] outline-none focus:border-blue-500 disabled:opacity-50"
                  aria-label={q.question}
                />
              )}
            </div>
          );
        })}
      </div>

      {(answerableQuestions.length > 0 || hasHiddenDefaultOnly) && (
        <div className="mt-2 flex items-center justify-between gap-2">
          <p className="text-xs text-[var(--color-text-muted)]">
            {!hasAnswer ? "Provide an answer to continue" : "Ready to submit"}
          </p>
          <button
            type="button"
            onClick={handleSubmit}
            disabled={!isActive || !hasAnswer || !requiredComplete}
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
