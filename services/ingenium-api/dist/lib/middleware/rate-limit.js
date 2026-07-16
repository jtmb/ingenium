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
const requestCounts = new Map();
/** Sweep expired entries — called when map crosses the threshold. */
function pruneStaleEntries(now) {
    for (const [ip, entry] of requestCounts) {
        if (now > entry.resetAt) {
            requestCounts.delete(ip);
        }
    }
}
/** Reset the rate-limit store entirely — exposed for test cleanup only. */
export function clearRateLimitEntries() {
    requestCounts.clear();
}
export function rateLimit(req, res, next) {
    const ip = req.ip ?? "unknown";
    const now = Date.now();
    const entry = requestCounts.get(ip);
    // First request for this IP, or window has expired — start a fresh window
    if (!entry || now > entry.resetAt) {
        // Prune before growing — deterministic, no setInterval leak
        if (requestCounts.size >= MAX_ENTRIES) {
            pruneStaleEntries(now);
        }
        requestCounts.set(ip, { count: 1, resetAt: now + 60_000 });
        next();
        return;
    }
    entry.count++;
    if (entry.count > config.rateLimit) {
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
}
