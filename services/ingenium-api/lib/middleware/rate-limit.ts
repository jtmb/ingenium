import { Request, Response, NextFunction } from "express";
import { createHash } from "node:crypto";
import { coordination } from "ingenium-core";
import { config } from "../../config/index.js";
import { isPublicHealthRequest, isRuntimeGatewayPrivateRequest } from "./auth.js";

/**
 * Sliding-window in-memory rate limiter keyed by client IP.
 *
 * WARNING: In-memory only — state is NOT shared across process restarts or
 * container replicas. Suitable for single-instance deployments with supervisord
 * restarts. For multi-replica deployments, replace with Redis or an external
 * rate-limit store.
 *
 * Placement: strict traffic is limited before auth. Coordination requests pass
 * initial admission without consuming the strict bucket, then authenticated
 * requests are charged to credential and canonical-workspace buckets.
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
// Credential grants and runtime launcher aliases can vary without changing the
// immutable credential or canonical workspace identities that own these limits.
export const COORDINATION_CREDENTIAL_MAX_REQUESTS = 300;
export const COORDINATION_WORKSPACE_MAX_REQUESTS = 600;
export const COORDINATION_RATE_LIMIT_WINDOW_MS = 60_000;

function normalizeTrustedClientIp(req: Request): string {
  const address = (req.socket?.remoteAddress || req.ip || "unknown").toLowerCase();
  const normalized = address.startsWith("::ffff:") ? address.slice(7) : address;
  return normalized === "127.0.0.1" || normalized === "::1" || normalized === "0:0:0:0:0:0:0:1"
    ? "loopback"
    : normalized;
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
const coordinationCredentialRateLimiter = createRateLimiter(
  COORDINATION_CREDENTIAL_MAX_REQUESTS,
  COORDINATION_RATE_LIMIT_WINDOW_MS,
  (req) => coordinationRateLimitKeys(req)!.credential,
);
const coordinationWorkspaceRateLimiter = createRateLimiter(
  COORDINATION_WORKSPACE_MAX_REQUESTS,
  COORDINATION_RATE_LIMIT_WINDOW_MS,
  (req) => coordinationRateLimitKeys(req)!.workspace,
);
// ponytail: one bounded shared bucket; split by runtime only if measured concurrency requires it.
const runtimeGatewayRateLimiter = createRateLimiter(RUNTIME_GATEWAY_MAX_REQUESTS);

/** Reset the default rate-limit store entirely — exposed for test cleanup only. */
export function clearRateLimitEntries(): void {
  defaultRateLimiter.clear();
  coordinationCredentialRateLimiter.clear();
  coordinationWorkspaceRateLimiter.clear();
  runtimeGatewayRateLimiter.clear();
}

export function isCoordinationApiRequest(req: Pick<Request, "path">): boolean {
  return typeof req.path === "string" && req.path.startsWith("/api/v1/coordination/");
}

export function coordinationRateLimitKeys(req: Request): { credential: string; workspace: string } | undefined {
  const principal = req.principal;
  const identity = req.attestedCoordinationIdentity;
  if (principal?.type !== "service" || (principal.audience !== "mcp" && principal.audience !== "runtime")
    || !identity || principal.tokenId !== identity.credentialId || principal.workspaceId !== identity.workspaceId
    || principal.storageMappingHash !== identity.storageMappingHash || !req.authorizedProjectId) return undefined;
  let worktreeId: string;
  try {
    worktreeId = coordination.coordinationWorktreeId(identity.workspaceId, identity.storageMappingHash);
  } catch {
    return undefined;
  }
  return {
    credential: createHash("sha256").update("coordination-credential\0").update(identity.credentialId).digest("hex"),
    workspace: createHash("sha256").update("coordination-workspace\0").update(req.authorizedProjectId).update("\0").update(worktreeId).digest("hex"),
  };
}

export const rateLimit = Object.assign(
  (req: Request, res: Response, next: NextFunction) => {
    if (isPublicHealthRequest(req)) {
      next();
      return;
    }
    if (isBoundaryAttestedRuntimeGatewayRequest(req)) {
      runtimeGatewayRateLimiter(req, res, next);
      return;
    }
    if (isCoordinationApiRequest(req)) {
      defaultRateLimiter.check(req, res, next);
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
  // Coordination calls are not charged up front, so failed authentication records
  // a strict attempt before the next request reaches repeated credential work.
  if (isCoordinationApiRequest(req)) defaultRateLimiter.record(req);
  next(error);
}

export function recordCoordinationAttestationFailure(
  error: unknown,
  req: Request,
  _res: Response,
  next: NextFunction,
): void {
  if (isCoordinationApiRequest(req) && req.principal) defaultRateLimiter.record(req);
  next(error);
}

export function coordinationRateLimit(req: Request, res: Response, next: NextFunction): void {
  const keys = coordinationRateLimitKeys(req);
  if (!keys) {
    defaultRateLimiter(req, res, next);
    return;
  }
  coordinationWorkspaceRateLimiter(req, res, () => coordinationCredentialRateLimiter(req, res, next));
}

/**
 * Brute-force protection for vault passphrase attempts only. It is mounted on
 * POST /initialize and POST /unseal, never on normal vault status or metadata
 * reads, so a locked vault remains observable after a throttle.
 */
export const vaultBruteForceLimiter = createRateLimiter(5);

/** @deprecated Use vaultBruteForceLimiter. Retained for existing consumers. */
export const vaultRateLimiter = vaultBruteForceLimiter;
