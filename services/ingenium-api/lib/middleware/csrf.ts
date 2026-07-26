import type { NextFunction, Request, Response } from "express";
import { config } from "../../config/index.js";
import { AppError } from "./errors.js";

const UNSAFE_METHODS = new Set(["POST", "PUT", "PATCH", "DELETE"]);
const DASHBOARD_REQUEST_MARKER = "dashboard";

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

  const origin = req.get("origin");
  const dashboardMarker = req.get("x-ingenium-ui");
  const looksBrowserMediated = origin !== undefined || dashboardMarker !== undefined;

  // MCP, scheduler, and other non-browser clients authenticate with their
  // bearer credential and do not send Origin or dashboard-specific headers.
  if (!looksBrowserMediated) {
    next();
    return;
  }

  if (
    !origin
    || !config.dashboardOrigins.includes(origin)
    || dashboardMarker !== DASHBOARD_REQUEST_MARKER
  ) {
    throw new AppError(
      "Unsafe browser API requests require the trusted dashboard origin and request marker",
      "CSRF_REJECTED",
      403,
    );
  }

  next();
}
