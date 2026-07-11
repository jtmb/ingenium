import { Request, Response, NextFunction } from "express";
import { randomUUID } from "node:crypto";
import { ZodError } from "zod";
import { logger } from "ingenium-core";

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

export function errorHandler(
  err: Error,
  _req: Request,
  res: Response,
  _next: NextFunction,
): void {
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
