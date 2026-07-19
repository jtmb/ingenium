"use client";

import { useEffect, useRef, useId } from "react";
import { createPortal } from "react-dom";

type OverlayProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  fullScreen?: boolean;
  children: React.ReactNode;
};

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

/**
 * Full-screen settings overlay with backdrop, Escape-to-close, body scroll lock,
 * focus trapping, and focus restoration.
 *
 * Uses `createPortal` to render outside the component tree so the overlay
 * sits above all other content regardless of z-index stacking context.
 * Body scroll is locked while open to prevent background scrolling on mobile.
 *
 * A11Y contract (A11Y-001):
 * - Escape dismisses the overlay
 * - Focus moves to the first focusable element (close button) on open
 * - Tab/Shift+Tab cycles within the overlay (focus trap)
 * - Focus returns to the trigger element when the overlay closes
 * - Enter/Space activate buttons (browser default — no custom handling needed)
 */
export default function Overlay({ isOpen, onClose, title, subtitle, fullScreen, children }: OverlayProps) {
  const panelRef = useRef<HTMLDivElement>(null);
  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const titleId = useId();

  // Keep the onClose ref in sync so the effect never needs to re-register
  onCloseRef.current = onClose;

  useEffect(() => {
    if (!isOpen) return;

    // Capture the currently focused element so we can restore it later
    previousFocus.current = document.activeElement as HTMLElement;

    const handleKeyDown = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        onCloseRef.current();
        return;
      }
      if (e.key === "Tab") {
        const panel = panelRef.current;
        if (!panel) return;
        const focusable = Array.from(
          panel.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR),
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;

        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    document.body.style.overflow = "hidden";

    // Focus the close button after a tick to ensure the portal has rendered
    setTimeout(() => closeBtnRef.current?.focus(), 0);

    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";

      // Restore focus to the element that triggered the overlay
      if (previousFocus.current) {
        previousFocus.current.focus();
        previousFocus.current = null;
      }
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-start justify-center" role="dialog" aria-modal="true" aria-labelledby={titleId}>
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />
      
      {/* Panel */}
      <div
        ref={panelRef}
        className={`relative bg-[var(--color-surface)] rounded-lg shadow-2xl flex flex-col ${
          fullScreen
            ? "w-[calc(100%-32px)] h-[calc(100%-32px)] m-4 max-w-none"
            : "mt-8 mb-8 w-11/12 max-w-7xl max-h-[90vh]"
        }`}
      >
        {/* Header */}
        <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] shrink-0">
          <div className="min-w-0">
            <h2 id={titleId} className="text-xl font-bold truncate">{title}</h2>
            {subtitle && <p className="text-sm text-[var(--color-text-muted)] truncate">{subtitle}</p>}
          </div>
          <button
            ref={closeBtnRef}
            onClick={onClose}
            className="ml-4 p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] rounded-full shrink-0"
            aria-label="Close"
          >
            <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Body */}
        <div className={`flex-1 overflow-y-auto px-6 py-4 ${fullScreen ? "flex flex-col" : ""}`}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
