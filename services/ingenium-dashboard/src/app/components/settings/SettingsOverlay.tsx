"use client";

import { useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ALL_TABS, tabForPathname } from "./tabs";
import type { SettingsTab } from "./tabs";
import SettingsSidebar from "./SettingsSidebar";
import PlaceholderPanel from "./PlaceholderPanel";
import { GeneralPanel, MailPanel, PipelinePanel, ConfigPanel } from "./panels";
import type { ComponentType } from "react";

/** Registry mapping tab IDs to their real panel components. */
const TAB_PANELS: Record<string, ComponentType> = {
  general: GeneralPanel,
  mail: MailPanel,
  pipeline: PipelinePanel,
  config: ConfigPanel,
};

function TabPanel({ tabId, activeTab }: { tabId: string; activeTab: SettingsTab }) {
  const Panel = TAB_PANELS[tabId];
  return Panel ? <Panel /> : <PlaceholderPanel tab={activeTab} />;
}

export default function SettingsOverlay() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const settingsParam = searchParams.get("settings");
  const isOpen = settingsParam !== null;

  const currentTabId = settingsParam && ALL_TABS.some((t) => t.id === settingsParam)
    ? settingsParam
    : tabForPathname(pathname);

  const activeTab: SettingsTab = ALL_TABS.find((t) => t.id === currentTabId) ?? ALL_TABS[0]!;

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
    if (e.key === "Escape") close();
  }, [close]);

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  return createPortal(
    <div className="fixed inset-0 z-50 flex items-center justify-center">
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={close} />

      {/* Panel */}
      <div className="relative w-[calc(100%-32px)] h-[calc(100%-32px)] m-4 flex bg-[var(--color-surface)] rounded-lg shadow-2xl overflow-hidden">
        {/* Sidebar */}
        <SettingsSidebar
          tabs={ALL_TABS}
          activeTab={currentTabId}
          onSelect={selectTab}
        />

        {/* Content */}
        <div className="flex-1 flex flex-col min-w-0">
          {/* Header */}
          <div className="flex items-center justify-between px-6 py-4 border-b border-[var(--color-border)] shrink-0">
            <h2 className="text-xl font-bold text-[var(--color-text-primary)]">Settings</h2>
            <button
              onClick={close}
              className="ml-4 p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] rounded-full shrink-0"
              aria-label="Close settings"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Body */}
          <div className="flex-1 overflow-y-auto">
            <TabPanel tabId={activeTab.id} activeTab={activeTab} />
          </div>
        </div>
      </div>

      {/* Fade-in animation */}
      <style jsx>{`
        @keyframes fadeIn {
          from { opacity: 0; transform: scale(0.95); }
          to { opacity: 1; transform: scale(1); }
        }
        div :global(.relative) {
          animation: fadeIn 200ms ease-out;
        }
      `}</style>
    </div>,
    document.body
  );
}
