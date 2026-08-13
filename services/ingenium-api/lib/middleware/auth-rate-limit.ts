import type { NextFunction, Request, Response } from "express";

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 5;
const ipEntries = new Map<string, { count: number; resetAt: number }>();
const accountEntries = new Map<string, { count: number; resetAt: number }>();

function limited(entries: Map<string, { count: number; resetAt: number }>, key: string, now: number): number | undefined {
  const current = entries.get(key);
  if (!current || current.resetAt <= now) {
    entries.set(key, { count: 1, resetAt: now + WINDOW_MS });
    return undefined;
  }
  current.count += 1;
  return current.count > MAX_ATTEMPTS ? current.resetAt : undefined;
}

export function authAttemptRateLimit(req: Request, res: Response, next: NextFunction): void {
  const now = Date.now();
  const email = typeof req.body?.email === "string" ? req.body.email.toLowerCase() : "unknown";
  const ipReset = limited(ipEntries, req.ip ?? "unknown", now);
  const accountReset = limited(accountEntries, email, now);
  const resetAt = ipReset ?? accountReset;
  if (resetAt === undefined) {
    next();
    return;
  }
  res.set("Retry-After", String(Math.ceil((resetAt - now) / 1000)));
  res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many authentication attempts", details: null, requestId: "req_auth" } });
}

export function clearAuthAttemptRateLimit(): void {
  ipEntries.clear();
  accountEntries.clear();
}
