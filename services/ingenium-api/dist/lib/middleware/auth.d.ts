import { Request, Response, NextFunction } from "express";
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
export declare function authMiddleware(req: Request, _res: Response, next: NextFunction): void;
//# sourceMappingURL=auth.d.ts.map