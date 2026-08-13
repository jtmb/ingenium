import type { NextFunction, Request, Response } from "express";
import { authentication } from "ingenium-core";
import { config } from "../../config/index.js";
import { AppError } from "./errors.js";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const DASHBOARD_REQUEST_MARKER = "dashboard";
const PRE_AUTH_PATHS = new Set([
  "/api/v1/auth/login",
  "/api/v1/auth/mfa/challenge",
  "/api/v1/auth/password/forgot",
  "/api/v1/auth/password/reset",
  "/api/v1/auth/email/verify",
  "/api/v1/auth/oidc/start",
]);

/**
 * Protect the browser-facing dashboard rewrite without imposing browser-only
 * headers on MCP and server-to-server callers. A browser request carries an
 * Origin; the dashboard client also emits this marker on every API request.
 */
export function csrfMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (!UNSAFE_METHODS.has(req.method)) {
    next();
    return;
  }
  if (PRE_AUTH_PATHS.has(req.path)) {
    next();
    return;
  }

  const origin = req.get("origin");
  const dashboardMarker = req.get("x-ingenium-ui");
  const session = req.principal?.type === "user" ? req.principal.session : undefined;
  if (req.principal && req.principal.type !== "compatibility" && !session) {
    next();
    return;
  }
  const looksBrowserMediated = origin !== undefined || dashboardMarker !== undefined;

  // MCP, scheduler, and other non-browser clients authenticate with their
  // bearer credential and do not send Origin or dashboard-specific headers.
  if (!looksBrowserMediated && !session) {
    next();
    return;
  }

  if (
    !origin
    || !config.dashboardOrigins.includes(origin)
    || (session ? !authentication.verifySessionCsrf(session, req.get("x-csrf-token") ?? "") : dashboardMarker !== DASHBOARD_REQUEST_MARKER)
  ) {
    throw new AppError(
      "Unsafe browser API requests require the trusted dashboard origin and request marker",
      "CSRF_REJECTED",
      403,
    );
  }

  next();
}
