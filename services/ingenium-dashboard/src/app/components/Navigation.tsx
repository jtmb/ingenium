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

function IconHeart() {
  return (
    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
      <path d="M14 6c0 4-6 7-6 7s-6-3-6-7a3.5 3.5 0 016-2.236A3.5 3.5 0 0114 6z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" />
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
      className={`transition-transform duration-200 ${open ? "" : "-rotate-90"}`}
    >
      <path d="M3 5l3 3 3-3" stroke="currentColor" strokeWidth="1.3" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

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
      { label: "OpenCode", href: "/opencode", icon: <IconTerminal /> },
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
      { label: "Pipeline", href: "/pipeline", icon: <IconGitBranch /> },
    ],
  },
  {
    id: "operations",
    label: "Operations",
    defaultOpen: true,
    items: [
      { label: "Jobs", href: "/jobs", icon: <IconClock /> },
      { label: "Logs", href: "/logs", icon: <IconList /> },
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
    ],
  },
];

// ---------------------------------------------------------------------------
// Collapse-state persistence via localStorage
//
// We store a `Record<groupId, boolean>` keyed by navigation group ID.
// On first load, defaults are merged with any saved state — saved keys
// override defaults, unknown keys are ignored. This ensures new groups
// added in future releases keep their `defaultOpen` behaviour without
// requiring a migration.
// ---------------------------------------------------------------------------

const STORAGE_KEY = "ingenium-nav-collapsed";

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

// ---------------------------------------------------------------------------
// Navigation Context — bridges the hamburger trigger (in the top bar) with
// the sidebar component via React context rather than prop-drilling.
// The mobile drawer close-on-route-change behaviour lives here because
// this context wraps both trigger and sidebar.
// ---------------------------------------------------------------------------

interface NavContextValue {
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
  toggleMobile: () => void;
}

const NavContext = createContext<NavContextValue | null>(null);

function useNavContext() {
  const ctx = useContext(NavContext);
  if (!ctx) throw new Error("Navigation compound components must be used within <NavigationProvider>");
  return ctx;
}

export function NavigationProvider({ children }: { children: ReactNode }) {
  const [mobileOpen, setMobileOpen] = useState(false);
  const pathname = usePathname();

  // Close mobile drawer on route change
  useEffect(() => {
    setMobileOpen(false);
  }, [pathname]);

  const toggleMobile = useCallback(() => setMobileOpen((prev) => !prev), []);

  return (
    <NavContext.Provider value={{ mobileOpen, setMobileOpen, toggleMobile }}>
      {children}
    </NavContext.Provider>
  );
}

// ---------------------------------------------------------------------------
// Exported sub-components
// ---------------------------------------------------------------------------

/** Hamburger button — place in the top bar. Renders only on mobile (< md). */
export function NavigationTrigger() {
  const { mobileOpen, toggleMobile } = useNavContext();
  return (
    <button
      type="button"
      onClick={toggleMobile}
      className="md:hidden p-2 -ml-2 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]"
      aria-label={mobileOpen ? "Close navigation menu" : "Open navigation menu"}
      aria-expanded={mobileOpen}
      aria-controls="nav-sidebar"
    >
      <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
        <path d="M3 6h14M3 10h14M3 14h14" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      </svg>
    </button>
  );
}

/** The main Navigation sidebar — both desktop sidebar and mobile drawer. */
export default function Navigation() {
  const { mobileOpen, setMobileOpen } = useNavContext();
  const pathname = usePathname();
  const sidebarRef = useRef<HTMLDivElement>(null);

  // Collapse state
  const defaultCollapsed: Record<string, boolean> = {};
  for (const g of NAV_GROUPS) {
    defaultCollapsed[g.id] = !g.defaultOpen;
  }
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>(defaultCollapsed);

  // Load persisted collapse state once on mount (defaultCollapsed is a local constant, not a dep)
  useEffect(() => {
    setCollapsed(loadCollapsedState(defaultCollapsed));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const toggleGroup = useCallback((id: string) => {
    setCollapsed((prev) => {
      const next = { ...prev, [id]: !prev[id] };
      saveCollapsedState(next);
      return next;
    });
  }, []);

  // Close mobile drawer on Escape
  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === "Escape" && mobileOpen) {
        setMobileOpen(false);
      }
    }
    document.addEventListener("keydown", onKeyDown);
    return () => document.removeEventListener("keydown", onKeyDown);
  }, [mobileOpen, setMobileOpen]);

  // Focus the first interactive element when mobile drawer opens
  useEffect(() => {
    if (mobileOpen && sidebarRef.current) {
      const first = sidebarRef.current.querySelector<HTMLElement>("a, button");
      first?.focus();
    }
  }, [mobileOpen]);

  // --- Helpers ---
  const activeItemClasses =
    "bg-[var(--color-surface-selected)] text-[var(--color-nav-text-active)] border-l-2 border-[var(--color-text-link)] font-medium";
  const inactiveItemClasses =
    "text-[var(--color-nav-text)] hover:bg-[var(--color-surface-hover)] hover:text-[var(--color-nav-text-hover)] border-l-2 border-transparent";
  const groupHeaderClasses =
    "flex w-full items-center justify-between px-3 py-2 text-xs font-semibold uppercase tracking-wider text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] rounded cursor-pointer focus-visible:outline-2 focus-visible:outline-offset-[-2px] focus-visible:outline-[var(--color-text-link)]";
  const itemLinkBaseClasses =
    "flex items-center gap-2.5 px-3 py-2 text-sm transition-colors";

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

  // --- Sidebar content (reused for both desktop sidebar and mobile drawer) ---
  const sidebarContent = (
    <>
      {/* Mobile-only: brand header with close button */}
      <div className="md:hidden flex items-center justify-between px-4 py-3 border-b border-[var(--color-nav-border)]">
        <span className="font-bold text-lg text-[var(--color-text-primary)]">Ingenium</span>
        <button
          onClick={() => setMobileOpen(false)}
          className="p-1 rounded hover:bg-[var(--color-surface-hover)] text-[var(--color-text-secondary)]"
          aria-label="Close navigation"
        >
          <svg width="20" height="20" viewBox="0 0 20 20" fill="none" aria-hidden="true">
            <path d="M5 5l10 10M15 5L5 15" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
          </svg>
        </button>
      </div>

      {/* HOME — always visible */}
      <div className="px-2 pt-3 pb-1">
        <Link
          href={HOME_ITEM.href}
          className={`${itemLinkBaseClasses} rounded ${
            isActive(HOME_ITEM.href) ? activeItemClasses : inactiveItemClasses
          }`}
        >
          <span className="shrink-0 w-4 h-4 flex items-center justify-center text-[var(--color-text-secondary)]">
            {HOME_ITEM.icon}
          </span>
          <span className="truncate">Home</span>
        </Link>
      </div>

      <div className="mx-3 my-1 border-t border-[var(--color-nav-border)]" />

      {/* Collapsible groups */}
      <nav className="px-2 py-1 space-y-0.5" aria-label="Main navigation">
        {NAV_GROUPS.map((group) => {
          const isOpen = !collapsed[group.id];
          return (
            <div key={group.id}>
              <button
                type="button"
                className={groupHeaderClasses}
                onClick={() => toggleGroup(group.id)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" || e.key === " ") {
                    e.preventDefault();
                    toggleGroup(group.id);
                  }
                }}
                aria-expanded={isOpen}
                aria-controls={`nav-group-${group.id}`}
              >
                <span>{group.label}</span>
                <ChevronDown open={isOpen} />
              </button>

              <ul
                id={`nav-group-${group.id}`}
                role="region"
                aria-label={group.label}
                className={`overflow-hidden transition-[max-height,opacity] duration-200 ease-in-out ${
                  isOpen ? "max-h-96 opacity-100" : "max-h-0 opacity-0"
                }`}
              >
                {group.items.map((item) => (
                  <li key={item.href}>
                    <Link
                      href={item.href}
                      className={`${itemLinkBaseClasses} rounded ${
                        isActive(item.href) ? activeItemClasses : inactiveItemClasses
                      }`}
                      {...(item.badge ? { "aria-describedby": `badge-${group.id}-${item.label}` } : {})}
                    >
                      <span className="shrink-0 w-4 h-4 flex items-center justify-center text-[var(--color-text-secondary)]">
                        {item.icon}
                      </span>
                      <span className="truncate flex-1">{item.label}</span>
                      {item.badge && (
                        <span
                          id={`badge-${group.id}-${item.label}`}
                          className="shrink-0 text-[10px] leading-none px-1.5 py-0.5 rounded-full bg-[var(--color-warning-bg)] text-[var(--color-warning-text)]"
                        >
                          {item.badge}
                        </span>
                      )}
                    </Link>
                  </li>
                ))}
              </ul>
            </div>
          );
        })}
      </nav>
    </>
  );

  return (
    <>
      {/* ---- Desktop sidebar (always visible on md+) ---- */}
      <aside
        id="nav-sidebar"
        className="
          hidden md:flex md:flex-col
          w-56 shrink-0
          border-r border-[var(--color-nav-border)]
          bg-[var(--color-nav-bg)]
          overflow-y-auto
        "
      >
        {sidebarContent}
      </aside>

      {/* ---- Mobile drawer overlay ---- */}
      <div
        className={`md:hidden fixed inset-0 z-40 transition-opacity duration-200 ${
          mobileOpen ? "opacity-100 pointer-events-auto" : "opacity-0 pointer-events-none"
        }`}
        aria-hidden={!mobileOpen}
      >
        {/* Backdrop */}
        <div
          className="absolute inset-0 bg-black/50"
          onClick={() => setMobileOpen(false)}
        />

        {/* Slide-out panel */}
        <div
          ref={sidebarRef}
          className={`
            absolute top-0 left-0 bottom-0
            w-64 max-w-[85vw]
            bg-[var(--color-nav-bg)]
            border-r border-[var(--color-nav-border)]
            overflow-y-auto
            transition-transform duration-200 ease-in-out
            ${mobileOpen ? "translate-x-0" : "-translate-x-full"}
          `}
          role="dialog"
          aria-modal="true"
          aria-label="Navigation"
        >
          {sidebarContent}
        </div>
      </div>
    </>
  );
}
