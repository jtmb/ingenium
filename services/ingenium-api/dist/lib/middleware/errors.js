import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { logger } from "ingenium-core";
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
    // Unexpected error
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
