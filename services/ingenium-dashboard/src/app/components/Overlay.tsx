"use client";

import { useEffect, useRef, useId } from "react";
import { createPortal } from "react-dom";

type OverlayProps = {
  isOpen: boolean;
  onClose: () => void;
  title: string;
  subtitle?: string;
  fullScreen?: boolean;
  /** Replaces the default panel sizing classes without changing dialog behavior. */
  panelClassName?: string;
  /** Replaces the default body layout classes without changing dialog behavior. */
  bodyClassName?: string;
  children: React.ReactNode;
};

const FOCUSABLE_SELECTOR =
  'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])';

let bodyScrollLockCount = 0;
let bodyOverflowBeforeFirstLock = "";

function lockBodyScroll(): void {
  if (bodyScrollLockCount === 0) {
    bodyOverflowBeforeFirstLock = document.body.style.overflow;
    document.body.style.overflow = "hidden";
  }
  bodyScrollLockCount += 1;
}

function unlockBodyScroll(): void {
  bodyScrollLockCount = Math.max(0, bodyScrollLockCount - 1);
  if (bodyScrollLockCount === 0) {
    document.body.style.overflow = bodyOverflowBeforeFirstLock;
    bodyOverflowBeforeFirstLock = "";
  }
}

type BackgroundInertState = {
  count: number;
  inert: boolean;
  ariaHidden: string | null;
};

const backgroundInertStates = new Map<HTMLElement, BackgroundInertState>();

/**
 * Keep all direct body siblings out of the accessibility tree while the
 * portalled dialog is open. Capturing their prior state makes this safe for
 * consumers that already manage an inert or aria-hidden application shell.
 */
function makeBackgroundInert(overlayRoot: HTMLElement): () => void {
  const background = Array.from(document.body.children)
    .filter((child): child is HTMLElement => child instanceof HTMLElement && child !== overlayRoot);

  for (const element of background) {
    const existing = backgroundInertStates.get(element);
    if (existing) {
      existing.count += 1;
      continue;
    }

    backgroundInertStates.set(element, {
      count: 1,
      inert: element.inert,
      ariaHidden: element.getAttribute("aria-hidden"),
    });
    element.inert = true;
    element.setAttribute("aria-hidden", "true");
  }

  return () => {
    for (const element of background) {
      const state = backgroundInertStates.get(element);
      if (!state) continue;
      state.count -= 1;
      if (state.count > 0) continue;

      element.inert = state.inert;
      if (state.ariaHidden === null) element.removeAttribute("aria-hidden");
      else element.setAttribute("aria-hidden", state.ariaHidden);
      backgroundInertStates.delete(element);
    }
  };
}

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
export default function Overlay({
  isOpen,
  onClose,
  title,
  subtitle,
  fullScreen,
  panelClassName,
  bodyClassName,
  children,
}: OverlayProps) {
  const overlayRootRef = useRef<HTMLDivElement>(null);
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
        ).filter(
          (element) =>
            !element.matches(':disabled, [aria-disabled="true"], [tabindex="-1"]') &&
            !element.closest("[hidden], [inert]"),
        );
        const first = focusable[0];
        const last = focusable[focusable.length - 1];
        if (!first || !last) return;

        if (!panel.contains(document.activeElement)) {
          e.preventDefault();
          (e.shiftKey ? last : first).focus();
        } else if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    lockBodyScroll();
    const restoreBackground = overlayRootRef.current
      ? makeBackgroundInert(overlayRootRef.current)
      : () => {};

    // Focus the close button after a tick to ensure the portal has rendered
    const focusTimer = window.setTimeout(() => closeBtnRef.current?.focus(), 0);

    return () => {
      window.clearTimeout(focusTimer);
      document.removeEventListener("keydown", handleKeyDown);
      unlockBodyScroll();
      restoreBackground();

      // Restore focus to the element that triggered the overlay
      if (previousFocus.current?.isConnected) {
        previousFocus.current.focus();
      }
      previousFocus.current = null;
    };
  }, [isOpen]);

  if (!isOpen) return null;

  const defaultPanelClassName = fullScreen
    ? "w-[calc(100%-32px)] h-[calc(100%-32px)] m-4 max-w-none"
    : "mt-8 mb-8 w-11/12 max-w-7xl max-h-[90vh]";
  const defaultBodyClassName = `flex-1 overflow-y-auto px-6 py-4 ${fullScreen ? "flex flex-col" : ""}`;

  return createPortal(
    <div ref={overlayRootRef} className="fixed inset-0 z-50 flex items-start justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} aria-hidden="true" />
      
      {/* Panel */}
      <div
        ref={panelRef}
        className={`relative bg-[var(--color-surface)] rounded-lg shadow-2xl flex flex-col ${panelClassName ?? defaultPanelClassName}`}
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
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
        <div className={bodyClassName ?? defaultBodyClassName}>
          {children}
        </div>
      </div>
    </div>,
    document.body
  );
}
