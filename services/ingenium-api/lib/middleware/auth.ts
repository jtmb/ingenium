import { Request, Response, NextFunction } from "express";
import { AppError } from "./errors.js";
import { apiTokensEqual, loadApiToken } from "./api-token.js";

export type RequestPrincipal =
  | { type: "compatibility"; id: "legacy-server-bearer"; scopes: readonly ["legacy:*"] }
  | { type: "user"; id: string; scopes: readonly string[] };

declare global {
  namespace Express {
    interface Request {
      principal?: RequestPrincipal;
    }
  }
}

/**
 * The sole unauthenticated API route is the OAuth provider redirect. It must
 * remain an exact GET match: query parameters carry the provider state, while
 * all management endpoints (including health) require a Bearer token.
 */
export function isPublicOAuthCallbackRequest(req: Request): boolean {
  return req.method === "GET" && req.path === "/auth/callback";
}

/**
 * Token-based authentication for every API management request.
 *
 * INGENIUM_API_TOKEN is mandatory in normal operation. A missing server token
 * is a deployment error, never a development-mode bypass. The OAuth callback
 * is the narrowly scoped exception because an OAuth provider cannot attach the
 * local API credential to its browser redirect.
 *
 * Placement in the middleware chain matters: auth sits AFTER rate limiting so
 * brute-force attempts are throttled before the constant-time comparison runs.
 * 401 vs 403 distinguishes "missing/invalid header" from "wrong token provided".
 *
 * 🔴 Token loading and comparison are centralized in api-token.ts so runtime-file
 * and inline configuration have the same strength and timing-safe guarantees.
 */
export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (isPublicOAuthCallbackRequest(req)) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  let token: string;
  try {
    token = loadApiToken();
  } catch {
    throw new AppError("API authentication is not configured", "API_AUTH_NOT_CONFIGURED", 503);
  }

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AppError("Missing or invalid authorization header", "UNAUTHORIZED", 401);
  }

  const provided = authHeader.slice(7);
  if (!apiTokensEqual(provided, token)) {
    throw new AppError("Invalid authorization token", "FORBIDDEN", 403);
  }

  req.principal = { type: "compatibility", id: "legacy-server-bearer", scopes: ["legacy:*"] };
  next();
}
