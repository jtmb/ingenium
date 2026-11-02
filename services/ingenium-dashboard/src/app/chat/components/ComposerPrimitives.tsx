"use client";

import { forwardRef, type ButtonHTMLAttributes, type HTMLAttributes, type TextareaHTMLAttributes } from "react";
import "./composer-primitives.css";

/** Shared composer assets. Feature controllers own drafts, attachments and send authority. */
export function ComposerSurface({ className = "", ...props }: HTMLAttributes<HTMLDivElement>) {
  return <div {...props} data-testid="chat-composer-shell" className={`veyra-composer-surface ${className}`} />;
}

export const ComposerInput = forwardRef<HTMLTextAreaElement, TextareaHTMLAttributes<HTMLTextAreaElement>>(
  function ComposerInput({ className = "", rows = 1, ...props }, ref) {
    return <textarea {...props} ref={ref} rows={rows} data-testid="chat-composer" className={`veyra-composer-input ${className}`} />;
  },
);

export const ComposerAddButton = forwardRef<HTMLButtonElement, ButtonHTMLAttributes<HTMLButtonElement>>(
  function ComposerAddButton({ className = "", type = "button", ...props }, ref) {
    return <button {...props} ref={ref} type={type} className={`veyra-composer-plus-trigger ${className}`}>
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
  return <button aria-label={label} title={label} {...props} type={type}
    data-testid={stop ? "chat-stop-btn" : "chat-send-btn"}
    data-composer-mode={mode}
    data-composer-has-content={hasContent}
    data-composer-pending={pending}
    aria-busy={pending || undefined}
    className={`veyra-composer-send ${className}`}>
    {stop
      ? <svg width="16" height="16" viewBox="0 0 16 16" fill="currentColor" aria-hidden="true"><rect x="3" y="3" width="10" height="10" rx="1.5" /></svg>
      : pending
        ? <svg className="veyra-composer-spinner" width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true"><circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.5" strokeDasharray="28" strokeDashoffset="10" strokeLinecap="round" opacity="0.5" /></svg>
        : <svg width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true"><path strokeLinecap="round" strokeLinejoin="round" d="M8 13V3M3 8l5-5 5 5" /></svg>}
    {showLabel && !stop && <span>Send</span>}
  </button>;
}
