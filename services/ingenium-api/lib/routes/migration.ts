import { Router } from "express";
import { authentication, authorization, backups } from "ingenium-core";
import { constants, closeSync, fsyncSync, fstatSync, mkdirSync, openSync, readFileSync, renameSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { requireGlobalProject } from "../helpers.js";
import { AppError } from "../middleware/errors.js";

export const migrationRouter = Router();
export const MIGRATION_CHECKS = ["storage", "secrets", "models", "access", "restore", "features", "rollback"] as const;
export type MigrationPlan = { revision: number; target: { platform: "compose" | "kubernetes"; origin: string }; confirmed: string[]; updatedAt: string | null };
const emptyPlan = (): MigrationPlan => ({ revision: 0, target: { platform: "compose", origin: "" }, confirmed: [], updatedAt: null });
const planPath = () => join(dirname(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data"), "prd-migration-plan.json");

export function parseMigrationInput(body: unknown): Omit<MigrationPlan, "revision" | "updatedAt"> & { expectedRevision: number } | null {
  if (!body || typeof body !== "object" || Array.isArray(body)) return null;
  const value = body as Record<string, any>;
  if (Object.keys(value).sort().join(",") !== "confirmed,expectedRevision,target" || !Number.isSafeInteger(value.expectedRevision) || value.expectedRevision < 0 || value.expectedRevision >= Number.MAX_SAFE_INTEGER) return null;
  if (!value.target || typeof value.target !== "object" || Array.isArray(value.target) || Object.keys(value.target).sort().join(",") !== "origin,platform") return null;
  if (!["compose", "kubernetes"].includes(value.target.platform) || typeof value.target.origin !== "string" || value.target.origin.length > 254) return null;
  const origin = value.target.origin.trim();
  if (origin) {
    try {
      const url = new URL(origin);
      if (url.protocol !== "https:" || url.username || url.password || url.pathname !== "/" || url.search || url.hash || url.hostname === "localhost" || url.hostname.endsWith(".localhost")) return null;
      if (url.origin !== origin.replace(/\/$/, "")) return null;
    } catch { return null; }
  }
  if (!Array.isArray(value.confirmed) || value.confirmed.some((check: unknown) => typeof check !== "string" || !(MIGRATION_CHECKS as readonly string[]).includes(check)) || new Set(value.confirmed).size !== value.confirmed.length) return null;
  return { expectedRevision: value.expectedRevision, target: { platform: value.target.platform, origin: origin.replace(/\/$/, "") }, confirmed: value.confirmed };
}

function readPlan(): MigrationPlan {
  let fd: number | undefined;
  try {
    fd = openSync(planPath(), constants.O_RDONLY | constants.O_NOFOLLOW);
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > 8192 || (stat.mode & 0o077) !== 0) throw new Error("Invalid migration plan file");
    const value = JSON.parse(readFileSync(fd, "utf8"));
    const input = parseMigrationInput({ expectedRevision: value.revision, target: value.target, confirmed: value.confirmed });
    if (!input || (value.updatedAt !== null && (typeof value.updatedAt !== "string" || !Number.isFinite(Date.parse(value.updatedAt))))) throw new Error("Invalid migration plan");
    return { revision: input.expectedRevision, target: input.target, confirmed: input.confirmed, updatedAt: value.updatedAt };
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code === "ENOENT") return emptyPlan();
    throw new AppError("The saved migration plan needs operator repair", "MIGRATION_PLAN_UNAVAILABLE", 409);
  } finally { if (fd !== undefined) closeSync(fd); }
}

function inventory(projectId: string) {
  const snapshots = backups.listBackups(projectId);
  const latest = snapshots.find((backup) => backup.status === "completed" && (() => { try { return JSON.parse(backup.components).format === backups.BACKUP_BUNDLE_FORMAT; } catch { return false; } })());
  const verified = latest ? backups.validateRestorePreflight(projectId, latest.id).valid : false;
  const age = latest ? Date.now() - Date.parse(latest.created_at) : Infinity;
  return {
    sourceMode: process.env.INGENIUM_DEPLOYMENT_MODE === "control-plane" ? "control-plane" : "compatibility",
    backup: latest ? { id: latest.id, createdAt: latest.created_at, verified, fresh: verified && age >= 0 && age < 86400000 } : null,
    requiredTransfers: [
      { id: "ingenium-data", label: "Ingenium data volume", contents: "Core database, attachments, skills, vault ciphertext, authentication key, backup signing key and migration plan" },
      { id: "opencode-config", label: "OpenCode configuration volume", contents: "Provider and model definitions, defaults, plugins and managed configuration" },
      { id: "opencode-data", label: "OpenCode data volume", contents: "Chat database, provider sign-ins, Goal state and persistent runtime state" },
      { id: "workspace", label: "Workspace bind mounts", contents: "Every project repository, uncommitted file and external skill source; preserve container paths" },
      { id: "bootstrap", label: "Protected deployment files", contents: "API token, learning credential, OpenCode password, email encryption key, Compose overrides, trusted Cloudflare inventory and original model config" },
      { id: "optional", label: "Additional host resources", contents: "VS Code data, local model files and services, runtime-manager/gateway secrets, custom volumes and bind mounts from the actual deployment" },
    ],
    automaticTransferSupported: false,
    cutoverPerformed: false,
  };
}

migrationRouter.use((req, _res, next) => {
  if (req.principal?.type !== "user" || !req.principal.session || !authorization.isInstallationAdmin(req.principal.id)) throw new AppError("A browser installation administrator is required", "FORBIDDEN", 403);
  if (!["GET", "HEAD"].includes(req.method) && !authentication.hasRecentStepUp(req.principal.session)) throw new AppError("Recent step-up authentication is required", "STEP_UP_REQUIRED", 403);
  next();
});
migrationRouter.get("/", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const projectId = requireGlobalProject(req, res); if (!projectId) return;
  res.json({ data: { plan: readPlan(), inventory: inventory(projectId) } });
});
migrationRouter.put("/", (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const projectId = requireGlobalProject(req, res); if (!projectId) return;
  const input = parseMigrationInput(req.body);
  if (!input) { res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "Use a valid HTTPS PRD origin, platform, revision and preparation checklist" } }); return; }
  const current = readPlan();
  if (current.revision !== input.expectedRevision) { res.status(409).json({ error: { code: "REVISION_CONFLICT", message: "The plan changed. Refresh before saving." } }); return; }
  const targetChanged = current.target.origin !== input.target.origin || current.target.platform !== input.target.platform;
  const plan: MigrationPlan = { revision: current.revision + 1, target: input.target, confirmed: targetChanged ? [] : input.confirmed, updatedAt: new Date().toISOString() };
  const path = planPath(); const temp = `${path}.tmp`;
  let ownedTemp = false;
  try {
    mkdirSync(dirname(path), { recursive: true });
    const fd = openSync(temp, constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW, 0o600);
    ownedTemp = true;
    try { writeFileSync(fd, JSON.stringify(plan) + "\n"); fsyncSync(fd); } finally { closeSync(fd); }
    renameSync(temp, path); ownedTemp = false;
  } catch { throw new AppError("The migration plan could not be saved", "MIGRATION_PLAN_UNAVAILABLE", 503); }
  finally { if (ownedTemp) { try { unlinkSync(temp); } catch { /* Retain failed cleanup for operator repair. */ } } }
  res.json({ data: { plan, inventory: inventory(projectId) } });
});
