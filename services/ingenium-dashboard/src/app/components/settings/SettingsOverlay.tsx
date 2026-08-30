"use client";

import { Suspense, useEffect, useCallback, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { ALL_TABS, tabForPathname } from "./tabs";
import type { SettingsTab, SettingsTabId } from "./tabs";
import SettingsSidebar from "./SettingsSidebar";
import Select from "../Select";
import GeneralPanel from "./panels/GeneralPanel";
import MailPanel from "./panels/MailPanel";
import PipelinePanel from "./panels/PipelinePanel";
import ConfigPanel from "./panels/ConfigPanel";
import type { ComponentType } from "react";
import RouteLinkedPanel from "./RouteLinkedPanel";
import PanelErrorBoundary from "./PanelErrorBoundary";

/**
 * A settings section rendered in the overlay as a link to its dedicated
 * management workspace. The destination owns all API access and mutations.
 */
interface RouteLinkedPanelDefinition {
  destination: string;
  description: string;
}

type SettingsPanelDefinition = ComponentType | RouteLinkedPanelDefinition;

/**
 * Registry mapping every declared Settings tab to a functional panel.
 *
 * The four compact settings forms live directly in the overlay. The remaining
 * categories deliberately link to their existing full dashboard workspaces so
 * the established API authorization, mutation flows, and responsive views are
 * reused rather than reimplemented in a modal.
 */
const TAB_PANELS: Record<SettingsTabId, SettingsPanelDefinition> = {
  general: GeneralPanel,
  account: { destination: "/account", description: "Manage your account profile and password." },
  security: { destination: "/account#security", description: "Manage authenticator and recovery protection." },
  sessions: { destination: "/account#sessions", description: "Review and revoke browser sessions and devices." },
  "api-tokens": { destination: "/account#api-tokens", description: "Create and revoke scoped API tokens." },
  organizations: { destination: "/organizations", description: "Manage organization members, invitations, roles, and project access." },
  projects: {
    destination: "/projects",
    description: "Create, switch, archive, restore, and purge projects in the Projects workspace.",
  },
  skills: {
    destination: "/skills",
    description: "Manage skills, governance proposals, versions, and synchronization in the Skills workspace.",
  },
  tasks: {
    destination: "/tasks",
    description: "Create, prioritize, and track work on the Tasks board.",
  },
  jobs: {
    destination: "/jobs",
    description: "Create scheduled jobs, inspect runs, and review execution logs in the Jobs workspace.",
  },
  plugins: {
    destination: "/plugins",
    description: "Create, edit, enable, and disable OpenCode plugins in the Plugins workspace.",
  },
  mail: MailPanel,
  agents: {
    destination: "/agents",
    description: "Manage agent profiles, categories, content, and availability in the Agents workspace.",
  },
  "mcp-servers": {
    destination: "/mcp-servers",
    description: "Manage MCP servers and the enabled tool catalog in the MCP workspace.",
  },
  observations: {
    destination: "/observations",
    description: "Browse and filter the observations collected by the self-learning pipeline.",
  },
  personality: {
    destination: "/personality",
    description: "Review and manage learned personality traits in the Personality workspace.",
  },
  providers: PipelinePanel,
  config: ConfigPanel,
  logs: {
    destination: "/logs",
    description: "Inspect the live system log stream, filters, and diagnostics in the Logs workspace.",
  },
};

function isRouteLinkedPanel(
  panel: SettingsPanelDefinition,
): panel is RouteLinkedPanelDefinition {
  return typeof panel === "object";
}

function pathWithSearchAndHash(pathname: string, params: URLSearchParams): string {
  const query = params.toString();
  const hash = typeof window === "undefined" ? "" : window.location.hash;
  return `${pathname}${query ? `?${query}` : ""}${hash}`;
}

/** Resolves every supported tab ID to its concrete or route-linked panel. */
function TabPanel({ tab }: { tab: SettingsTab }) {
  const panel = TAB_PANELS[tab.id];
  if (isRouteLinkedPanel(panel)) {
    return (
      <section aria-label={`${tab.label} settings panel`} data-testid={`settings-panel-${tab.id}`}>
        <RouteLinkedPanel tab={tab} {...panel} />
      </section>
    );
  }

  const Panel = panel;

  return (
    <section aria-label={`${tab.label} settings panel`} data-testid={`settings-panel-${tab.id}`}>
      <Panel />
    </section>
  );
}

function PanelLoading({ tab }: { tab: SettingsTab }) {
  return (
    <div
      className="px-6 py-10 text-center text-sm text-[var(--color-text-muted)] animate-pulse"
      data-testid="settings-panel-loading"
    >
      Loading {tab.label} settings...
    </div>
  );
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

  const currentTabId = settingsParam && ALL_TABS.some((t) => t.id === settingsParam)
    ? settingsParam
    : ALL_TABS.some((t) => t.id === tabForPathname(pathname))
      ? tabForPathname(pathname)
      : ALL_TABS[0]?.id ?? "general";

  const activeTab: SettingsTab = ALL_TABS.find((t) => t.id === currentTabId) ?? ALL_TABS[0]!;

  const closeBtnRef = useRef<HTMLButtonElement>(null);
  const previousFocus = useRef<HTMLElement | null>(null);

  const close = useCallback(() => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("settings");
    router.replace(pathWithSearchAndHash(pathname, params), { scroll: false });
  }, [pathname, router, searchParams]);

  const selectTab = useCallback((id: string) => {
    const params = new URLSearchParams(searchParams.toString());
    params.set("settings", id);
    router.replace(pathWithSearchAndHash(pathname, params), { scroll: false });
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
          tabs={ALL_TABS}
          activeTab={currentTabId}
          onSelect={selectTab}
        />

        <div className="flex min-h-0 min-w-0 flex-1 flex-col">
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
          <Select
            wrapperClassName="md:hidden mx-6 mt-3"
            value={activeTab.id}
            onChange={(e) => selectTab(e.target.value)}
            className="border border-[var(--color-border)] rounded px-3 py-1.5 text-sm bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
            aria-label="Settings category"
          >
            {ALL_TABS.map(tab => (
              <option key={tab.id} value={tab.id}>{tab.label}</option>
            ))}
          </Select>

          <div data-testid="settings-panel-scroll" className="min-h-0 flex-1 overflow-y-auto overscroll-contain">
            {/* Mount only the active panel. Inactive settings must not start
                API requests or OpenCode provider discovery in the background. */}
            <Suspense fallback={<PanelLoading tab={activeTab} />}>
              <PanelErrorBoundary key={activeTab.id} panelId={activeTab.id}>
                <TabPanel tab={activeTab} />
              </PanelErrorBoundary>
            </Suspense>
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
