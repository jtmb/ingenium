import { Request, Response, NextFunction } from "express";
import { createHash } from "node:crypto";
import { authentication } from "ingenium-core";
import { config } from "../../config/index.js";
import { isDashboardSafeReadCandidate, normalizeDashboardReadPath } from "../dashboard-safe-read-policy.js";
import { isPublicHealthRequest, isRuntimeGatewayPrivateRequest } from "./auth.js";

/**
 * Sliding-window in-memory rate limiter keyed by client IP.
 *
 * WARNING: In-memory only — state is NOT shared across process restarts or
 * container replicas. Suitable for single-instance deployments with supervisord
 * restarts. For multi-replica deployments, replace with Redis or an external
 * rate-limit store.
 *
 * Placement: strict traffic is limited before auth. Positive Dashboard GET
 * candidates pass a shared admission ceiling; failed authentication is charged
 * back to the strict bucket, and only valid browser sessions get safe accounting.
 *
 * The window is 60 seconds (60_000ms) — fine-grained enough to catch bursts
 * without causing spurious rejections from short traffic spikes. The
 * config.rateLimit default (100 req/min) is tuned for agentic workloads where
 * each request triggers LLM calls or DB writes, not for human browsing.
 *
 * 🧹 TTL pruning: When the map exceeds MAX_ENTRIES (10,000), a synchronous
 * sweep removes all entries with expired windows. This bounds memory growth
 * deterministically without setInterval background leaks. For test cleanup,
 * `clearRateLimitEntries()` drops the entire map.
 */
const MAX_ENTRIES = 10_000;
const RUNTIME_GATEWAY_MAX_REQUESTS = 10_000;
export const AUTH_PREFLIGHT_READ_MAX_REQUESTS = 60;
export const DASHBOARD_READ_MAX_REQUESTS = 480;
// Credential grants and runtime launcher aliases can vary without changing the
// immutable credential or canonical workspace identities that own these limits.
// Run d5a… observed 79 eligible service reads; the existing 12-read fanout
// allowance brings the bounded startup profile to 91, rounded to 100.
export const SERVICE_SAFE_READ_MAX_REQUESTS = 100;

function normalizeTrustedClientIp(req: Request): string {
  const address = (req.socket?.remoteAddress || req.ip || "unknown").toLowerCase();
  const normalized = address.startsWith("::ffff:") ? address.slice(7) : address;
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "0:0:0:0:0:0:0:1"
    ? "loopback"
    : normalized;
}

const AUTH_PREFLIGHT_READ_PATHS = new Set([
  "/api/v1/auth/csrf",
  "/api/v1/auth/oidc/providers",
]);

function hasAuthenticationCredential(req: Request): boolean {
  if (req.headers.authorization !== undefined) return true;
  return req.headers.cookie?.split(";").some((part) => part.trim().startsWith(`${authentication.SESSION_COOKIE_NAME}=`)) ?? false;
}

export function isUnauthenticatedAuthPreflightRead(req: Request): boolean {
  return (req.method === "GET" || req.method === "HEAD")
    && req.originalUrl === req.path
    && AUTH_PREFLIGHT_READ_PATHS.has(req.originalUrl)
    && !hasAuthenticationCredential(req);
}

export function isBoundaryAttestedRuntimeGatewayRequest(req: Request): boolean {
  const remoteAddress = req.socket?.remoteAddress;
  return (remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1")
    && isRuntimeGatewayPrivateRequest(req)
    && req.headers["x-ingenium-audience"] === "runtime-gateway"
    && req.headers["x-ingenium-private-network"] === "runtime-gateway"
    && req.headers.cookie === undefined
    && req.headers.origin === undefined;
}

export function createRateLimiter(
  maxRequests: number,
  windowMs = 60_000,
  requestKey: (req: Request) => string = normalizeTrustedClientIp,
) {
  const requestCounts = new Map<string, { count: number; resetAt: number }>();

  const pruneBeforeInsert = (now: number): void => {
    if (requestCounts.size < MAX_ENTRIES) return;
    for (const [staleKey, staleEntry] of requestCounts) {
      if (now >= staleEntry.resetAt) requestCounts.delete(staleKey);
    }
    while (requestCounts.size >= MAX_ENTRIES) requestCounts.delete(requestCounts.keys().next().value!);
  };

  const currentEntry = (req: Request, increment: boolean): { count: number; resetAt: number } | undefined => {
    const key = requestKey(req);
    const now = Date.now();
    let entry = requestCounts.get(key);
    if (!entry || now >= entry.resetAt) {
      if (!increment) return undefined;
      pruneBeforeInsert(now);
      entry = { count: 0, resetAt: now + windowMs };
      requestCounts.set(key, entry);
    }
    if (increment) entry.count += 1;
    return entry;
  };

  const reject = (entry: { resetAt: number }, res: Response): void => {
    res.set("Retry-After", String(Math.max(1, Math.ceil((entry.resetAt - Date.now()) / 1000))));
    res.set("X-RateLimit-Limit", String(maxRequests));
    res.set("X-RateLimit-Remaining", "0");
    res.set("X-RateLimit-Reset", String(Math.ceil(entry.resetAt / 1000)));
    res.status(429).json({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Please wait before retrying.",
        details: null,
        requestId: `req_${Math.random().toString(36).slice(2, 10)}`,
      },
    });
  };

  const rateLimiter = (req: Request, res: Response, next: NextFunction): void => {
    const entry = currentEntry(req, true)!;
    if (entry.count > maxRequests) return reject(entry, res);
    next();
  };

  return Object.assign(rateLimiter, {
    check(req: Request, res: Response, next: NextFunction): void {
      const entry = currentEntry(req, false);
      if (entry && entry.count >= maxRequests) return reject(entry, res);
      next();
    },
    record(req: Request): void {
      currentEntry(req, true);
    },
    clear: () => requestCounts.clear(),
  });
}

const defaultRateLimiter = createRateLimiter(config.rateLimit);
const authPreflightReadRateLimiter = createRateLimiter(
  AUTH_PREFLIGHT_READ_MAX_REQUESTS,
  60_000,
  (req) => `${normalizeTrustedClientIp(req)}\0${req.originalUrl}`,
);
const safeReadAdmissionRateLimiter = createRateLimiter(DASHBOARD_READ_MAX_REQUESTS);
const dashboardReadRateLimiter = createRateLimiter(
  DASHBOARD_READ_MAX_REQUESTS,
  60_000,
  (req) => `${normalizeTrustedClientIp(req)}\0${req.principal?.type === "user" ? req.principal.session?.id ?? "no-session" : "no-session"}`,
);
const serviceSafeReadRateLimiter = createRateLimiter(
  SERVICE_SAFE_READ_MAX_REQUESTS,
  60_000,
  (req) => serviceSafeReadRateLimitKey(req)!,
);
// ponytail: one bounded shared bucket; split by runtime only if measured concurrency requires it.
const runtimeGatewayRateLimiter = createRateLimiter(RUNTIME_GATEWAY_MAX_REQUESTS);

/** Reset the default rate-limit store entirely — exposed for test cleanup only. */
export function clearRateLimitEntries(): void {
  defaultRateLimiter.clear();
  authPreflightReadRateLimiter.clear();
  safeReadAdmissionRateLimiter.clear();
  dashboardReadRateLimiter.clear();
  serviceSafeReadRateLimiter.clear();
  runtimeGatewayRateLimiter.clear();
}

export function authPreflightReadRateLimit(req: Request, res: Response, next: NextFunction): void {
  if (!isUnauthenticatedAuthPreflightRead(req)) {
    next();
    return;
  }
  authPreflightReadRateLimiter(req, res, next);
}

const SERVICE_SAFE_READ_PATHS = new Set([
  "/api/v1/auth/preflight",
  "/api/v1/mcp-tools",
]);

export function isServiceSafeReadCandidate(req: Pick<Request, "method" | "originalUrl" | "url">): boolean {
  if (isDashboardSafeReadCandidate(req)) return true;
  if (req.method !== "GET") return false;
  const path = normalizeDashboardReadPath(req.originalUrl || req.url);
  return path !== null && (SERVICE_SAFE_READ_PATHS.has(path)
    || /^\/api\/v1\/mcp-tools\/[^/]+\/state$/.test(path));
}

function serviceSafeReadRateLimitKey(req: Request): string | undefined {
  if (req.principal?.type !== "service") return undefined;
  return createHash("sha256").update("service-safe-read\0").update(req.principal.id).digest("hex");
}

export const rateLimit = Object.assign(
  (req: Request, res: Response, next: NextFunction) => {
    if (isPublicHealthRequest(req)) {
      next();
      return;
    }
    if (isUnauthenticatedAuthPreflightRead(req)) {
      next();
      return;
    }
    if (isBoundaryAttestedRuntimeGatewayRequest(req)) {
      runtimeGatewayRateLimiter(req, res, next);
      return;
    }
    if (isServiceSafeReadCandidate(req)) {
      defaultRateLimiter.check(req, res, () => safeReadAdmissionRateLimiter(req, res, next));
      return;
    }
    defaultRateLimiter(req, res, next);
  },
  { clear: clearRateLimitEntries },
);

export function recordCandidateAuthenticationFailure(
  error: unknown,
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  // Candidate reads are not charged up front, so only failed authentication
  // records a strict attempt; the next request is blocked before repeated auth work.
  if (isServiceSafeReadCandidate(req)) {
    defaultRateLimiter.record(req);
  }
  next(error);
}

export function authenticatedReadRateLimit(req: Request, res: Response, next: NextFunction): void {
  const serviceSafeRead = isServiceSafeReadCandidate(req);
  if (serviceSafeRead && req.principal?.type === "service") {
    const key = serviceSafeReadRateLimitKey(req);
    if (key) {
      serviceSafeReadRateLimiter(req, res, next);
      return;
    }
    defaultRateLimiter(req, res, next);
    return;
  }
  if (req.principal?.type === "user" && req.principal.session) {
    if (isDashboardSafeReadCandidate(req)) {
      dashboardReadRateLimiter(req, res, next);
      return;
    }
  }
  if (serviceSafeRead) {
    defaultRateLimiter(req, res, next);
    return;
  }
  next();
}

/**
 * Brute-force protection for vault passphrase attempts only. It is mounted on
 * POST /initialize and POST /unseal, never on normal vault status or metadata
 * reads, so a locked vault remains observable after a throttle.
 */
export const vaultBruteForceLimiter = createRateLimiter(5);

/** @deprecated Use vaultBruteForceLimiter. Retained for existing consumers. */
export const vaultRateLimiter = vaultBruteForceLimiter;
