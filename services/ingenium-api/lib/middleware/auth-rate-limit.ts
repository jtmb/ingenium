import type { NextFunction, Request, Response } from "express";

const WINDOW_MS = 60_000;
const MAX_ATTEMPTS = 5;
const MAX_TRACKED_KEYS = 10_000;
const ipEntries = new Map<string, { count: number; resetAt: number }>();
const accountEntries = new Map<string, { count: number; resetAt: number }>();
const oidcStartEntries = new Map<string, { count: number; resetAt: number }>();
const oidcCallbackEntries = new Map<string, { count: number; resetAt: number }>();

function makeRoom(entries: Map<string, { count: number; resetAt: number }>, now: number): void {
  if (entries.size < MAX_TRACKED_KEYS) return;
  for (const [key, entry] of entries) if (entry.resetAt <= now) entries.delete(key);
  while (entries.size >= MAX_TRACKED_KEYS) entries.delete(entries.keys().next().value!);
}

function limited(entries: Map<string, { count: number; resetAt: number }>, key: string, now: number): number | undefined {
  const current = entries.get(key);
  if (!current || current.resetAt <= now) {
    if (!current) makeRoom(entries, now);
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

function rateLimitedResponse(res: Response, resetAt: number, now: number): void {
  res.set("Retry-After", String(Math.ceil((resetAt - now) / 1000)));
  res.status(429).json({ error: { code: "RATE_LIMITED", message: "Too many authentication attempts", details: null, requestId: "req_auth" } });
}

export function enforceOidcRateLimit(
  req: Request,
  res: Response,
  phase: "start" | "callback",
  providerId: string | undefined,
): boolean {
  const now = Date.now();
  const entries = phase === "start" ? oidcStartEntries : oidcCallbackEntries;
  const resetAt = limited(entries, `${req.ip ?? "unknown"}\u0000${providerId ?? "unknown"}`, now);
  if (resetAt === undefined) return true;
  rateLimitedResponse(res, resetAt, now);
  return false;
}

export function oidcStartRateLimit(req: Request, res: Response, next: NextFunction): void {
  if (enforceOidcRateLimit(req, res, "start", typeof req.body?.providerId === "string" ? req.body.providerId : undefined)) next();
}

export function clearAuthAttemptRateLimit(): void {
  ipEntries.clear();
  accountEntries.clear();
  oidcStartEntries.clear();
  oidcCallbackEntries.clear();
}
