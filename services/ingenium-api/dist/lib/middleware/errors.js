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
    code;
    statusCode;
    details;
    constructor(message, code, statusCode = 400, details) {
        super(message);
        this.code = code;
        this.statusCode = statusCode;
        this.details = details;
        this.name = "AppError";
    }
}
/**
 * Express error-handling middleware (4-arg signature required by Express 4).
 *
 * Handles three tiers of errors:
 * 1. AppError        → structured response with caller-chosen status/code
 * 2. ZodError        → 422 with field-level validation details
 * 3. Everything else → 500 with logged stack trace (never leaks internals to client)
 *
 * Every response includes a requestId prefix to correlate client reports with
 * server logs. 8 hex chars from a UUID gives ~4B collision space — sufficient
 * for per-second cardinality without bloating log lines.
 */
export function errorHandler(err, _req, res, _next) {
    const requestId = `req_${randomUUID().slice(0, 8)}`;
    if (err instanceof AppError) {
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
    // Unexpected error — log full details but return a sanitized 500.
    // Stack traces are never sent to the client; they're written to the structured
    // log for server-side debugging only.
    logger.error("api", `${_req.method} ${_req.originalUrl} → ${err?.name || "Error"}: ${err?.message}`, {
        error: err?.message,
        name: err?.name,
        stack: err?.stack,
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
