import { Request, Response, NextFunction } from "express";
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
export declare class AppError extends Error {
    readonly code: string;
    readonly statusCode: number;
    readonly details?: unknown | undefined;
    constructor(message: string, code: string, statusCode?: number, details?: unknown | undefined);
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
export declare function errorHandler(err: Error, _req: Request, res: Response, _next: NextFunction): void;
//# sourceMappingURL=errors.d.ts.map