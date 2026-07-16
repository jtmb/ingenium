import { timingSafeEqual } from "node:crypto";
import { AppError } from "./errors.js";
/**
 * Optional token-based auth middleware.
 *
 * If INGENIUM_API_TOKEN is not set, all requests pass through unauthenticated
 * (development-friendly default). When configured, every request must include a
 * valid `Authorization: Bearer <token>` header.
 *
 * Placement in the middleware chain matters: auth sits AFTER rate limiting so
 * brute-force attempts are throttled before the constant-time comparison runs.
 * 401 vs 403 distinguishes "missing/invalid header" from "wrong token provided".
 *
 * 🔴 Timing-safe comparison: uses crypto.timingSafeEqual with length-safe padding
 * to prevent timing side-channel leakage of the correct token length and content.
 */
export function authMiddleware(req, _res, next) {
    const authHeader = req.headers.authorization;
    const token = process.env.INGENIUM_API_TOKEN;
    if (!token) {
        next();
        return;
    }
    if (!authHeader || !authHeader.startsWith("Bearer ")) {
        throw new AppError("Missing or invalid authorization header", "UNAUTHORIZED", 401);
    }
    const provided = authHeader.slice(7);
    // Timing-safe comparison — pad both inputs to equal length so
    // timingSafeEqual never throws on differing buffer lengths.
    const providedBuf = Buffer.from(provided, "utf8");
    const tokenBuf = Buffer.from(token, "utf8");
    const maxLen = Math.max(providedBuf.length, tokenBuf.length);
    const paddedProvided = Buffer.alloc(maxLen, 0);
    const paddedToken = Buffer.alloc(maxLen, 0);
    providedBuf.copy(paddedProvided);
    tokenBuf.copy(paddedToken);
    if (!timingSafeEqual(paddedProvided, paddedToken)) {
        throw new AppError("Invalid authorization token", "FORBIDDEN", 403);
    }
    next();
}
