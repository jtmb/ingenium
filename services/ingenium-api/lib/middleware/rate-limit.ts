import { Request, Response, NextFunction } from "express";
import { config } from "../../config/index.js";

const requestCounts = new Map<string, { count: number; resetAt: number }>();

export function rateLimit(req: Request, res: Response, next: NextFunction): void {
  const ip = req.ip ?? "unknown";
  const now = Date.now();
  const entry = requestCounts.get(ip);

  if (!entry || now > entry.resetAt) {
    requestCounts.set(ip, { count: 1, resetAt: now + 60_000 });
    next();
    return;
  }

  entry.count++;
  if (entry.count > config.rateLimit) {
    res.set("Retry-After", String(Math.ceil((entry.resetAt - now) / 1000)));
    res.status(429).json({
      error: {
        code: "RATE_LIMITED",
        message: "Too many requests. Please wait before retrying.",
        details: null,
        requestId: `req_${Math.random().toString(36).slice(2, 10)}`,
      },
    });
    return;
  }

  next();
}
