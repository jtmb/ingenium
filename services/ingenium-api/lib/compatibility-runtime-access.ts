import { createHash, randomBytes } from "node:crypto";
import type { Request, Response } from "express";
import { authorization, getDb } from "ingenium-core";
import { AppError } from "./middleware/errors.js";
import { deploymentMode } from "./runtime-mode.js";

type Audience = "web" | "cli" | "vscode";
type Grant = { sessionId: string; userId: string; host: string; expires: number };
const pending = new Map<string, Grant>();
const sessions = new Map<string, Grant>();
const COOKIE = "__Host-ingenium_runtime";
const hash = (value: string) => createHash("sha256").update(value).digest("hex");
const validToken = (value: unknown): value is string => typeof value === "string" && /^[A-Za-z0-9_-]{43}$/.test(value);

function domain(): string {
  const value = process.env.INGENIUM_COMPATIBILITY_RUNTIME_ROOT_DOMAIN?.trim().toLowerCase() ?? "";
  if (deploymentMode() !== "compatibility" || !/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/.test(value)
    || !value.includes(".") || value.includes("..") || value.endsWith(".localhost")) {
    throw new AppError("LAN runtime access is not configured", "NOT_FOUND", 404);
  }
  return value;
}

function prune(map: Map<string, Grant>, limit: number): void {
  for (const [key, grant] of map) if (grant.expires <= Date.now()) map.delete(key);
  if (map.size >= limit) map.delete(map.keys().next().value!);
}

function alive(grant: Grant): boolean {
  if (grant.expires <= Date.now()) return false;
  const row = getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
    `SELECT s.id FROM auth_sessions s JOIN users u ON u.id = s.user_id
     WHERE s.id = ? AND s.user_id = ? AND s.revoked_at IS NULL AND u.status = 'active'
       AND s.security_epoch = u.security_epoch
       AND julianday(s.idle_expires_at) > julianday(?)
       AND julianday(s.absolute_expires_at) > julianday(?)`,
  ).get(grant.sessionId, grant.userId, new Date().toISOString(), new Date().toISOString());
  return Boolean(row) && authorization.isInstallationAdmin(grant.userId);
}

function requestHost(req: Request): string {
  const host = req.get("host") ?? "";
  const root = domain();
  if (!["opencode", "cli", "vscode"].some((name) => host === `${name}.${root}`)) {
    throw new AppError("Runtime audience is unavailable", "NOT_FOUND", 404);
  }
  return host;
}

/** Issue only a short-lived, audience-bound proof from the administrator dashboard. */
export function issueCompatibilityLaunch(req: Request, res: Response): void {
  const root = domain();
  const principal = req.principal;
  if (principal?.type !== "user" || !principal.session || !authorization.isInstallationAdmin(principal.id)) {
    throw new AppError("Installation administrator access is required", "FORBIDDEN", 403);
  }
  const audience = req.body?.audience as Audience;
  if (req.get("origin") !== `https://${root}` || !["web", "cli", "vscode"].includes(audience)
    || !validToken(req.body?.exchangeProof) || Object.keys(req.body).some((key) => !["audience", "exchangeProof"].includes(key))) {
    throw new AppError("Invalid LAN runtime launch", "VALIDATION_ERROR", 422);
  }
  const host = `${audience === "web" ? "opencode" : audience}.${root}`;
  const key = hash(req.body.exchangeProof);
  if (pending.has(key)) throw new AppError("Launch proof already issued", "CONFLICT", 409);
  prune(pending, 256);
  pending.set(key, { sessionId: principal.session.id, userId: principal.id, host, expires: Date.now() + 60_000 });
  res.set("Cache-Control", "no-store");
  res.status(201).json({ data: { status: "ready", launchUrl: `https://${host}/__ingenium/exchange` } });
}

/** Public exchange accepts a single proof, never a dashboard session or password. */
export function exchangeCompatibilityLaunch(req: Request, res: Response): void {
  const host = requestHost(req);
  if (req.get("origin") !== `https://${domain()}` || !validToken(req.body?.proof)
    || Object.keys(req.body).some((key) => key !== "proof")) {
    throw new AppError("Invalid launch proof", "UNAUTHORIZED", 401);
  }
  const key = hash(req.body.proof);
  const grant = pending.get(key);
  if (!grant || grant.host !== host || !alive(grant)) throw new AppError("Launch proof expired", "UNAUTHORIZED", 401);
  pending.delete(key);
  const token = randomBytes(32).toString("base64url");
  prune(sessions, 1024);
  sessions.set(hash(token), { ...grant, expires: Date.now() + 30 * 60_000 });
  res.set("Cache-Control", "no-store");
  res.set("Set-Cookie", `${COOKIE}=${token}; Path=/; Secure; HttpOnly; SameSite=Strict; Max-Age=1800`);
  res.status(204).end();
}

/** Nginx calls this before every HTTP request and WebSocket upgrade. */
function resolvedCompatibilityAccess(req: Request): boolean {
  const host = requestHost(req);
  const token = req.headers.cookie?.split(";").map((entry) => entry.trim())
    .find((entry) => entry.startsWith(COOKIE + "="))?.slice(COOKIE.length + 1);
  const grant = validToken(token) ? sessions.get(hash(token)) : undefined;
  return Boolean(grant && grant.host === host && alive(grant));
}

/** Only a fully validated grant on the exact access probe gets the runtime read budget. */
export function isAuthenticatedCompatibilityRuntimeAccess(req: Request): boolean {
  if (req.method !== "GET" || req.path !== "/api/v1/auth/lan-runtime/access" || req.originalUrl !== req.path) return false;
  try { return resolvedCompatibilityAccess(req); } catch { return false; }
}

export function validateCompatibilityAccess(req: Request, res: Response): void {
  if (!resolvedCompatibilityAccess(req)) throw new AppError("Launch this workspace from Ingenium", "UNAUTHORIZED", 401);
  res.set("Cache-Control", "no-store");
  res.status(204).end();
}
