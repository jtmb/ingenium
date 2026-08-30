import { existsSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { getTestRunDashboardWorkspace, readTestRunManifest, TEST_RUN_MANIFEST_ENV } from "../test-run-context";

/**
 * Route inventory for the production dashboard smoke suite.
 *
 * The navigation source and settings panel registry are the canonical inputs;
 * the `.next` manifests are the production-artifact contract. Keeping the
 * inventory here means a new navigation link is automatically added to the
 * smoke matrix instead of being silently omitted from it.
 */

function findRepositoryRoot(): string {
  let candidate = resolve(process.cwd());
  while (true) {
    if (
      existsSync(join(candidate, "AGENTS.md"))
      && existsSync(join(candidate, "services", "ingenium-dashboard"))
    ) {
      return candidate;
    }
    const parent = dirname(candidate);
    if (parent === candidate) break;
    candidate = parent;
  }
  throw new Error(`Could not locate the Ingenium repository root from ${process.cwd()}`);
}

const REPOSITORY_ROOT = findRepositoryRoot();
const NAVIGATION_SOURCE = join(
  REPOSITORY_ROOT,
  "services",
  "ingenium-dashboard",
  "src",
  "app",
  "components",
  "Navigation.tsx",
);
/** These are retired dashboard page segments, not valid primary routes. */
export const RETIRED_DASHBOARD_ROUTE_SEGMENTS = [
  "archive",
  "servers",
  "learnings",
] as const;

export interface ProductionArtifactRoutes {
  directory: string;
  buildId: string;
  routes: ReadonlySet<string>;
}

export interface QueryVariant {
  name: string;
  path: string;
  query: Readonly<Record<string, string>>;
}

export interface SettingsDeepLinkRouteIdentity {
  testId: string;
  destination: string;
}

export interface SettingsDeepLink {
  id: string;
  label: string;
  panelTestId: string;
  routeLink?: SettingsDeepLinkRouteIdentity;
}

export interface RouteInventory {
  canonicalNavigationRoutes: readonly string[];
  settingsDeepLinks: readonly SettingsDeepLink[];
  supportedSettingsTabs: readonly string[];
  queryVariants: readonly QueryVariant[];
  compatibilityRoutes: readonly string[];
}

export interface PageSpecificQueryVariantData {
  /** A real space ID when one is available, otherwise a harmless numeric sentinel. */
  docsSpaceId: string;
  /** A real page ID when one is available, otherwise a harmless numeric sentinel. */
  docsPageId: string;
  /** A discovered account ID, or a non-existent value when mail is unconfigured. */
  mailAccount: string;
}

interface RouteManifestEntry {
  page?: unknown;
}

/**
 * Explicit settings deep-link contract.
 *
 * This is intentionally not scraped from `TAB_PANELS`. That registry contains
 * nested route-link metadata (`destination` and `description`) which is not a
 * settings ID. Keeping the expected panel and route-link identity together
 * also lets the browser suite verify what each ID actually selects.
 */
export const CANONICAL_SETTINGS_DEEP_LINKS = [
  { id: "general", label: "General", panelTestId: "settings-panel-general" },
  {
    id: "projects",
    label: "Projects",
    panelTestId: "settings-panel-projects",
    routeLink: { testId: "settings-route-link-projects", destination: "/projects" },
  },
  {
    id: "skills",
    label: "Skills",
    panelTestId: "settings-panel-skills",
    routeLink: { testId: "settings-route-link-skills", destination: "/skills" },
  },
  {
    id: "tasks",
    label: "Tasks",
    panelTestId: "settings-panel-tasks",
    routeLink: { testId: "settings-route-link-tasks", destination: "/tasks" },
  },
  {
    id: "jobs",
    label: "Jobs",
    panelTestId: "settings-panel-jobs",
    routeLink: { testId: "settings-route-link-jobs", destination: "/jobs" },
  },
  {
    id: "plugins",
    label: "Plugins",
    panelTestId: "settings-panel-plugins",
    routeLink: { testId: "settings-route-link-plugins", destination: "/plugins" },
  },
  { id: "mail", label: "Mail", panelTestId: "settings-panel-mail" },
  {
    id: "agents",
    label: "Agents",
    panelTestId: "settings-panel-agents",
    routeLink: { testId: "settings-route-link-agents", destination: "/agents" },
  },
  {
    id: "mcp-servers",
    label: "MCP",
    panelTestId: "settings-panel-mcp-servers",
    routeLink: { testId: "settings-route-link-mcp-servers", destination: "/mcp-servers" },
  },
  { id: "config", label: "Config", panelTestId: "settings-panel-config" },
  {
    id: "observations",
    label: "Observations",
    panelTestId: "settings-panel-observations",
    routeLink: { testId: "settings-route-link-observations", destination: "/observations" },
  },
  {
    id: "personality",
    label: "Personality",
    panelTestId: "settings-panel-personality",
    routeLink: { testId: "settings-route-link-personality", destination: "/personality" },
  },
  { id: "providers", label: "Providers", panelTestId: "settings-panel-providers" },
  {
    id: "logs",
    label: "Logs",
    panelTestId: "settings-panel-logs",
    routeLink: { testId: "settings-route-link-logs", destination: "/logs" },
  },
] as const satisfies readonly SettingsDeepLink[];

function readText(path: string): string {
  try {
    return readFileSync(path, "utf8");
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Route-parity source file could not be read: ${path}: ${reason}`);
  }
}

function readJson(path: string): unknown {
  try {
    return JSON.parse(readText(path)) as unknown;
  } catch (error) {
    const reason = error instanceof Error ? error.message : String(error);
    throw new Error(`Route-parity artifact manifest is not valid JSON: ${path}: ${reason}`);
  }
}

/** Normalize a page route while rejecting query strings and non-page links. */
export function normalizeRoute(candidate: string): string | null {
  const withoutQuery = candidate.split(/[?#]/, 1)[0] ?? "";
  if (!withoutQuery.startsWith("/") || withoutQuery.includes("\\")) return null;
  if (withoutQuery === "/") return "/";
  return withoutQuery.replace(/\/+$/, "") || "/";
}

function firstPathSegment(route: string): string {
  return route.replace(/^\/+/, "").split("/", 1)[0] ?? "";
}

export function isRetiredDashboardRoute(route: string): boolean {
  return RETIRED_DASHBOARD_ROUTE_SEGMENTS.includes(firstPathSegment(route) as (typeof RETIRED_DASHBOARD_ROUTE_SEGMENTS)[number]);
}

function uniqueRoutes(routes: Iterable<string>): string[] {
  return [...new Set(routes)].sort((left, right) => left.localeCompare(right));
}

/** Derive primary navigation hrefs from the navigation source, including Home. */
export function discoverCanonicalNavigationRoutes(): readonly string[] {
  const source = readText(NAVIGATION_SOURCE);
  const routes = [...source.matchAll(/\bhref\s*:\s*["'](\/[^"']*)["']/g)]
    .map((match) => normalizeRoute(match[1] ?? ""))
    .filter((route): route is string => route !== null);

  const canonical = uniqueRoutes(routes);
  if (canonical.length === 0 || !canonical.includes("/")) {
    throw new Error("Could not derive the dashboard primary navigation route inventory");
  }
  if (canonical.some(isRetiredDashboardRoute)) {
    throw new Error(`Primary navigation contains a retired dashboard route: ${canonical.join(", ")}`);
  }
  return canonical;
}

/** Return the explicit settings deep-link contract used by the parity suite. */
export function discoverSettingsDeepLinks(): readonly SettingsDeepLink[] {
  if (CANONICAL_SETTINGS_DEEP_LINKS.length !== 14) {
    throw new Error("The settings deep-link inventory must contain exactly 14 canonical IDs");
  }

  const ids = CANONICAL_SETTINGS_DEEP_LINKS.map(({ id }) => id);
  if (new Set(ids).size !== ids.length) {
    throw new Error(`The settings deep-link inventory contains duplicate IDs: ${ids.join(", ")}`);
  }
  return CANONICAL_SETTINGS_DEEP_LINKS;
}

/** Derive settings query values from the explicit deep-link inventory. */
export function discoverSupportedSettingsTabs(): readonly string[] {
  return discoverSettingsDeepLinks().map(({ id }) => id);
}

function queryString(query: Readonly<Record<string, string>>): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(query)) params.set(key, value);
  const encoded = params.toString();
  return encoded ? `?${encoded}` : "";
}

export function routeWithQuery(path: string, query: Readonly<Record<string, string>> = {}): string {
  const normalized = normalizeRoute(path);
  if (!normalized) throw new Error(`Cannot build a URL for non-page route: ${path}`);
  return `${normalized}${queryString(query)}`;
}

/**
 * Build the supported stateful page URLs from caller-supplied values.
 *
 * Documentation IDs and mail account IDs belong to the running target, not to
 * this source inventory. Callers should use isolated fixture values when they
 * only need URL-shape coverage; this helper never discovers data from a live
 * target and never mutates server state.
 */
export function buildPageSpecificQueryVariants(
  data: PageSpecificQueryVariantData,
  project = "global-default",
): readonly QueryVariant[] {
  const mailState = { account: data.mailAccount, folder: "INBOX" };

  return [
    {
      name: "config global tab",
      path: "/config",
      query: { project, tab: "global" },
    },
    {
      name: "config providers tab",
      path: "/config",
      query: { project, tab: "providers" },
    },
    {
      name: "tasks list view",
      path: "/tasks",
      query: { project, view: "list" },
    },
    {
      name: "tasks timeline view",
      path: "/tasks",
      query: { project, view: "timeline" },
    },
    {
      name: "docs space selection",
      path: "/docs",
      query: { project, space: data.docsSpaceId },
    },
    {
      name: "docs page selection",
      path: "/docs",
      query: { project, space: data.docsSpaceId, page: data.docsPageId },
    },
    {
      name: "mail account and folder state",
      path: "/mail",
      query: mailState,
    },
    {
      name: "standalone OpenCode page",
      path: "/standalone",
      query: { page: "opencode", standalone: "1" },
    },
    {
      name: "standalone VS Code page",
      path: "/standalone",
      query: { page: "vscode", standalone: "1" },
    },
    {
      name: "standalone chat page",
      path: "/standalone",
      query: { page: "chat", standalone: "1" },
    },
    {
      name: "standalone docs page",
      path: "/standalone",
      query: {
        page: "docs",
        standalone: "1",
        space: data.docsSpaceId,
        pageId: data.docsPageId,
      },
    },
    {
      name: "standalone mail account and folder state",
      path: "/standalone",
      query: { page: "mail", standalone: "1", ...mailState },
    },
  ];
}

export function discoverRouteInventory(project = "global-default"): RouteInventory {
  const canonicalNavigationRoutes = discoverCanonicalNavigationRoutes();
  const settingsDeepLinks = discoverSettingsDeepLinks();
  const supportedSettingsTabs = settingsDeepLinks.map(({ id }) => id);
  const queryVariants: QueryVariant[] = [];

  for (const path of canonicalNavigationRoutes) {
    queryVariants.push({
      name: `${path} with the active project query`,
      path,
      query: { project },
    });
  }

  for (const { id: tab } of settingsDeepLinks) {
    queryVariants.push({
      name: `home settings deep link (${tab})`,
      path: "/",
      query: { settings: tab },
    });
    queryVariants.push({
      name: `home settings deep link (${tab}) with the active project query`,
      path: "/",
      query: { project, settings: tab },
    });
  }

  // This is an application link used by the chat surface and therefore a
  // supported contextual settings variant, not a new primary navigation route.
  if (supportedSettingsTabs.includes("providers")) {
    queryVariants.push({
      name: "chat providers settings deep link",
      path: "/chat",
      query: { settings: "providers" },
    });
  }

  queryVariants.push({
    name: "settings redirect route with the active project query",
    path: "/settings",
    query: { project },
  });

  return {
    canonicalNavigationRoutes,
    settingsDeepLinks,
    supportedSettingsTabs,
    queryVariants,
    // `/settings` is a redirect compatibility page, not a primary nav item.
    compatibilityRoutes: ["/settings"],
  };
}

function manifestRoutes(manifest: unknown): string[] {
  if (!manifest || typeof manifest !== "object") return [];
  const record = manifest as Record<string, unknown>;
  const entries = ["staticRoutes", "dynamicRoutes"].flatMap((key) => {
    const value = record[key];
    return Array.isArray(value) ? value : [];
  });

  return entries
    .map((entry) => {
      if (!entry || typeof entry !== "object") return null;
      const page = (entry as RouteManifestEntry).page;
      return typeof page === "string" ? normalizeRoute(page) : null;
    })
    .filter((route): route is string => route !== null);
}

function appPathManifestRoutes(manifest: unknown): string[] {
  if (!manifest || typeof manifest !== "object" || Array.isArray(manifest)) return [];
  return Object.values(manifest as Record<string, unknown>)
    .filter((route): route is string => typeof route === "string")
    .map(normalizeRoute)
    .filter((route): route is string => route !== null);
}

/** Load and validate the production build's route manifests without writing. */
export function loadProductionArtifactRoutes(): ProductionArtifactRoutes {
  const configuredDirectory = process.env.INGENIUM_DASHBOARD_ARTIFACT_DIR?.trim();
  const manifestPath = process.env[TEST_RUN_MANIFEST_ENV];
  const fixtureDirectory = manifestPath
    ? join(getTestRunDashboardWorkspace(readTestRunManifest(manifestPath)), ".next")
    : join(REPOSITORY_ROOT, "services", "ingenium-dashboard", ".next");
  const directory = configuredDirectory
    ? resolve(REPOSITORY_ROOT, configuredDirectory)
    : fixtureDirectory;
  const buildId = readText(join(directory, "BUILD_ID")).trim();
  if (!buildId) throw new Error(`Production dashboard artifact has no BUILD_ID: ${directory}`);

  const routes = uniqueRoutes([
    ...manifestRoutes(readJson(join(directory, "routes-manifest.json"))),
    ...appPathManifestRoutes(readJson(join(directory, "app-path-routes-manifest.json"))),
  ]);
  if (routes.length === 0) {
    throw new Error(`Production dashboard artifact contains no page routes: ${directory}`);
  }

  return { directory, buildId, routes: new Set(routes) };
}

export function repositoryRoot(): string {
  return REPOSITORY_ROOT;
}
