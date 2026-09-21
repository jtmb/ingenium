import { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { logger } from "ingenium-core";

/**
 * Application-level error with structured HTTP response fields.
 *
 * Throw this from route handlers and middleware to produce a consistent JSON
 * error response. code maps to a machine-readable error type (e.g.,
 * "NOT_FOUND", "VALIDATION_ERROR"), while statusCode determines the HTTP
 * status. details is reserved for additional context (e.g., field-level
 * validation errors).
 *
 * AppError is recognized by errorHandler via instanceof — no fallthrough to
 * the generic 500 branch.
 */
export class AppError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly statusCode: number = 400,
    public readonly details?: unknown,
  ) {
    super(message);
    this.name = "AppError";
  }
}

/**
 * `express.json()` delegates rejected request bodies to the terminal error
 * handler. Treat its known client errors explicitly instead of letting them
 * fall through to the generic 500 response. The raw `body` property that
 * body-parser attaches is deliberately never read or logged here.
 */
function bodyParserClientError(err: Error): { status: 400 | 413; code: string; message: string } | null {
  const parseError = err as Error & {
    type?: unknown;
    status?: unknown;
    statusCode?: unknown;
  };
  const status = parseError.status ?? parseError.statusCode;
  if (err instanceof SyntaxError && parseError.type === "entity.parse.failed" && status === 400) {
    return { status: 400, code: "MALFORMED_JSON", message: "Malformed JSON request body" };
  }
  if (parseError.type === "entity.too.large" && status === 413) {
    return { status: 413, code: "PAYLOAD_TOO_LARGE", message: "Request body exceeds the allowed size" };
  }
  if ((parseError.type === "request.aborted" || parseError.type === "request.size.invalid") && status === 400) {
    return { status: 400, code: "INVALID_REQUEST_BODY", message: "Request body is incomplete or invalid" };
  }
  if (parseError.type === "encoding.unsupported" && status === 415) {
    return { status: 400, code: "INVALID_REQUEST_BODY", message: "Request body encoding is unsupported" };
  }
  return null;
}

/**
 * Express error-handling middleware (4-arg signature required by Express 4).
 *
 * Handles four tiers of errors:
 * 1. Rejected request body → sanitized 400/413 without reflecting submitted data
 * 2. AppError        → structured response with caller-chosen status/code
 * 3. ZodError        → 422 with field-level validation details
 * 4. Everything else → 500 with logged stack trace (never leaks internals to client)
 *
 * Every response includes a requestId prefix to correlate client reports with
 * server logs. 8 hex chars from a UUID gives ~4B collision space — sufficient
 * for per-second cardinality without bloating log lines.
 */
export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
  const requestId = `req_${randomUUID().slice(0, 8)}`;

  const parserError = bodyParserClientError(err);
  if (parserError) {
    res.status(parserError.status).json({
      error: {
        code: parserError.code,
        message: parserError.message,
        details: null,
        requestId,
      },
    });
    return;
  }

  if (err instanceof AppError) {
    if (err.statusCode === 401) res.set("WWW-Authenticate", 'Bearer realm="ingenium"');
    res.status(err.statusCode).json({
      error: {
        code: err.code,
        message: err.message,
        details: err.details ?? null,
        requestId,
      },
    });
    return;
  }

  if (err instanceof ZodError) {
    // 422 Unprocessable Entity is the standard HTTP status for schema validation
    // failures (RFC 4918). Each field error includes the full dotted path for
    // nested schemas, mapping directly to the ZodError path.
    res.status(422).json({
      error: {
        code: "VALIDATION_ERROR",
        message: "Input validation failed",
        details: err.errors.map((e) => ({
          field: e.path.join("."),
          reason: e.message,
        })),
        requestId,
      },
    });
    return;
  }

  // Authentication routes can carry credentials; their unexpected failures are logged content-free.
  const authenticationPath = _req.originalUrl.startsWith("/api/v1/auth/");
  logger.error("api", authenticationPath
    ? `${_req.method} authentication route failed`
    : `${_req.method} ${_req.originalUrl} → ${err?.name || "Error"}: ${err?.message}`, {
    error: authenticationPath ? "AUTH_ROUTE_FAILURE" : err?.message,
    name: authenticationPath ? "AuthenticationRouteError" : err?.name,
    stack: authenticationPath ? undefined : err?.stack,
    method: _req.method,
    path: _req.originalUrl,
    requestId,
  });
  res.status(500).json({
    error: {
      code: "INTERNAL_ERROR",
      message: "An unexpected error occurred",
      details: null,
      requestId,
    },
  });
}
