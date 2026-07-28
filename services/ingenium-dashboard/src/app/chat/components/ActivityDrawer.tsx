"use client";

import { useEffect, useId, useMemo, useRef } from "react";
import type { ChatMessage } from "./ChatMessages";
import {
  buildActivityTimeline,
  type ActivityEvent,
  type ActivitySelection,
  type ToolActivityEvent,
} from "./chat-activity";

interface ActivityDrawerProps {
  isOpen: boolean;
  selection: ActivitySelection | null;
  messages: ChatMessage[];
  onClose: () => void;
}

const FOCUSABLE_SELECTOR = [
  'button:not([disabled])',
  '[href]',
  'input:not([disabled])',
  'select:not([disabled])',
  'textarea:not([disabled])',
  '[tabindex]:not([tabindex="-1"])',
].join(",");

function stateLabel(state: ToolActivityEvent["state"]): string | undefined {
  const status = state?.status;
  if (!status) return undefined;
  return status;
}

function SiteGroups({ sites }: { sites: ToolActivityEvent["sites"] }) {
  const groups: Array<{ label: ToolActivityEvent["sites"][number]["label"]; sites: typeof sites }> = [];
  for (const site of sites) {
    const lastGroup = groups.at(-1);
    if (lastGroup?.label === site.label) {
      lastGroup.sites.push(site);
    } else {
      groups.push({ label: site.label, sites: [site] });
    }
  }

  return (
    <div className="mt-3 space-y-3" data-testid="chat-activity-sites">
      {groups.map(({ label, sites: grouped }, groupIndex) => {
        return (
          <section key={`${label}-${groupIndex}`} data-testid="chat-activity-site-group" data-label={label}>
            <h4 className="text-xs font-medium text-[var(--color-text-secondary)]">{label}</h4>
            <ul className="mt-1 space-y-1">
              {grouped.map((site) => (
                <li key={site.url} className="min-w-0">
                  <a
                    href={site.url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="block min-h-11 break-all py-2 text-xs text-[var(--color-text-link)] underline underline-offset-2 hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-link)]"
                    data-testid="chat-activity-site-link"
                  >
                    {site.url}
                  </a>
                </li>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}

function ActivityEventView({ event }: { event: ActivityEvent }) {
  if (event.kind === "reasoning") {
    return (
      <li className="relative pl-5" data-testid="chat-activity-event" data-kind="reasoning">
        <span className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-[var(--color-text-muted)]" aria-hidden="true" />
        <p className="text-xs font-medium text-[var(--color-text-secondary)]">Reasoning</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--color-text-primary)]">
          {event.text}
        </p>
      </li>
    );
  }

  if (event.kind === "text") {
    return (
      <li className="relative pl-5" data-testid="chat-activity-event" data-kind="text">
        <span className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-[var(--color-text-muted)]" aria-hidden="true" />
        <p className="text-xs font-medium text-[var(--color-text-secondary)]">Response</p>
        <p className="mt-1 whitespace-pre-wrap break-words text-sm leading-relaxed text-[var(--color-text-primary)]">
          {event.text}
        </p>
      </li>
    );
  }

  const status = stateLabel(event.state);
  return (
    <li className="relative pl-5" data-testid="chat-activity-event" data-kind="tool">
      <span className="absolute left-0 top-1.5 h-2 w-2 rounded-full bg-[var(--color-text-muted)]" aria-hidden="true" />
      <div className="flex flex-wrap items-baseline gap-x-2 gap-y-1">
        {event.toolName && (
          <p className="text-xs font-medium text-[var(--color-text-secondary)]">{event.toolName}</p>
        )}
        {status && (
          <p className="text-xs text-[var(--color-text-muted)]" data-testid="chat-activity-tool-state">
            {status}
          </p>
        )}
      </div>
      {event.query && (
        <p className="mt-2 break-words text-sm text-[var(--color-text-primary)]" data-testid="chat-activity-query">
          {event.query}
        </p>
      )}
      {event.sites.length > 0 && <SiteGroups sites={event.sites} />}
    </li>
  );
}

/** Accessible, live-updating activity drawer for a selected assistant tool. */
export default function ActivityDrawer({
  isOpen,
  selection,
  messages,
  onClose,
}: ActivityDrawerProps) {
  const dialogId = useId();
  const dialogRef = useRef<HTMLDivElement>(null);
  const closeButtonRef = useRef<HTMLButtonElement>(null);
  const previousFocusRef = useRef<HTMLElement | null>(null);
  const onCloseRef = useRef(onClose);
  const selectedMessage = selection
    ? messages.find((message) => message.id === selection.messageId)
    : undefined;
  const timeline = useMemo(
    () => buildActivityTimeline(selectedMessage),
    [selectedMessage],
  );

  useEffect(() => {
    onCloseRef.current = onClose;
  }, [onClose]);

  useEffect(() => {
    if (!isOpen) return undefined;

    previousFocusRef.current = document.activeElement instanceof HTMLElement
      ? document.activeElement
      : null;
    const frame = window.requestAnimationFrame(() => closeButtonRef.current?.focus());
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") {
        event.preventDefault();
        onCloseRef.current();
        return;
      }
      if (event.key !== "Tab") return;

      const focusable = Array.from(
        dialogRef.current?.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR) ?? [],
      );
      if (focusable.length === 0) {
        event.preventDefault();
        return;
      }
      const first = focusable[0]!;
      const last = focusable[focusable.length - 1]!;
      if (event.shiftKey && document.activeElement === first) {
        event.preventDefault();
        last.focus();
      } else if (!event.shiftKey && document.activeElement === last) {
        event.preventDefault();
        first.focus();
      }
    };

    document.addEventListener("keydown", handleKeyDown);
    return () => {
      window.cancelAnimationFrame(frame);
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = previousOverflow;
      if (previousFocusRef.current?.isConnected) previousFocusRef.current.focus();
    };
  }, [isOpen]);

  if (!isOpen) return null;

  return (
    <div className="fixed inset-0 z-[70] flex justify-end" data-testid="chat-activity-drawer">
      <div
        className="activity-drawer-backdrop absolute inset-0 bg-black/50"
        onClick={(event) => {
          if (event.target === event.currentTarget) onClose();
        }}
        aria-hidden="true"
        data-testid="chat-activity-backdrop"
      />
      <div
        ref={dialogRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby={dialogId}
        className="activity-drawer-panel relative z-10 flex h-full w-full flex-col border-l border-[var(--color-border)] bg-[var(--color-surface)] shadow-2xl md:w-[400px]"
      >
        <header className="flex min-h-[64px] shrink-0 items-center justify-between gap-3 border-b border-[var(--color-border)] px-4 py-2.5">
          <h2 id={dialogId} className="text-base font-semibold text-[var(--color-text-primary)]">
            Activity
          </h2>
          <button
            ref={closeButtonRef}
            type="button"
            onClick={onClose}
            className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-md text-[var(--color-text-secondary)] transition-colors hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-text-primary)] focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-link)]"
            aria-label="Close activity drawer"
          >
            <svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" strokeWidth="1.5" aria-hidden="true">
              <path strokeLinecap="round" d="M4.5 4.5l9 9M13.5 4.5l-9 9" />
            </svg>
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-4 py-5" aria-live="polite">
          {timeline.length > 0 ? (
            <ol className="relative space-y-6 before:absolute before:bottom-1 before:left-[3px] before:top-1 before:w-px before:bg-[var(--color-border)]">
              {timeline.map((event) => (
                <ActivityEventView key={event.id} event={event} />
              ))}
            </ol>
          ) : (
            <p className="text-sm text-[var(--color-text-muted)]" data-testid="chat-activity-empty">
              No provider activity recorded for this message.
            </p>
          )}
        </div>
      </div>
      <style>{`
        .activity-drawer-panel {
          animation: activity-drawer-in 180ms ease-out both;
        }
        .activity-drawer-backdrop {
          animation: activity-drawer-backdrop-in 180ms ease-out both;
        }
        @keyframes activity-drawer-in {
          from { transform: translateX(100%); }
          to { transform: translateX(0); }
        }
        @keyframes activity-drawer-backdrop-in {
          from { opacity: 0; }
          to { opacity: 1; }
        }
        @media (prefers-reduced-motion: reduce) {
          .activity-drawer-panel,
          .activity-drawer-backdrop {
            animation: none;
          }
        }
      `}</style>
    </div>
  );
}
