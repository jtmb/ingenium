import { Request, Response, NextFunction } from "express";
import { config } from "../../config/index.js";

/**
 * Sliding-window in-memory rate limiter keyed by client IP.
 *
 * WARNING: In-memory only — state is NOT shared across process restarts or
 * container replicas. Suitable for single-instance deployments with supervisord
 * restarts. For multi-replica deployments, replace with Redis or an external
 * rate-limit store.
 *
 * Placement: mounted BEFORE auth middleware so brute-force attempts are
 * throttled at the earliest possible point (no token comparison cost for
 * already-limited IPs).
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

export function isBoundaryAttestedRuntimeGatewayRequest(req: Request): boolean {
  const remoteAddress = req.socket?.remoteAddress;
  return (remoteAddress === "127.0.0.1" || remoteAddress === "::1" || remoteAddress === "::ffff:127.0.0.1")
    && req.method === "POST"
    && /^\/api\/v1\/runtimes\/gateway\/(exchange|validate|activity)$/.test(req.path)
    && req.headers["x-ingenium-audience"] === "runtime-gateway"
    && req.headers["x-ingenium-private-network"] === "runtime-gateway"
    && req.headers.cookie === undefined
    && req.headers.origin === undefined;
}

export function createRateLimiter(maxRequests: number, windowMs = 60_000) {
  const requestCounts = new Map<string, { count: number; resetAt: number }>();

  const rateLimiter = (req: Request, res: Response, next: NextFunction): void => {
    const ip = req.ip ?? "unknown";
    const now = Date.now();
    const entry = requestCounts.get(ip);

    // First request for this IP, or window has expired — start a fresh window
    if (!entry || now > entry.resetAt) {
      // Prune before growing — deterministic, no setInterval leak
      if (requestCounts.size >= MAX_ENTRIES) {
        for (const [staleIp, staleEntry] of requestCounts) {
          if (now > staleEntry.resetAt) requestCounts.delete(staleIp);
        }
      }
      requestCounts.set(ip, { count: 1, resetAt: now + windowMs });
      next();
      return;
    }

    entry.count++;
    if (entry.count > maxRequests) {
      // RFC 7231 Retry-After header tells the client how many seconds to wait
      res.set("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
      res.status(429).json({
        error: {
          code: "RATE_LIMITED",
          message: "Too many requests. Please wait before retrying.",
          details: null,
          requestId: `req_${Math.random().toString(36).slice(2, 10)}`,
        },
      });
      return;
    }

    next();
  };

  return Object.assign(rateLimiter, { clear: () => requestCounts.clear() });
}

const defaultRateLimiter = createRateLimiter(config.rateLimit);
// ponytail: one bounded shared bucket; split by runtime only if measured concurrency requires it.
const runtimeGatewayRateLimiter = createRateLimiter(RUNTIME_GATEWAY_MAX_REQUESTS);

/** Reset the default rate-limit store entirely — exposed for test cleanup only. */
export function clearRateLimitEntries(): void {
  defaultRateLimiter.clear();
  runtimeGatewayRateLimiter.clear();
}

export const rateLimit = Object.assign(
  (req: Request, res: Response, next: NextFunction) => (isBoundaryAttestedRuntimeGatewayRequest(req)
    ? runtimeGatewayRateLimiter(req, res, next)
    : defaultRateLimiter(req, res, next)),
  { clear: clearRateLimitEntries },
);

/**
 * Brute-force protection for vault passphrase attempts only. It is mounted on
 * POST /initialize and POST /unseal, never on normal vault status or metadata
 * reads, so a locked vault remains observable after a throttle.
 */
export const vaultBruteForceLimiter = createRateLimiter(5);

/** @deprecated Use vaultBruteForceLimiter. Retained for existing consumers. */
export const vaultRateLimiter = vaultBruteForceLimiter;
