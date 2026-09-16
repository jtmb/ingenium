import type { Request } from "express";
import policyDocument from "../config/dashboard-safe-reads.json" with { type: "json" };

interface PolicyRoute {
  template: string;
  pattern?: string;
  observedCount: number;
  source: string;
  mount: string;
  registration: string;
  reason?: string;
}

interface PolicyDocument {
  schemaVersion: number;
  evidence: {
    runId: string;
    networkStates: number;
    observedGetRequests: number;
    safeGetRequests: number;
    strictGetRequests: number;
    observedStrictNonGetRequests: number;
    maxSinglePageFanout: number;
    maxSinglePageApiRequests: number;
    humanPacedTransitionIntervalMs: number;
  };
  safeRoutes: PolicyRoute[];
  observedStrictRoutes: PolicyRoute[];
}

function assertPolicyRoute(route: PolicyRoute, safe: boolean): void {
  if (!route.template.startsWith("/api/v1/") || route.template.endsWith("/")
    || route.template.includes("?") || route.template.includes("%") || /[\u0000-\u001f\u007f]/.test(route.template)
    || !Number.isSafeInteger(route.observedCount) || route.observedCount < 0
    || !route.source || !route.mount || !route.registration) {
    throw new Error(`Invalid Dashboard read policy route: ${route.template}`);
  }
  if (safe && (!route.pattern?.startsWith("/api/v1/") || route.pattern.includes("?")
    || route.pattern.includes("%") || /[\u0000-\u001f\u007f]/.test(route.pattern))) {
    throw new Error(`Invalid Dashboard safe-read pattern: ${route.template}`);
  }
  if (safe) new RegExp(`^${route.pattern}$`);
}

function loadPolicy(value: unknown): PolicyDocument {
  const policy = value as Partial<PolicyDocument>;
  if (policy.schemaVersion !== 1 || !policy.evidence || !Array.isArray(policy.safeRoutes)
    || !Array.isArray(policy.observedStrictRoutes)) {
    throw new Error("Dashboard safe-read policy is malformed");
  }
  policy.safeRoutes.forEach((route) => assertPolicyRoute(route, true));
  policy.observedStrictRoutes.forEach((route) => assertPolicyRoute(route, false));
  const routes = [...policy.safeRoutes, ...policy.observedStrictRoutes];
  if (new Set(routes.map((route) => route.template)).size !== routes.length) {
    throw new Error("Dashboard read policy contains duplicate route templates");
  }
  const safe = policy.safeRoutes.reduce((total, route) => total + route.observedCount, 0);
  const strict = policy.observedStrictRoutes.reduce((total, route) => total + route.observedCount, 0);
  if (safe !== policy.evidence.safeGetRequests || strict !== policy.evidence.strictGetRequests
    || safe + strict !== policy.evidence.observedGetRequests
    || !Number.isSafeInteger(policy.evidence.observedStrictNonGetRequests) || policy.evidence.observedStrictNonGetRequests < 0
    || !Number.isSafeInteger(policy.evidence.maxSinglePageFanout) || policy.evidence.maxSinglePageFanout < 1
    || !Number.isSafeInteger(policy.evidence.maxSinglePageApiRequests) || policy.evidence.maxSinglePageApiRequests < policy.evidence.maxSinglePageFanout
    || !Number.isSafeInteger(policy.evidence.humanPacedTransitionIntervalMs) || policy.evidence.humanPacedTransitionIntervalMs < 1) {
    throw new Error("Dashboard read policy evidence totals do not reconcile");
  }
  return policy as PolicyDocument;
}

export const dashboardSafeReadPolicy = loadPolicy(policyDocument);

const safeReadPatterns = dashboardSafeReadPolicy.safeRoutes.map(
  (route) => new RegExp(`^${route.pattern}$`),
);

export function normalizeDashboardReadPath(rawUrl: string): string | null {
  const query = rawUrl.indexOf("?");
  let path = query === -1 ? rawUrl : rawUrl.slice(0, query);
  if (!path.startsWith("/api/v1/") || path.length > 2_048 || path.includes("%")
    || path.includes("\\") || path.includes("|") || path.includes("//")
    || /[\u0000-\u001f\u007f]/.test(path)) return null;
  if (path.endsWith("/")) path = path.slice(0, -1);
  if (!path || path.endsWith("/") || path.split("/").some((part) => part === "." || part === "..")) return null;
  return path;
}

export function isDashboardSafeReadCandidate(
  req: Pick<Request, "method" | "originalUrl" | "url">,
): boolean {
  if (req.method !== "GET") return false;
  const path = normalizeDashboardReadPath(req.originalUrl || req.url);
  return path !== null && safeReadPatterns.some((pattern) => pattern.test(path));
}
