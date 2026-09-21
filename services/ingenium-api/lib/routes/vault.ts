import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import * as core from "ingenium-core";
import { requireProject } from "../helpers.js";
import { vaultBruteForceLimiter } from "../middleware/rate-limit.js";
import {
  recoverServerGlobalProviderMetadata,
  rehydrateServerGlobalProviderConnections,
} from "../server-global-provider-persistence.js";
import { toAuthorizationPrincipal } from "../authorization-policy.js";

/** Signature that matches the actual vault module in ingenium-core. */
type VaultService = {
  initVault(projectId: string, passphrase: string): void;
  validateVaultPassphrase(passphrase: string): { ok: true } | { ok: false; error: string };
  initializeVault(projectId: string, passphrase: string, confirmation: string): { ok: boolean; error?: string };
  unsealVault(projectId: string, passphrase: string): { ok: boolean; error?: string };
  sealVault(): void;
  isSealed(): boolean;
  getEmptyVaultResetEligibility(): core.vault.EmptyVaultResetEligibility;
  resetEmptyVaultInitialization(projectId: string, actor: core.vault.VaultActor): core.vault.EmptyVaultResetResult;
  createItem(
    projectId: string,
    name: string,
    type: string,
    value: string,
    folderId?: string,
    tags?: string[],
    urls?: string[],
    username?: string,
    ownership?: core.vault.VaultOwnership,
    actor?: core.vault.VaultActor,
  ): string;
  getItemMetadata(projectId: string, itemId: string): object | null;
  decryptItem(projectId: string, itemId: string, actor?: core.vault.VaultActor): string | null;
  listItems(projectId: string, folderId?: string): object[];
  updateItem(projectId: string, itemId: string, value: string, actor?: core.vault.VaultActor): void;
  updateItemMetadata(projectId: string, itemId: string, updates: {
    name?: string;
    type?: string;
    folderId?: string | null;
    tags?: string[];
    urls?: string[];
    username?: string | null;
  }, actor?: core.vault.VaultActor): boolean;
  deleteItem(projectId: string, itemId: string, actor?: core.vault.VaultActor): void;
  logAudit(projectId: string, eventType: string, itemId: string | null, actor: core.vault.VaultActor | string, details: object): void;
  generatePassword(length?: number): string;
};

const vault = (core as unknown as { vault?: VaultService }).vault;

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function dbPath(): string {
  return process.env.INGENIUM_CORE_DB_PATH ?? "./data";
}

/** True when a vault_config row exists (vault has been initialized at least once). */
function vaultConfigExists(): boolean {
  try {
    const db = core.getDb(dbPath());
    return !!db.prepare("SELECT 1 FROM vault_config WHERE id = 1").get();
  } catch {
    return false;
  }
}

function unavailable(res: Response): boolean {
  if (vault) return false;
  res.status(503).json({ error: { code: "VAULT_UNAVAILABLE", message: "Vault module not available" } });
  return true;
}

function vaultActor(req: Request): core.vault.VaultActor {
  const principal = req.principal;
  if (!principal) return { type: "system" };
  return {
    type: principal.type === "runtime-service" ? "system" : principal.type,
    id: principal.id,
    requestId: typeof req.headers["x-request-id"] === "string" ? req.headers["x-request-id"] : undefined,
  };
}

function requestedOwnership(req: Request, projectId: string): core.vault.VaultOwnership | null {
  const project = core.getDb(dbPath()).prepare("SELECT organization_id FROM projects WHERE id = ?").get(projectId) as { organization_id: string } | undefined;
  if (!project) return null;
  const ownerKind = req.body?.owner_kind === "user" ? "user" : "organization";
  const ownerUserId = ownerKind === "user" ? req.principal?.type === "user" ? req.principal.id : null : null;
  if (ownerKind === "user" && !ownerUserId) return null;
  return { organizationId: project.organization_id, ownerKind, ownerUserId };
}

function authorizeVaultResource(req: Request, row: { id: string; organization_id: string; owner_kind: "user" | "organization"; owner_user_id: string | null }, permission?: core.authorization.AuthorizationPermission): boolean {
  if (!req.principal) return false;
  return core.authorization.requireOwnedResourcePermission(toAuthorizationPrincipal(req.principal), {
    resourceType: "vault_item",
    resourceId: row.id,
    organizationId: row.organization_id,
    ownerKind: row.owner_kind,
    ownerUserId: row.owner_user_id,
  }, permission ?? req.authorizationPolicy?.permission ?? "read").allowed;
}

function ownedVaultItem(req: Request, projectId: string, itemId: string, permission?: core.authorization.AuthorizationPermission) {
  const row = core.getDb(dbPath()).prepare(
    `SELECT id, organization_id, owner_kind, owner_user_id FROM vault_items
     WHERE project_id = ? AND id = ? AND access_policy <> ?`,
  ).get(projectId, itemId, '{"mode":"deleted"}') as { id: string; organization_id: string; owner_kind: "user" | "organization"; owner_user_id: string | null } | undefined;
  return row && authorizeVaultResource(req, row, permission) ? row : undefined;
}

function stringList(value: unknown): string[] | undefined {
  if (Array.isArray(value)) return value.filter((entry): entry is string => typeof entry === "string");
  if (typeof value !== "string") return undefined;
  return value.split(/[\s,]+/).map((entry) => entry.trim()).filter(Boolean);
}

function serializeItem(item: any): object {
  const parseList = (value: unknown): string => {
    if (typeof value !== "string") return "";
    try {
      const parsed = JSON.parse(value);
      return Array.isArray(parsed) ? parsed.join(", ") : value;
    } catch {
      return value;
    }
  };
  return {
    id: item.id,
    name: item.name,
    type: item.type,
    folder_id: item.folderId ?? item.folder_id ?? null,
    tags: parseList(item.tags),
    urls: parseList(item.urls),
    username: item.username ?? null,
    version: item.version,
    created_at: item.created_at,
    updated_at: item.updated_at,
    last_accessed_at: item.last_accessed_at ?? null,
    access_count: item.access_count,
    organization_id: item.organizationId ?? item.organization_id,
    owner_kind: item.ownerKind ?? item.owner_kind,
    owner_user_id: item.ownerUserId ?? item.owner_user_id ?? null,
    effective_capabilities: ["read", "write", "reveal"],
  };
}

// ---------------------------------------------------------------------------
// Guard middleware — replaces vault-gate.ts inline so we can distinguish
// "not initialized" from "sealed" without editing a separate file.
// ---------------------------------------------------------------------------

const GUARD_EXEMPT = new Set(["/initialize", "/unseal", "/seal", "/status"]);

function vaultGuard(req: Request, res: Response, next: NextFunction): void {
  if (GUARD_EXEMPT.has(req.path)) {
    next();
    return;
  }

  if (!vault) {
    res.status(503).json({ error: { code: "VAULT_UNAVAILABLE", message: "Vault module not available" } });
    return;
  }

  if (!vaultConfigExists()) {
    res.status(409).json({
      error: {
        code: "VAULT_NOT_INITIALIZED",
        message: "Vault has not been initialized. Create it with POST /vault/initialize.",
      },
    });
    return;
  }

  if (vault.isSealed()) {
    res.status(503).json({ error: { code: "VAULT_SEALED", message: "Vault is sealed" } });
    return;
  }

  next();
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

export const vaultRouter = Router();

/* ----  Status  ---------------------------------------------------------- */

vaultRouter.get("/status", (req, res) => {
  if (unavailable(res)) return;
  const projectId = requireProject(req, res);
  if (!projectId) return;

  if (!vaultConfigExists()) {
    res.json({ data: { sealed: true, initialized: false, nextAction: "initialize" } });
    return;
  }

  let itemCount = 0;
  let folderCount = 0;
  try {
    const db = core.getDb(dbPath());
    const principal = req.principal;
    const rows = db.prepare(
      `SELECT id, organization_id, owner_kind, owner_user_id FROM vault_items
       WHERE project_id = ? AND access_policy <> ?`,
    ).all(projectId, '{"mode":"deleted"}') as Array<{ id: string; organization_id: string; owner_kind: "user" | "organization"; owner_user_id: string | null }>;
    itemCount = rows.filter((row) => authorizeVaultResource(req, row)).length;
    const folders = db.prepare(
      "SELECT id, organization_id, owner_kind, owner_user_id FROM vault_folders WHERE project_id = ?",
    ).all(projectId) as Array<{ id: string; organization_id: string; owner_kind: "user" | "organization"; owner_user_id: string | null }>;
    folderCount = folders.filter((row) => principal && core.authorization.requireOwnedResourcePermission(toAuthorizationPrincipal(principal), {
      resourceType: "vault_folder",
      resourceId: row.id,
      organizationId: row.organization_id,
      ownerKind: row.owner_kind,
      ownerUserId: row.owner_user_id,
    }, "read").allowed).length;
  } catch {
    // stats are best-effort
  }

  res.json({
    data: {
      sealed: vault!.isSealed(),
      initialized: true,
      nextAction: vault!.isSealed() ? "unseal" : null,
      stats: { itemCount, folderCount },
    },
  });
});

/* ----  Initialize / Unseal / Seal  -------------------------------------- */

vaultRouter.post("/initialize", vaultBruteForceLimiter, (req, res) => {
  if (unavailable(res)) return;
  const projectId = requireProject(req, res);
  if (!projectId) return;

  if (vaultConfigExists()) {
    res.status(409).json({ error: { code: "ALREADY_INITIALIZED", message: "Vault is already initialized" } });
    return;
  }

  const passphrase = req.body?.password ?? req.body?.passphrase;
  const confirmation = req.body?.confirmation ?? req.body?.passwordConfirmation;
  if (typeof passphrase !== "string" || passphrase.length === 0) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "password is required" } });
    return;
  }
  if (typeof confirmation !== "string") {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "confirmation is required" } });
    return;
  }
  const validation = vault!.validateVaultPassphrase(passphrase);
  if (!validation.ok) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: validation.error } });
    return;
  }

  const result = vault!.initializeVault(projectId, passphrase, confirmation);
  if (!result.ok) {
    const status = result.error === "Vault is already initialized" ? 409 : 422;
    res.status(status).json({ error: { code: "VAULT_ERROR", message: result.error } });
    return;
  }

  res.status(201).json({ data: { ok: true, unsealed: true } });
});

vaultRouter.post("/unseal", vaultBruteForceLimiter, (req, res) => {
  if (unavailable(res)) return;
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const passphrase = req.body?.password ?? req.body?.passphrase;
  if (typeof passphrase !== "string" || passphrase.trim().length === 0) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "password is required" } });
    return;
  }

  // Dashboard must use POST /initialize for first-run creation — do not auto-init from UI
  if (req.headers["x-ingenium-ui"] === "dashboard" && !vaultConfigExists()) {
    res.status(409).json({ error: { code: "VAULT_NOT_INITIALIZED", message: "Vault has not been created yet. Use /vault/initialize first." } });
    return;
  }

  // Auto-initialize when vault_config does not exist yet for MCP compatibility.
  // This must use the same creation policy as the dashboard, because it
  // establishes the service-wide master-key configuration.
  if (!vaultConfigExists()) {
    const validation = vault!.validateVaultPassphrase(passphrase);
    if (!validation.ok) {
      res.status(422).json({ error: { code: "VALIDATION_ERROR", message: validation.error } });
      return;
    }
    vault!.initVault(projectId, passphrase);
  }

  const result = vault!.unsealVault(projectId, passphrase);
  if (!result.ok) {
    const status = result.error === "Vault is not initialized" ? 503 : 403;
    res.status(status).json({ error: { code: "VAULT_SEALED", message: result.error ?? "Unseal failed" } });
    return;
  }

  const migration = recoverServerGlobalProviderMetadata();
  void rehydrateServerGlobalProviderConnections().then((rehydration) => {
    core.logger.info("vault", "Server-global provider rehydration completed", { migration, rehydration });
  }).catch(() => {
    core.logger.warn("vault", "Server-global provider rehydration failed safely");
  });
  res.json({ data: { ...result, unsealed: result.ok } });
});

vaultRouter.post("/seal", (req, res) => {
  if (unavailable(res)) return;
  const projectId = requireProject(req, res);
  if (!projectId) return;

  vault!.sealVault();
  vault!.logAudit(projectId, "vault_sealed", null, vaultActor(req), {});
  res.json({ data: { ok: true } });
});

function emptyResetReason(eligibility: core.vault.EmptyVaultResetEligibility): string {
  if (!eligibility.initialized) return "The vault is not initialized.";
  if (eligibility.blockers.includes("vault_unsealed")) {
    return "Enter your current passphrase to continue, or lock the vault before checking reset eligibility.";
  }
  return "Protected provider or vault dependencies still exist. Enter the current passphrase, or remove/reconfigure those dependencies before trying again.";
}

const EMPTY_VAULT_RESET_CONFIRMATION = "RESET EMPTY VAULT";

vaultRouter.get("/empty-reset", (req, res) => {
  if (unavailable(res)) return;
  if (!requireProject(req, res)) return;
  try {
    const eligibility = vault!.getEmptyVaultResetEligibility();
    res.json({ data: { eligible: eligibility.eligible, reason: eligibility.eligible ? null : emptyResetReason(eligibility) } });
  } catch {
    res.status(503).json({
      error: {
        code: "VAULT_RESET_CHECK_FAILED",
        message: "Vault reset eligibility could not be verified. No changes were made.",
      },
    });
  }
});

vaultRouter.post("/empty-reset", (req, res) => {
  if (unavailable(res)) return;
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!req.body || typeof req.body !== "object" || Array.isArray(req.body)
    || Object.keys(req.body).length !== 1
    || req.body.confirmation !== EMPTY_VAULT_RESET_CONFIRMATION) {
    res.status(422).json({
      error: {
        code: "VALIDATION_ERROR",
        message: `confirmation must equal '${EMPTY_VAULT_RESET_CONFIRMATION}'`,
      },
    });
    return;
  }
  try {
    const result = vault!.resetEmptyVaultInitialization(projectId, vaultActor(req));
    if (result.status === "reset") {
      res.json({ data: { reset: true, initialized: false } });
      return;
    }
    if (result.status === "not_initialized") {
      res.status(409).json({ error: { code: "VAULT_NOT_INITIALIZED", message: "The vault is not initialized." } });
      return;
    }
    if (result.status === "concurrent_change") {
      res.status(409).json({
        error: {
          code: "VAULT_RESET_CONFLICT",
          message: "Vault data changed during the reset check. No changes were made; verify eligibility and try again.",
        },
      });
      return;
    }
    res.status(409).json({
      error: { code: "VAULT_RESET_BLOCKED", message: emptyResetReason(result.eligibility) },
    });
  } catch {
    res.status(503).json({
      error: {
        code: "VAULT_RESET_CHECK_FAILED",
        message: "Vault reset eligibility could not be verified. No changes were made.",
      },
    });
  }
});

/* ----  Guarded routes (require initialized + unsealed)  ----------------- */

vaultRouter.use(vaultGuard);

/* ----  Folders  --------------------------------------------------------- */

vaultRouter.get("/folders", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const rows = core.getDb(dbPath()).prepare(
    `SELECT f.id, f.name, f.created_at, f.organization_id, f.owner_kind, f.owner_user_id
     FROM vault_folders f
     WHERE f.project_id = ?
     ORDER BY f.name`,
  ).all(projectId) as Array<{ id: string; name: string; created_at: string; organization_id: string; owner_kind: "user" | "organization"; owner_user_id: string | null }>;
  const principal = req.principal;
  const folders = rows.filter((row) => principal && core.authorization.requireOwnedResourcePermission(toAuthorizationPrincipal(principal), {
    resourceType: "vault_folder",
    resourceId: row.id,
    organizationId: row.organization_id,
    ownerKind: row.owner_kind,
    ownerUserId: row.owner_user_id,
  }, "read").allowed).map((row) => ({
    id: row.id,
    name: row.name,
    created_at: row.created_at,
    owner_kind: row.owner_kind,
    item_count: (vault!.listItems(projectId, row.id) as Array<Record<string, unknown>>).filter((item) => authorizeVaultResource(req, {
      id: item.id as string,
      organization_id: item.organizationId as string,
      owner_kind: item.ownerKind as "user" | "organization",
      owner_user_id: item.ownerUserId as string | null,
    })).length,
  }));
  res.json({ data: folders });
});

vaultRouter.post("/folders", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const { name } = req.body;
  if (typeof name !== "string" || !name.trim()) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "name is required" } });
    return;
  }

  const id = crypto.randomUUID();
  const now = new Date().toISOString();
  const ownership = requestedOwnership(req, projectId);
  if (!ownership) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "A user owner requires a user principal" } });
    return;
  }
  const actor = vaultActor(req);
  const db = core.getDb(dbPath());
  core.execTransaction(() => db.prepare(
    `INSERT INTO vault_folders
     (id, project_id, organization_id, owner_kind, owner_user_id, name, created_by_actor_type, created_by_actor_id, created_at, updated_at)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(id, projectId, ownership.organizationId, ownership.ownerKind, ownership.ownerUserId ?? null,
    name.trim(), actor.type, actor.id ?? null, now, now));
  core.checkpointAfterWrite();
  vault!.logAudit(projectId, "folder_created", id, actor, {});
  res.status(201).json({ data: { id, name: name.trim(), item_count: 0, owner_kind: ownership.ownerKind, created_at: now } });
});

vaultRouter.delete("/folders/:id", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const db = core.getDb(dbPath());
  const row = db.prepare("SELECT id, organization_id, owner_kind, owner_user_id FROM vault_folders WHERE id = ? AND project_id = ?")
    .get(req.params.id!, projectId) as { id: string; organization_id: string; owner_kind: "user" | "organization"; owner_user_id: string | null } | undefined;
  const allowed = row && req.principal && core.authorization.requireOwnedResourcePermission(toAuthorizationPrincipal(req.principal), {
    resourceType: "vault_folder", resourceId: row.id, organizationId: row.organization_id, ownerKind: row.owner_kind, ownerUserId: row.owner_user_id,
  }, "write").allowed;
  const result = allowed ? db.prepare("DELETE FROM vault_folders WHERE id = ? AND project_id = ?").run(req.params.id!, projectId) : { changes: 0 };
  if (result.changes === 0) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Folder not found" } });
    return;
  }
  vault!.logAudit(projectId, "folder_deleted", req.params.id!, vaultActor(req), {});
  res.status(204).send();
});

/* ----  Items (CRUD)  ---------------------------------------------------- */

vaultRouter.get("/items", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const folderId = typeof req.query.folder_id === "string"
    ? req.query.folder_id
    : typeof req.query.folder === "string" ? req.query.folder : undefined;
  const items = vault!.listItems(projectId, folderId).filter((item) => authorizeVaultResource(req, {
    id: (item as any).id,
    organization_id: (item as any).organizationId,
    owner_kind: (item as any).ownerKind,
    owner_user_id: (item as any).ownerUserId,
  })).map(serializeItem);
  res.json({ data: items, total: items.length });
});

vaultRouter.post("/items", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const { name, type, value, username } = req.body;
  const folderId = req.body.folderId ?? req.body.folder_id;
  const tags = stringList(req.body.tags);
  const urls = stringList(req.body.urls);
  if (typeof name !== "string" || typeof type !== "string" || typeof value !== "string") {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "name, type, and value are required" } });
    return;
  }

  const ownership = requestedOwnership(req, projectId);
  if (!ownership) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "A user owner requires a user principal" } });
    return;
  }
  const id = vault!.createItem(projectId, name, type, value, folderId, tags, urls, username, ownership, vaultActor(req));
  res.status(201).json({ data: { id } });
});

vaultRouter.get("/items/:id", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const item = ownedVaultItem(req, projectId, req.params.id!) ? vault!.getItemMetadata(projectId, req.params.id!) : null;
  if (!item) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Vault item not found" } });
    return;
  }
  res.json({ data: serializeItem(item) });
});

vaultRouter.post("/items/:id/reveal", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const plaintext = ownedVaultItem(req, projectId, req.params.id!) ? vault!.decryptItem(projectId, req.params.id!, vaultActor(req)) : null;
  if (plaintext === null) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Vault item not found" } });
    return;
  }

  res.set("Cache-Control", "no-store");
  res.set("X-Content-Duration", "30");
  res.json({ data: { value: plaintext } });
});

vaultRouter.put("/items/:id", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const { value } = req.body;
  if (typeof value !== "string") {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "value is required" } });
    return;
  }

  if (!ownedVaultItem(req, projectId, req.params.id!, "write")) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Vault item not found" } });
    return;
  }
  vault!.updateItem(projectId, req.params.id!, value, vaultActor(req));
  res.json({ data: { ok: true } });
});

vaultRouter.patch("/items/:id", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const { name, type, username } = req.body ?? {};
  if (name !== undefined && (typeof name !== "string" || !name.trim())) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "name must be a non-empty string" } });
    return;
  }
  const changed = Boolean(ownedVaultItem(req, projectId, req.params.id!, "write")) && vault!.updateItemMetadata(projectId, req.params.id!, {
    name: typeof name === "string" ? name.trim() : undefined,
    type: typeof type === "string" ? type : undefined,
    folderId: req.body.folder_id === null || typeof req.body.folder_id === "string" ? req.body.folder_id : undefined,
    tags: stringList(req.body.tags),
    urls: stringList(req.body.urls),
    username: username === null || typeof username === "string" ? username : undefined,
  }, vaultActor(req));
  if (!changed) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Vault item not found" } });
    return;
  }
  res.json({ data: serializeItem(vault!.getItemMetadata(projectId, req.params.id!)) });
});

vaultRouter.post("/items/:id/rotate", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!ownedVaultItem(req, projectId, req.params.id!, "write")) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Vault item not found" } });
    return;
  }
  const password = vault!.generatePassword();
  vault!.updateItem(projectId, req.params.id!, password, vaultActor(req));
  res.set("Cache-Control", "no-store");
  res.json({ data: { value: password } });
});

vaultRouter.delete("/items/:id", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  if (!ownedVaultItem(req, projectId, req.params.id!, "write")) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Vault item not found" } });
    return;
  }
  vault!.deleteItem(projectId, req.params.id!, vaultActor(req));
  res.status(204).send();
});

/* ----  Utilities  ------------------------------------------------------- */

vaultRouter.post("/generate-password", (req, res) => {
  const length = typeof req.body?.length === "number" ? req.body.length : undefined;
  res.json({ data: { password: vault!.generatePassword(length) } });
});

vaultRouter.post("/password/generate", (req, res) => {
  const length = typeof req.body?.length === "number" ? req.body.length : undefined;
  res.json({ data: { password: vault!.generatePassword(length) } });
});

vaultRouter.get("/audit", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const db = core.getDb(dbPath());
  // Do not return free-form audit details. This prevents historical or future
  // caller mistakes from reflecting secret material through an audit read.
  const logs = (db
    .prepare(
      `SELECT audit.id, audit.event_type, audit.item_id, audit.actor, audit.created_at,
              item.organization_id, item.owner_kind, item.owner_user_id
       FROM vault_audit_log audit
       LEFT JOIN vault_items item ON item.id = audit.item_id AND item.project_id = audit.project_id
       WHERE audit.project_id = ? ORDER BY audit.created_at DESC`,
    )
    .all(projectId) as Array<{ id: string; event_type: string; item_id: string | null; actor: string; created_at: string; organization_id: string | null; owner_kind: "user" | "organization" | null; owner_user_id: string | null }>).filter((row) => !row.item_id || (row.organization_id && row.owner_kind && authorizeVaultResource(req, {
      id: row.item_id,
      organization_id: row.organization_id,
      owner_kind: row.owner_kind,
      owner_user_id: row.owner_user_id,
    }))).map(({ organization_id: _organizationId, owner_kind: _ownerKind, owner_user_id: _ownerUserId, ...row }) => row);
  res.json({ data: logs, total: logs.length });
});
