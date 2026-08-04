"use client";

import {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
  type ReactNode,
} from "react";
import { usePathname } from "next/navigation";
import Link from "next/link";
import EdgeDrawer from "./EdgeDrawer";

// ---------------------------------------------------------------------------
// Inline SVG icon components (16×16 viewBox)
//
// Chosen over emoji or icon libraries for:
// - Consistent rendering across OS/browser (emoji vary wildly)
// - Zero bundle-size overhead from icon libraries (lucide, heroicons, etc.)
// - Full control over stroke width, colours, and animation
// - All icons are `aria-hidden="true"` since they're decorative alongside text labels
// ---------------------------------------------------------------------------

function IconHome() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 6l6-4.667L14 6v7.333a.667.667 0 01-.667.667H10V9.333H6V14H2.667A.667.667 0 012 13.333V6z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconTerminal() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 4l3 3-3 3M8 11h5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <rect x="1" y="2" width="14" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function IconCode() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M5.5 4L2.5 8l3 4M10.5 12l3-4-3-4M7 13l2-10" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconMail() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="3" width="13" height="10" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M1.5 4l6.5 4.5L14.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconCheckSquare() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="2" width="12" height="12" rx="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M5 8l2 2 4-4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconFile() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 2h6l4 4v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9 2v4h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconPuzzle() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M9 2h3a1 1 0 011 1v2a1 1 0 01-1 1h-1v1a2 2 0 11-4 0V6H6a1 1 0 01-1-1V3a1 1 0 011-1h3z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 8h1a1 1 0 011 1v1h1a1 1 0 011 1v2a1 1 0 01-1 1h-3v-1a2 2 0 10-4 0v1H3a1 1 0 01-1-1v-2a1 1 0 011-1h1v-1a1 1 0 011-1h1" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconBot() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="2" y="4" width="12" height="9" rx="2" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="5.5" cy="8" r="0.75" fill="currentColor" />
      <circle cx="10.5" cy="8" r="0.75" fill="currentColor" />
      <path d="M6 11h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M5 4V2.5M11 4V2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function IconEye() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M1 8s2.5-5 7-5 7 5 7 5-2.5 5-7 5-7-5-7-5z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="8" cy="8" r="2" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function IconUser() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="5" r="2.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M3 14c0-2.761 2.239-5 5-5s5 2.239 5 5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function IconGitBranch() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="4" cy="4" r="1.5" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="4" cy="12" r="1.5" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="12" cy="8" r="1.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M4 5.5V10.5M6.5 8l4 0" stroke="currentColor" strokeWidth="1.2" />
    </svg>
  );
}

function IconHistory() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 7.5a5 5 0 109.25-2.65M3 3.5v4h4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M8 5v3l2 1.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconClock() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="6" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 5v3.5l2 2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconList() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 4h12M2 8h12M2 12h8" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
    </svg>
  );
}

function IconSave() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M3 2h7l3 3v8a1 1 0 01-1 1H4a1 1 0 01-1-1V3a1 1 0 011-1z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M10 2v4H5V2M5 8h6v5H5zM7 10h2" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconHeart() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M14 6c0 4-6 7-6 7s-6-3-6-7a3.5 3.5 0 016-2.236A3.5 3.5 0 0114 6z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
    </svg>
  );
}

function IconUsage() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 13.5V2.5M2 13.5h12" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M4 10l2.4-2.5 2.2 1.6L12.5 4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="4" cy="10" r=".8" fill="currentColor" />
      <circle cx="6.4" cy="7.5" r=".8" fill="currentColor" />
      <circle cx="8.6" cy="9.1" r=".8" fill="currentColor" />
      <circle cx="12.5" cy="4" r=".8" fill="currentColor" />
    </svg>
  );
}

function IconMessageSquare() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 3a1 1 0 011-1h10a1 1 0 011 1v7a1 1 0 01-1 1H5l-3 3V3z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconFolder() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M2 4a1 1 0 011-1h3l1.5 2H13a1 1 0 011 1v6a1 1 0 01-1 1H3a1 1 0 01-1-1V4z" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

function IconPlug() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M6 2v4M10 2v4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
      <path d="M5 6h6l-1 5.5a1 1 0 01-1 .5H7a1 1 0 01-1-.5L5 6z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
      <path d="M4 6h8" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function IconServer() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <rect x="1.5" y="1.5" width="13" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <rect x="1.5" y="9.5" width="13" height="5" rx="1" stroke="currentColor" strokeWidth="1.2" />
      <circle cx="5" cy="4" r="0.75" fill="currentColor" />
      <circle cx="5" cy="12" r="0.75" fill="currentColor" />
    </svg>
  );
}

function IconKey() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M11 5a3 3 0 11-6 0 3 3 0 016 0z" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 8v4.5M5.5 10l2.5 2.5M10.5 10L8 12.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" strokeLinejoin="round" />
      <circle cx="8" cy="5" r="1" fill="currentColor" />
    </svg>
  );
}

function IconGear() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <circle cx="8" cy="8" r="2.5" stroke="currentColor" strokeWidth="1.2" />
      <path d="M8 1.5v2M8 12.5v2M1.5 8h2M12.5 8h2M3.4 3.4l1.4 1.4M11.2 11.2l1.4 1.4M3.4 12.6l1.4-1.4M11.2 4.8l1.4-1.4" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  );
}

function ChevronDown({ open }: { open: boolean }) {
  return (
    <svg
      width="12"
      height="12"
      viewBox="0 0 12 12"
      fill="none"
      aria-hidden="true"
      className={`transition-transform duration-200 motion-reduce:transition-none ${open ? "" : "-rotate-90"}`}
    >
      <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

interface NavItem {
  label: string;
  href: string;
  icon: ReactNode;
  badge?: string;
}

interface NavGroup {
  id: string;
  label: string;
  defaultOpen: boolean;
  items: NavItem[];
}

const HOME_ITEM: NavItem = {
  label: "Home",
  href: "/",
  icon: <IconHome />,
};

const NAV_GROUPS: NavGroup[] = [
  {
    id: "workspace",
    label: "Workspace",
    defaultOpen: true,
    items: [
      { label: "Chat", href: "/chat", icon: <IconMessageSquare /> },
      { label: "OpenCode", href: "/opencode", icon: <IconTerminal /> },
      { label: "VS Code", href: "/vscode", icon: <IconCode /> },
      { label: "Mail", href: "/mail", icon: <IconMail /> },
      { label: "Tasks", href: "/tasks", icon: <IconCheckSquare /> },
      { label: "Docs", href: "/docs", icon: <IconFile /> },
    ],
  },
  {
    id: "intelligence",
    label: "Intelligence",
    defaultOpen: true,
    items: [
      { label: "Skills", href: "/skills", icon: <IconPuzzle /> },
      { label: "Agents", href: "/agents", icon: <IconBot /> },
      { label: "Observations", href: "/observations", icon: <IconEye /> },
      { label: "Personality", href: "/personality", icon: <IconUser /> },
      { label: "Context", href: "/context", icon: <IconHistory /> },
      { label: "Pipeline", href: "/pipeline", icon: <IconGitBranch /> },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    defaultOpen: true,
    items: [
      { label: "Jobs", href: "/jobs", icon: <IconClock /> },
      { label: "Backups", href: "/backups", icon: <IconSave /> },
      { label: "Logs", href: "/logs", icon: <IconList /> },
      { label: "Usage", href: "/usage", icon: <IconUsage /> },
      { label: "Status", href: "/status", icon: <IconHeart /> },
    ],
  },
  {
    id: "configure",
    label: "Configure",
    defaultOpen: true,
    items: [
      { label: "Projects", href: "/projects", icon: <IconFolder /> },
      { label: "Plugins", href: "/plugins", icon: <IconPlug /> },
      { label: "MCP Servers", href: "/mcp-servers", icon: <IconServer /> },
      { label: "Config", href: "/config", icon: <IconGear /> },
      { label: "Secrets", href: "/secrets", icon: <IconKey /> },
    ],
  },
];

// We store a `Record<groupId, boolean>` keyed by navigation group ID.
// On first load, defaults are merged with any saved state — saved keys
// override defaults, unknown keys are ignored. This ensures new groups
// added in future releases keep their `defaultOpen` behaviour without
// requiring a migration.

const STORAGE_KEY = "ingenium-nav-collapsed";
const COMPACT_STORAGE_KEY = "ingenium-nav-compact";
const COMPACT_DATA_ATTRIBUTE = "data-nav-compact";
const DESKTOP_NAV_ID = "nav-sidebar";
const MOBILE_DIALOG_ID = "mobile-navigation-dialog";
const FOCUSABLE_SELECTOR = "a[href], button:not([disabled]), [tabindex]:not([tabindex='-1'])";

function getFocusableElements(container: HTMLElement): HTMLElement[] {
  return Array.from(container.querySelectorAll<HTMLElement>(FOCUSABLE_SELECTOR)).filter(
    (element) => !element.hasAttribute("disabled") && !element.closest("[inert], [aria-hidden='true']"),
  );
}

function loadCollapsedState(defaults: Record<string, boolean>): Record<string, boolean> {
  if (typeof window === "undefined") return { ...defaults };
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Record<string, boolean>;
      const merged = { ...defaults };
      for (const key of Object.keys(merged)) {
        if (typeof parsed[key] === "boolean") merged[key] = parsed[key];
      }
      return merged;
    }
  } catch {
    // ignore corrupt data
  }
  return { ...defaults };
}

function saveCollapsedState(state: Record<string, boolean>) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
  } catch {
    // ignore quota errors
  }
}

function loadDesktopCompact(): boolean {
  if (typeof window === "undefined") return false;
  try {
    return localStorage.getItem(COMPACT_STORAGE_KEY) === "true";
  } catch {
    return false;
  }
}

function setRootDesktopCompact(compact: boolean) {
  if (typeof document === "undefined") return;
  document.documentElement.setAttribute(COMPACT_DATA_ATTRIBUTE, String(compact));
}

function readPrepaintDesktopCompact(): boolean {
  if (typeof document === "undefined") return false;
  const value = document.documentElement.getAttribute(COMPACT_DATA_ATTRIBUTE);
  if (value === "true") return true;
  if (value === "false") return false;
  return loadDesktopCompact();
}

function saveDesktopCompact(compact: boolean) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(COMPACT_STORAGE_KEY, String(compact));
  } catch {
    // Keep the current-session preference when storage is unavailable.
  }
}

// Navigation Context — bridges the hamburger trigger (in the top bar) with
// the sidebar component via React context rather than prop-drilling.
// The mobile drawer close-on-route-change behaviour lives here because
// this context wraps both trigger and sidebar.

interface NavContextValue {
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
  toggleMobile: () => void;
  closeMobile: (restoreFocus?: boolean) => void;
  mobileTriggerRef: React.RefObject<HTMLButtonElement | null>;
  mobileCloseRestoresFocus: boolean;
  desktopCompact: boolean;
  toggleDesktopCompact: () => void;
}

const NavContext = createContext<NavContextValue | null>(null);

function useNavContext() {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error("Navigation compound components must be used within <NavigationProvider>");
  return ctx;
}

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  // Start full on both SSR and the first client render. The prepaint script
  // owns the initial visual state; this effect adopts it after hydration.
  const [desktopCompact, setDesktopCompact] = useState(false);
  const pathname = usePathname();
  const mobileTriggerRef = useRef<HTMLButtonElement>(null);
  const previousPathnameRef = useRef(pathname);
  const [mobileCloseRestoresFocus, setMobileCloseRestoresFocus] = useState(false);

  useEffect(() => {
    const compact = readPrepaintDesktopCompact();
    queueMicrotask(() => {
      setDesktopCompact(compact);
      setRootDesktopCompact(compact);
    });
  }, []);

  const closeMobile = useCallback((restoreFocus = true) => {
    setMobileCloseRestoresFocus(restoreFocus);
    setMobileOpen(false);
  }, []);

  useEffect(() => {
    if (previousPathnameRef.current === pathname) return;
    previousPathnameRef.current = pathname;
    queueMicrotask(() => closeMobile(false));
  }, [closeMobile, pathname]);

  useEffect(() => {
    if (!mobileOpen || typeof window.matchMedia !== "function") return;

    const desktopMedia = window.matchMedia("(min-width: 768px)");
    const closeAtDesktopBreakpoint = () => {
      if (desktopMedia.matches) closeMobile(false);
    };

    desktopMedia.addEventListener("change", closeAtDesktopBreakpoint);
    closeAtDesktopBreakpoint();
    return () => desktopMedia.removeEventListener("change", closeAtDesktopBreakpoint);
  }, [closeMobile, mobileOpen]);

  const toggleMobile = useCallback(() => {
    setMobileCloseRestoresFocus(mobileOpen);
    setMobileOpen(!mobileOpen);
  }, [mobileOpen]);

  const toggleDesktopCompact = useCallback(() => {
    const next = !desktopCompact;
    saveDesktopCompact(next);
    setRootDesktopCompact(next);
    setDesktopCompact(next);
  }, [desktopCompact]);

  return (
    <NavContext.Provider value={{
      mobileOpen,
      setMobileOpen,
      toggleMobile,
      closeMobile,
      mobileTriggerRef,
      mobileCloseRestoresFocus,
      desktopCompact,
      toggleDesktopCompact,
    }}>
      {children}
    </NavContext.Provider>
  );
}

/** The breakpoint-specific navigation control placed immediately before the logo. */
export function NavigationTrigger() {
  const {
    mobileOpen,
    toggleMobile,
    mobileTriggerRef,
    desktopCompact,
    toggleDesktopCompact,
  } = useNavContext();
  const triggerClasses = "items-center justify-center p-2 -ml-2 rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-text-link)]";

  return (
    <>
      <button
        type="button"
        onClick={toggleDesktopCompact}
        className={`hidden md:inline-flex ${triggerClasses}`}
        aria-label={desktopCompact ? "Expand navigation" : "Collapse navigation"}
        aria-expanded={!desktopCompact}
        aria-controls={DESKTOP_NAV_ID}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
      <button
        ref={mobileTriggerRef}
        type="button"
        onClick={toggleMobile}
        className={`inline-flex md:hidden ${triggerClasses}`}
        aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
        aria-expanded={mobileOpen}
        aria-controls={MOBILE_DIALOG_ID}
      >
        <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
          <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </button>
    </>
  );
}

/** The main Navigation sidebar — both desktop sidebar and mobile drawer. */
export default function Navigation() {
  const {
    mobileOpen,
    closeMobile,
    desktopCompact,
    mobileTriggerRef,
    mobileCloseRestoresFocus,
  } = useNavContext();
  const pathname = usePathname();
  const sidebarRef = useRef<HTMLDivElement>(null);
  const wasMobileOpenRef = useRef(false);

  const defaultCollapsed: Record<string, boolean> = {};
  for (const g of NAV_GROUPS) {
    defaultCollapsed[g.id] = !g.defaultOpen;
  }
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(defaultCollapsed);

  useEffect(() => {
    queueMicrotask(() => setCollapsed(loadCollapsedState(defaultCollapsed)));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleGroup = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      saveCollapsedState(next);
      return next;
    });
  }, []);

  useEffect(() => {
    if (!mobileOpen) {
      if (wasMobileOpenRef.current) {
        wasMobileOpenRef.current = false;
        if (mobileCloseRestoresFocus && mobileTriggerRef.current && document.activeElement !== mobileTriggerRef.current) {
          mobileTriggerRef.current.focus();
        }
      }
      return;
    }

    wasMobileOpenRef.current = true;
    const previousOverflow = document.body.style.overflow;
    const backgroundState = Array.from(document.querySelectorAll<HTMLElement>("[data-nav-background]")).map((element) => ({
      element,
      inert: element.inert,
      ariaHidden: element.getAttribute("aria-hidden"),
    }));
    document.body.style.overflow = "hidden";
    for (const { element } of backgroundState) {
      element.inert = true;
      element.setAttribute("aria-hidden", "true");
    }

    const focusDrawer = () => {
      const drawer = sidebarRef.current;
      const first = drawer?.querySelector<HTMLElement>("[data-nav-initial-focus]") ?? (drawer ? getFocusableElements(drawer)[0] : undefined);
      first?.focus();
    };
    const onDocumentFocusIn = (event: FocusEvent) => {
      const drawer = sidebarRef.current;
      if (drawer && event.target instanceof Node && !drawer.contains(event.target)) focusDrawer();
    };
    document.addEventListener("focusin", onDocumentFocusIn);
    focusDrawer();
    const initialFocusFrame = window.requestAnimationFrame(focusDrawer);

    return () => {
      window.cancelAnimationFrame(initialFocusFrame);
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("focusin", onDocumentFocusIn);
      for (const state of backgroundState) {
        state.element.inert = state.inert;
        if (state.ariaHidden === null) state.element.removeAttribute("aria-hidden");
        else state.element.setAttribute("aria-hidden", state.ariaHidden);
      }
    };
  }, [mobileCloseRestoresFocus, mobileOpen, mobileTriggerRef]);

  const activeItemClasses =
    "bg-[var(--color-surface-selected)] text-[var(--color-nav-text-active)] border-l-2 border-[var(--color-text-link)] font-medium";
  const inactiveItemClasses =
    "text-[var(--color-nav-text)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-nav-text-hover)] border-l-2 border-transparent";
  const groupHeaderClasses =
    "flex w-full items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] rounded cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-text-link)]";

  /**
   * Determine if a nav link matches the current route.
   *
   * Exact match for `/` (to avoid matching every route), prefix match
   * for all other links (e.g. `/skills` matches `/skills/foo`).
   * The `href + "/"` suffix prevents false positives like `/skills`
   * matching `/skills-archive`.
   */
  function isActive(href: string): boolean {
    if (href === "/") return pathname === "/";
    return pathname === href || pathname.startsWith(href + "/");
  }

  const renderSidebarContent = (mode: "desktop" | "mobile", compact: boolean) => {
    const itemLinkBaseClasses = mode === "desktop"
      ? "flex items-center py-2 text-sm transition-colors motion-reduce:transition-none desktop-nav-item gap-2.5 px-3"
      : `flex items-center py-2 text-sm transition-colors motion-reduce:transition-none ${
          compact ? "justify-center gap-0 px-0" : "gap-2.5 px-3"
        }`;
    const contentPrefix = mode === "desktop" ? "desktop" : "mobile";
    const mobileLinkCloseProps = (href: string) =>
      mode === "mobile" ? { onClick: () => closeMobile(pathname === href) } : {};

    return (
      <>
        {mode === "mobile" && (
          <div className="flex items-center justify-between px-4 py-3 border-b border-[var(--color-nav-border)]">
            <span id="mobile-navigation-title" className="font-bold text-lg text-[var(--color-text-primary)]">Ingenium</span>
            <button
              type="button"
              data-nav-initial-focus
              onClick={() => closeMobile()}
              className="p-1 rounded text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-text-link)]"
              aria-label="Close navigation"
            >
              <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
                <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
              </svg>
            </button>
          </div>
        )}

        <div className="nav-home px-2 pt-3 pb-1">
          <Link
            href={HOME_ITEM.href}
            prefetch={false}
            className={`${itemLinkBaseClasses} nav-item-link rounded ${
              isActive(HOME_ITEM.href) ? activeItemClasses : inactiveItemClasses
            }`}
            {...mobileLinkCloseProps(HOME_ITEM.href)}
            {...(compact ? { "aria-label": HOME_ITEM.label, title: HOME_ITEM.label } : {})}
          >
            <span className="shrink-0 w-4 h-4 flex items-center justify-center text-[var(--color-text-secondary)]">
              {HOME_ITEM.icon}
            </span>
            <span className={`nav-label ${mode === "desktop" || !compact ? "truncate" : "sr-only"}`}>Home</span>
          </Link>
        </div>

        <div className="nav-divider mx-3 my-1 border-t border-[var(--color-nav-border)]" />

        <nav className="px-2 py-1 space-y-0.5" aria-label={`${mode === "desktop" ? "Desktop" : "Mobile"} navigation`}>
          {NAV_GROUPS.map((group) => {
            const isOpen = !collapsed[group.id];
            const groupId = `${contentPrefix}-nav-group-${group.id}`;
            return (
              <div key={group.id}>
                <button
                  type="button"
                  className={`${groupHeaderClasses} nav-group-control ${mode === "desktop" ? "desktop-nav-group-control" : compact ? "justify-center px-0" : ""}`}
                  onClick={() => toggleGroup(group.id)}
                  aria-expanded={isOpen}
                  aria-controls={groupId}
                  {...(compact ? { "aria-label": `${group.label} navigation group`, title: group.label } : {})}
                >
                  <span className={`nav-label ${mode === "desktop" || !compact ? "" : "sr-only"}`}>{group.label}</span>
                  <ChevronDown open={isOpen} />
                </button>

                <ul
                  id={groupId}
                  role="region"
                  aria-label={group.label}
                  aria-hidden={!isOpen}
                  inert={!isOpen}
                  className={`nav-group-items overflow-hidden transition-[max-height,opacity] duration-200 ease-in-out motion-reduce:transition-none ${
                    isOpen ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
                  }`}
                >
                  {group.items.map((item) => {
                    const badgeId = `${contentPrefix}-nav-badge-${group.id}-${item.label}`;
                    return (
                      <li key={item.href}>
                        <Link
                          href={item.href}
                          prefetch={false}
                          className={`${itemLinkBaseClasses} nav-item-link rounded ${
                            isActive(item.href) ? activeItemClasses : inactiveItemClasses
                          }`}
                          {...mobileLinkCloseProps(item.href)}
                          {...(compact ? { "aria-label": item.label, title: item.label } : {})}
                          {...(item.badge ? { "aria-describedby": badgeId } : {})}
                        >
                          <span className="shrink-0 w-4 h-4 flex items-center justify-center text-[var(--color-text-secondary)]">
                            {item.icon}
                          </span>
                          <span className={`nav-label flex-1 ${mode === "desktop" || !compact ? "truncate" : "sr-only"}`}>{item.label}</span>
                          {item.badge && (
                            <span
                              id={badgeId}
                              className={`nav-badge shrink-0 text-[10px] leading-none px-1.5 py-0.5 rounded-full bg-[var(--color-warning-bg)] text-[var(--color-warning-text)] ${mode === "desktop" || !compact ? "" : "sr-only"}`}
                            >
                              {item.badge}
                            </span>
                          )}
                        </Link>
                      </li>
                    );
                  })}
                </ul>
              </div>
            );
          })}
        </nav>
      </>
    );
  };

  const trapDrawerTab = (event: React.KeyboardEvent<HTMLDivElement>) => {
    if (event.key === "Escape") {
      event.preventDefault();
      closeMobile();
      return;
    }
    if (event.key !== "Tab" || !sidebarRef.current) return;

    const focusable = getFocusableElements(sidebarRef.current);
    if (focusable.length === 0) return;

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!first || !last) return;
    if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  };

  return (
    <>
      <aside
        id={DESKTOP_NAV_ID}
        data-nav-mode="desktop"
        className={`desktop-navigation relative hidden md:flex md:flex-col ${desktopCompact ? "w-14" : "w-56"} shrink-0
           border-r border-[var(--color-nav-border)]
           bg-[var(--color-nav-bg)]
           nav-scroll-area
           overflow-y-auto
           transition-[width] motion-reduce:transition-none`}
        data-nav-compact={desktopCompact}
      >
        {renderSidebarContent("desktop", desktopCompact)}
      </aside>

      <EdgeDrawer
        open={mobileOpen}
        side="left"
        className="md:hidden fixed inset-0 z-40"
        outerProps={{ "data-nav-mode": "mobile" }}
        panelRef={sidebarRef}
        panelClassName="mobile-navigation-drawer absolute top-0 left-0 bottom-0 flex w-64 max-w-[85vw] flex-col bg-[var(--color-nav-bg)] border-r border-[var(--color-nav-border)] nav-scroll-area overflow-y-auto"
        panelProps={{
          id: MOBILE_DIALOG_ID,
          role: "dialog",
          "aria-modal": "true",
          "aria-labelledby": "mobile-navigation-title",
          onKeyDown: trapDrawerTab,
        }}
        onBackdropClick={() => closeMobile()}
      >
        {renderSidebarContent("mobile", false)}
      </EdgeDrawer>
    </>
  );
}
