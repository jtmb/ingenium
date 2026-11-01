"use client";

import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type TextareaHTMLAttributes } from "react";

/** Shared composer assets. Feature controllers own drafts, attachments and send authority. */
export function ComposerSurface({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} data-testid="chat-composer-shell" className={`veyra-composer-surface max-w-3xl mx-auto rounded-[26px] border border-[var(--color-border)] bg-[var(--color-surface-raised)] shadow-sm transition-colors ${className}`} />;
}

export const ComposerInput = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function ComposerInput({ className = "", rows = 1, ...props }, ref) {
    return <textarea {...props} ref={ref} rows={rows} data-testid="chat-composer" className={`veyra-composer-input min-w-0 flex-1 resize-none bg-transparent text-sm text-[var(--color-text-primary)] placeholder:text-[var(--color-text-muted)] outline-none py-1 min-h-[24px] max-h-[200px] disabled:opacity-50 ${className}`} />;
  },
);

export const ComposerAddButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function ComposerAddButton({ className = "", type = "button", ...props }, ref) {
    return <button {...props} ref={ref} type={type} className={`veyra-composer-plus-trigger disabled:opacity-40 ${className}`}>
      <svg width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path d="M8 2v12M2 8h12" strokeLinecap="round" /></svg>
    </button>;
  },
);

type SendButtonProps = ButtonHTMLAttributes<HTMLButtonElement> & {
  mode?: "send" | "stop";
  pending?: boolean;
  hasContent?: boolean;
  showLabel?: boolean;
};

/** The arrow, stop square, progress indicator and sizing have one owner. */
export function ComposerSendButton({ mode = "send", pending = false, hasContent = true, showLabel = false,
  className = "", type = "button", ...props }: SendButtonProps) {
  const stop = mode === "stop";
  const label = stop ? "Stop generating" : "Send message";
  const color = stop
    ? "bg-[var(--color-surface-hover)] text-[var(--color-text-primary)] hover:bg-[var(--color-surface-selected)]"
    : hasContent && !pending
      ? "bg-blue-600 text-white hover:bg-blue-700"
      : "bg-[var(--color-surface-hover)] text-[var(--color-text-muted)] cursor-not-allowed";
  return <button aria-label={label} title={label} {...props} type={type}
    data-testid={stop ? "chat-stop-btn" : "chat-send-btn"}
    className={`veyra-composer-send h-9 w-9 rounded-full p-2 transition-colors shrink-0 inline-flex items-center justify-center disabled:bg-[var(--color-accent)] disabled:text-white disabled:opacity-55 ${color} ${className}`}>
    {stop
      ? <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="1.5" /></svg>
      : pending
        ? <svg className="animate-spin" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="28" strokeDashoffset="10" strokeLinecap="round" opacity="0.5" /></svg>
        : <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M8 13V3M3 8l5-5 5 5" /></svg>}
    {showLabel && !stop && <span>Send</span>}
  </button>;
}
