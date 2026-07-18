"use client";

import { useEffect, useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ALL_TABS, tabForPathname } from "./tabs";
import type { SettingsTab } from "./tabs";
import SettingsSidebar from "./SettingsSidebar";
import PlaceholderPanel from "./PlaceholderPanel";
import { GeneralPanel, MailPanel, PipelinePanel, ConfigPanel } from "./panels";
import type { ComponentType } from "react";

/**
 * Registry mapping tab IDs to their real panel components.
 * Tabs without a registered component fall back to PlaceholderPanel.
 * Extend this record when adding a new settings panel.
 */
const TAB_PANELS: Record<string, ComponentType> = {
  general: GeneralPanel,
  mail: MailPanel,
  providers: PipelinePanel,
  config: ConfigPanel,
};

/** Only tabs that have real panel components registered — hides tabs with PlaceholderPanel fallback. */
const VISIBLE_TABS = ALL_TABS.filter((t) => TAB_PANELS[t.id] !== undefined);

/** Resolves a tab ID to either a registered panel component or the generic placeholder. */
function TabPanel({ tabId, activeTab }: { tabId: string; activeTab: SettingsTab }) {
  const Panel = TAB_PANELS[tabId];
  return Panel ? <Panel /> : <PlaceholderPanel tab={activeTab} />;
}

/**
 * Full-screen settings overlay rendered via portal to `document.body`.
 *
 * State is driven entirely by the `?settings=<tabId>` URL search param —
 * no separate React state. This enables deep-linking and back-button support.
 * If the param is missing or invalid, the tab is derived from the current page
 * pathname via `tabForPathname`.
 *
 * `useCallback` wrappers around `close`/`selectTab` are required because they
 * appear in the `useEffect` dependency chain (Escape key handler).
 */
export default function SettingsOverlay() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  // SSR guard: defer portal rendering until client hydration completes.
  // `createPortal(..., document.body)` cannot run during SSR because
  // `document` is undefined on the server, even inside a Suspense boundary.
  const [mounted, setMounted] = useState(false);
  useEffect(() => { setMounted(true); }, []);

  const settingsParam = searchParams.get("settings");
  const isOpen = settingsParam !== null;

  const currentTabId = settingsParam && VISIBLE_TABS.some((t) => t.id === settingsParam)
    ? settingsParam
    : VISIBLE_TABS.some((t) => t.id === tabForPathname(pathname))
      ? tabForPathname(pathname)
      : VISIBLE_TABS[0]?.id ?? "general";

  const activeTab: SettingsTab = VISIBLE_TABS.find((t) => t.id === currentTabId) ?? VISIBLE_TABS[0]!;

  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("settings");
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, router, searchParams]);

  const selectTab = useCallback((id: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("settings", id);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  }, [pathname, router, searchParams]);

  const handleKeyDown = useCallback((e: KeyboardEvent) => {
    if (e.key === "Escape") {
      close();
      return;
    }
    if (e.key === "Tab") {
      const modal = document.querySelector('[role="dialog"]');
      if (!modal) return;
      const focusable = Array.from(modal.querySelectorAll<HTMLElement>(
        'button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])',
      )).filter((el) => !el.closest("[hidden]") && !el.closest("[inert]"));
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
  }, [close]);

  useEffect(() => {
    // Only execute DOM operations after client hydration (mounted guard).
    if (!mounted) return;
    if (isOpen) {
      previousFocus.current = document.activeElement as HTMLElement;
      // Focus the close button after a tick (wait for render)
      setTimeout(() => closeBtnRef.current?.focus(), 0);
      document.addEventListener("keydown", handleKeyDown);
      // Lock background scroll while overlay is open (prevents double-scroll)
      document.body.style.overflow = "hidden";
    } else {
      // Return focus on close
      if (previousFocus.current) {
        previousFocus.current.focus();
        previousFocus.current = null;
      }
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen, handleKeyDown, mounted]);

  if (!isOpen || !mounted) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      <div className="absolute inset-0 bg-black/50" onClick={close} />

      <div 
        className="relative w-11/12 max-w-7xl h-[85vh] flex bg-[var(--color-surface)] rounded-lg shadow-2xl overflow-hidden"
        role="dialog"
        aria-modal="true"
        aria-labelledby="settings-title"
      >
        <SettingsSidebar
          tabs={VISIBLE_TABS}
          activeTab={currentTabId}
          onSelect={selectTab}
        />

        <div className="flex-1 flex flex-col min-w-0">
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] shrink-0">
            <h2 id="settings-title" className="text-xl font-bold text-[var(--color-text-primary)]">Settings</h2>
            <button
              ref={closeBtnRef}
              onClick={close}
              className="ml-4 p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] rounded-full shrink-0"
              aria-label="Close settings"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Mobile tab selector — visible only below md breakpoint */}
          <select
            value={activeTab.id}
            onChange={(e) => selectTab(e.target.value)}
            className="md:hidden mx-6 mt-3 border border-[var(--color-border)] rounded px-3 py-1.5 text-sm bg-[var(--color-surface)]"
            aria-label="Settings category"
          >
            {VISIBLE_TABS.map(tab => (
              <option key={tab.id} value={tab.id}>{tab.label}</option>
            ))}
          </select>

          <div className="flex-1 overflow-y-auto">
            {VISIBLE_TABS.map((tab) => (
              <div key={tab.id} hidden={tab.id !== activeTab.id} inert={tab.id !== activeTab.id || undefined}>
                <TabPanel tabId={tab.id} activeTab={tab} />
              </div>
            ))}
          </div>
        </div>
      </div>

      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        div :global([role="dialog"]) {
          animation: fadeIn 200ms ease-out;
        }
        @media (prefers-reduced-motion: reduce) {
          div :global([role="dialog"]) {
            animation: none;
          }
        }
      `}</style>
    </div>,
    document.body
  );
}
