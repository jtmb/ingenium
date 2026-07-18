import { Router } from "express";
import type { NextFunction, Request, Response } from "express";
import * as core from "ingenium-core";
import { requireProject } from "../helpers.js";

/** Signature that matches the actual vault module in ingenium-core. */
type VaultService = {
  initVault(projectId: string, passphrase: string): void;
  initializeVault(projectId: string, passphrase: string, confirmation: string): { ok: boolean; error?: string };
  unsealVault(projectId: string, passphrase: string): { ok: boolean; error?: string };
  sealVault(): void;
  isSealed(): boolean;
  createItem(
    projectId: string,
    name: string,
    type: string,
    value: string,
    folderId?: string,
    tags?: string[],
    urls?: string[],
    username?: string,
  ): string;
  getItemMetadata(projectId: string, itemId: string): object | null;
  decryptItem(projectId: string, itemId: string): string | null;
  listItems(projectId: string, folderId?: string): object[];
  updateItem(projectId: string, itemId: string, value: string): void;
  updateItemMetadata(projectId: string, itemId: string, updates: {
    name?: string;
    type?: string;
    folderId?: string | null;
    tags?: string[];
    urls?: string[];
    username?: string | null;
  }): boolean;
  deleteItem(projectId: string, itemId: string): void;
  logAudit(projectId: string, eventType: string, itemId: string | null, actor: string, details: object): void;
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

function audit(projectId: string, operation: string, itemId?: string): void {
  vault?.logAudit(projectId, operation, itemId ?? null, "system", {});
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
    ...item,
    folder_id: item.folderId ?? item.folder_id ?? null,
    tags: parseList(item.tags),
    urls: parseList(item.urls),
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

  if (!vault || !vaultConfigExists()) {
    res.status(503).json({ error: { code: "VAULT_SEALED", message: "Vault not initialized" } });
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
    res.json({ data: { sealed: true, initialized: false } });
    return;
  }

  // Basic stats computed inline so we don't depend on vault helpers that may
  // not exist on the core module.
  let itemCount = 0;
  let folderCount = 0;
  try {
    const db = core.getDb(dbPath());
    itemCount = (
      db.prepare(
        "SELECT count(*) as c FROM vault_items WHERE project_id = ? AND access_policy <> ?",
      ).get(projectId, '{"mode":"deleted"}') as { c: number }
    )?.c ?? 0;
    folderCount = (
      db.prepare("SELECT count(*) as c FROM vault_folders WHERE project_id = ?").get(projectId) as { c: number }
    )?.c ?? 0;
  } catch {
    // stats are best-effort
  }

  res.json({
    data: { sealed: vault!.isSealed(), initialized: true, stats: { itemCount, folderCount } },
  });
});

/* ----  Initialize / Unseal / Seal  -------------------------------------- */

vaultRouter.post("/initialize", (req, res) => {
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

  const result = vault!.initializeVault(projectId, passphrase, confirmation);
  if (!result.ok) {
    const status = result.error === "Vault is already initialized" ? 409 : 422;
    res.status(status).json({ error: { code: "VAULT_ERROR", message: result.error } });
    return;
  }

  audit(projectId, "vault_unsealed");
  res.status(201).json({ data: { ok: true, unsealed: true } });
});

vaultRouter.post("/unseal", (req, res) => {
  if (unavailable(res)) return;
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const passphrase = req.body?.password ?? req.body?.passphrase;
  if (typeof passphrase !== "string" || passphrase.length === 0) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "password is required" } });
    return;
  }

  // Dashboard must use POST /initialize for first-run creation — do not auto-init from UI
  if (req.headers["x-ingenium-ui"] === "dashboard" && !vaultConfigExists()) {
    res.status(503).json({ error: { code: "VAULT_NOT_INITIALIZED", message: "Vault has not been created yet. Use /vault/initialize first." } });
    return;
  }

  // Auto-initialize when vault_config does not exist yet for MCP compatibility.
  if (!vaultConfigExists()) {
    vault!.initVault(projectId, passphrase);
  }

  const result = vault!.unsealVault(projectId, passphrase);
  if (!result.ok) {
    const status = result.error === "Vault is not initialized" ? 503 : 403;
    res.status(status).json({ error: { code: "VAULT_SEALED", message: result.error ?? "Unseal failed" } });
    return;
  }

  audit(projectId, "vault_unsealed");
  res.json({ data: { ...result, unsealed: result.ok } });
});

vaultRouter.post("/seal", (req, res) => {
  if (unavailable(res)) return;
  const projectId = requireProject(req, res);
  if (!projectId) return;

  vault!.sealVault();
  audit(projectId, "vault_sealed");
  res.json({ data: { ok: true } });
});

/* ----  Guarded routes (require initialized + unsealed)  ----------------- */

vaultRouter.use(vaultGuard);

/* ----  Folders  --------------------------------------------------------- */

vaultRouter.get("/folders", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const folders = core.getDb(dbPath()).prepare(
    `SELECT f.id, f.name, f.created_at, count(i.id) AS item_count
     FROM vault_folders f
     LEFT JOIN vault_items i ON i.folder_id = f.id AND i.project_id = f.project_id AND i.access_policy <> ?
     WHERE f.project_id = ?
     GROUP BY f.id, f.name, f.created_at
     ORDER BY f.name`,
  ).all('{"mode":"deleted"}', projectId);
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
  const db = core.getDb(dbPath());
  db.prepare(
    "INSERT INTO vault_folders (id, project_id, name, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, projectId, name.trim(), now, now);
  audit(projectId, "folder_created");
  res.status(201).json({ data: { id, name: name.trim(), item_count: 0, created_at: now } });
});

vaultRouter.delete("/folders/:id", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const db = core.getDb(dbPath());
  const result = db.prepare("DELETE FROM vault_folders WHERE id = ? AND project_id = ?").run(req.params.id!, projectId);
  if (result.changes === 0) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Folder not found" } });
    return;
  }
  audit(projectId, "folder_deleted", req.params.id!);
  res.status(204).send();
});

/* ----  Items (CRUD)  ---------------------------------------------------- */

vaultRouter.get("/items", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const folderId = typeof req.query.folder_id === "string"
    ? req.query.folder_id
    : typeof req.query.folder === "string" ? req.query.folder : undefined;
  const items = vault!.listItems(projectId, folderId).map(serializeItem);
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

  const id = vault!.createItem(projectId, name, type, value, folderId, tags, urls, username);
  audit(projectId, "secret_created", id);
  res.status(201).json({ data: { id } });
});

vaultRouter.get("/items/:id", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const item = vault!.getItemMetadata(projectId, req.params.id!);
  if (!item) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Vault item not found" } });
    return;
  }
  res.json({ data: serializeItem(item) });
});

vaultRouter.post("/items/:id/reveal", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const plaintext = vault!.decryptItem(projectId, req.params.id!);
  if (plaintext === null) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Vault item not found" } });
    return;
  }

  audit(projectId, "secret_revealed", req.params.id!);
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

  vault!.updateItem(projectId, req.params.id!, value);
  audit(projectId, "secret_updated", req.params.id!);
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
  const changed = vault!.updateItemMetadata(projectId, req.params.id!, {
    name: typeof name === "string" ? name.trim() : undefined,
    type: typeof type === "string" ? type : undefined,
    folderId: req.body.folder_id === null || typeof req.body.folder_id === "string" ? req.body.folder_id : undefined,
    tags: stringList(req.body.tags),
    urls: stringList(req.body.urls),
    username: username === null || typeof username === "string" ? username : undefined,
  });
  if (!changed) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Vault item not found" } });
    return;
  }
  res.json({ data: serializeItem(vault!.getItemMetadata(projectId, req.params.id!)) });
});

vaultRouter.post("/items/:id/rotate", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!vault!.getItemMetadata(projectId, req.params.id!)) {
    res.status(404).json({ error: { code: "NOT_FOUND", message: "Vault item not found" } });
    return;
  }
  const password = vault!.generatePassword();
  vault!.updateItem(projectId, req.params.id!, password);
  audit(projectId, "secret_rotated", req.params.id!);
  res.set("Cache-Control", "no-store");
  res.json({ data: { value: password } });
});

vaultRouter.delete("/items/:id", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  vault!.deleteItem(projectId, req.params.id!);
  audit(projectId, "secret_deleted", req.params.id!);
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
  const logs = db
    .prepare("SELECT * FROM vault_audit_log WHERE project_id = ? ORDER BY created_at DESC")
    .all(projectId);
  res.json({ data: logs });
});
