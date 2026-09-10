import { Router } from "express";
import { settings, logger, projects, configs, getDb, execTransaction, checkpointAfterWrite, protectedSettings, validateEndpointUrl, safeLlmFetch } from "ingenium-core";
import * as core from "ingenium-core";
import { requireProject } from "../helpers.js";
import { opencodeClient, isOpenCodeError } from "../opencode-client.js";
import { callOpenCodeWithProviderDeadline } from "../server-global-provider-persistence.js";

/** Handles /api/v1/settings — per-project key-value settings with LLM test-connection proxy. */
export const settingsRouter = Router();

const SENSITIVE_SETTING_KEYS = new Set([
  "synthesis_api_key",
  "synthesis_backup_api_key",
  "llm_provider_api_keys",
]);

function isSensitiveSettingKey(key: string): boolean {
  return SENSITIVE_SETTING_KEYS.has(key);
}

function sendProtectedOAuthSecretError(
  res: import("express").Response,
  result: ReturnType<typeof protectedSettings.updateOAuthClientSecret>,
): void {
  if (result.status === "invalid") {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "A replacement OAuth client secret must be a non-empty string" } });
    return;
  }
  if (result.status === "legacy_conflict") {
    res.status(409).json({ error: { code: "SECRET_MIGRATION_CONFLICT", message: "A saved OAuth client secret needs operator review before it can be migrated" } });
    return;
  }
  res.status(409).json({ error: { code: "VAULT_REQUIRED", message: "Unseal and initialize the vault before changing an OAuth client secret" } });
}

/**
 * OAuth client secrets are mail-service credentials, not dashboard-project
 * settings. Resolve them through the canonical global project on the server and
 * deliberately ignore the selected dashboard project.
 */
function requireCanonicalOAuthProject(res: import("express").Response): string | null {
  try {
    const globalProject = projects.getCanonicalGlobalProject();
    if (globalProject) return globalProject.id;
  } catch {
    // Do not disclose database integrity details through a credential route.
    logger.warn("settings", "OAuth client-secret request rejected because canonical global project resolution failed");
    res.status(503).json({ error: { code: "GLOBAL_PROJECT_UNAVAILABLE", message: "OAuth client-secret storage is unavailable until the canonical global project is repaired" } });
    return null;
  }
  res.status(503).json({ error: { code: "GLOBAL_PROJECT_UNAVAILABLE", message: "OAuth client-secret storage requires the canonical global project" } });
  return null;
}

function requireCanonicalProviderProject(res: import("express").Response): string | null {
  try {
    const globalProject = projects.getCanonicalGlobalProject();
    if (globalProject) return globalProject.id;
  } catch {
    // Keep provider storage unavailable rather than inheriting an arbitrary
    // active project after a global designation change.
  }
  res.status(503).json({
    error: {
      code: "GLOBAL_PROJECT_UNAVAILABLE",
      message: "Provider storage requires the canonical global project.",
    },
  });
  return null;
}

function resolveOAuthSecretAction(
  body: Record<string, unknown>,
): { action: "preserve" | "replace" | "clear"; value?: string } | null {
  const requestedAction = body.action;
  if (requestedAction !== undefined) {
    if (requestedAction !== "preserve" && requestedAction !== "replace" && requestedAction !== "clear") return null;
    if (body.value !== undefined && typeof body.value !== "string") return null;
    if (requestedAction === "replace" && typeof body.value !== "string") return null;
    // Clear is action-driven. Reject an accompanying non-empty replacement so
    // a client cannot accidentally discard a secret it meant to save.
    if (requestedAction === "clear" && typeof body.value === "string" && body.value.trim()) return null;
    return { action: requestedAction, value: typeof body.value === "string" ? body.value : undefined };
  }

  // Legacy Settings clients send blank values after a sanitized GET. Treat a
  // blank implicit value as preserve; clear is intentionally explicit.
  if (body.value === undefined) return { action: "preserve" };
  if (typeof body.value !== "string") return null;
  return body.value.trim() ? { action: "replace", value: body.value } : { action: "preserve" };
}

settingsRouter.get("/", (req, res) => {
  const key = typeof req.query.key === "string" ? req.query.key : "";
  if (!key) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "key query parameter is required" } });
    return;
  }
  if (protectedSettings.isOAuthClientSecretKey(key)) {
    const projectId = requireCanonicalOAuthProject(res);
    if (!projectId) return;
    const migration = protectedSettings.migrateLegacyOAuthClientSecret(projectId, key);
    if (migration.status === "legacy_conflict") {
      res.status(409).json({ error: { code: "SECRET_MIGRATION_CONFLICT", message: "A saved OAuth client secret needs operator review before it can be migrated" } });
      return;
    }
    const metadata = protectedSettings.getOAuthClientSecretMetadata(projectId, key);
    res.json({ data: { key, isSet: metadata.isSet, masked: metadata.masked } });
    return;
  }
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const value = settings.getSetting(projectId, key);
  if (isSensitiveSettingKey(key)) {
    const providerId = key === "synthesis_api_key"
      ? settings.getSetting(projectId, "synthesis_provider") || ""
      : key === "synthesis_backup_api_key"
        ? settings.getSetting(projectId, "synthesis_backup_provider") || ""
        : "";
    res.json({ data: { key, value: "", isSet: providerId ? hasLegacyVaultApiKey(projectId, providerId) : Boolean(value?.trim()) } });
    return;
  }
  res.json({ data: { key, value } });
});

settingsRouter.post("/", (req, res) => {
  const body = req.body as Record<string, unknown>;
  const { key, value } = body;
  if (typeof key !== "string" || !key) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "key is required" } });
    return;
  }
  if (protectedSettings.isOAuthClientSecretKey(key)) {
    const projectId = requireCanonicalOAuthProject(res);
    if (!projectId) return;
    const request = resolveOAuthSecretAction(body);
    if (!request) {
      res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "OAuth client-secret action must be preserve, replace, or clear" } });
      return;
    }
    const result = protectedSettings.updateOAuthClientSecret(projectId, key, request.action, request.value);
    if (result.status !== "ok") {
      sendProtectedOAuthSecretError(res, result);
      return;
    }
    res.json({ data: { key, isSet: result.metadata.isSet, masked: result.metadata.masked } });
    return;
  }
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (typeof value !== "string") {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "key and value are required" } });
    return;
  }
  settings.setSetting(projectId, key, value);

  res.json({
    data: isSensitiveSettingKey(key)
      ? { key, value: "", isSet: Boolean(value.trim()) }
      : { key, value },
  });
});

// ──────────────────────────────────────────────────────────────────────
// Atomic LLM config save — accepts primary + backup in one request,
// saves to settings table, and projects into OpenCode global config.
// ──────────────────────────────────────────────────────────────────────

/** Map a provider ID to the OpenCode AI SDK package name. */
function opencodeProviderPackage(provider: string): string | null {
  switch (provider) {
    case "lmstudio":   return "@ai-sdk/lmstudio";
    case "deepseek":   return "@ai-sdk/deepseek";
    case "openai":     return "@ai-sdk/openai";
    case "anthropic":  return "@ai-sdk/anthropic";
    case "__custom__": return "@ai-sdk/openai-compatible";
    default:           return null;
  }
}

/** GET response shape — NEVER leaks the actual API key. */
interface LlmConfigEntry {
  provider: string;
  model: string;
  apiKeySet?: boolean;
  endpoint: string;
  allowPrivateNetwork: boolean;
}

/** POST request body — still accepts the raw API key for saving. */
interface LlmConfigBody {
  primary: {
    provider?: string;
    model?: string;
    apiKey?: string;
    endpoint?: string;
    allowPrivateNetwork?: boolean;
  };
  backup?: {
    provider?: string;
    model?: string;
    apiKey?: string;
    endpoint?: string;
    allowPrivateNetwork?: boolean;
  };
}

type ProviderRole = "available" | "primary" | "backup";
type ProviderRoles = ProviderRole[];

interface ManagedProviderInput {
  id: string;
  name: string;
  npm: string;
  baseURL?: string;
  models: string[];
  defaultModel: string;
  roles?: ProviderRoles;
  /** @deprecated Accepted for backwards compatibility with scalar-role clients. */
  role?: ProviderRole;
  enabled: boolean;
  apiKey?: string;
  allowPrivateNetwork?: boolean;
  ownerKind?: "installation" | "user" | "organization";
}

interface SynthesisSelection {
  providerId: string;
  modelId: string;
}

interface StoredManagedProvider extends Omit<ManagedProviderInput, "apiKey" | "role" | "roles"> {
  roles: ProviderRoles;
  credentialItemId?: unknown;
  credentialQuarantined?: boolean;
}

interface StoredManagedProviderRecord {
  id?: unknown;
  name?: unknown;
  npm?: unknown;
  baseURL?: unknown;
  models?: unknown;
  defaultModel?: unknown;
  roles?: unknown;
  role?: unknown;
  enabled?: unknown;
  allowPrivateNetwork?: unknown;
  credentialItemId?: unknown;
  ownerKind?: unknown;
  credentialQuarantined?: unknown;
}

interface ManagedProvider extends Omit<StoredManagedProvider, "credentialItemId"> {
  apiKeySet: boolean;
}

const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
const RESERVED_MANAGED_PROVIDER_IDS = new Set(["opencode"]);
const ALLOWED_PROVIDER_PACKAGES = new Set([
  "@ai-sdk/openai-compatible",
  "@ai-sdk/openai",
  "@ai-sdk/anthropic",
  "@ai-sdk/deepseek",
  "@ai-sdk/google",
  "@ai-sdk/azure",
  "@ai-sdk/mistral",
  "@ai-sdk/xai",
  "@ai-sdk/groq",
  "@ai-sdk/cohere",
  "@ai-sdk/amazon-bedrock",
  "@openrouter/ai-sdk-provider",
]);
const DELETED_VAULT_POLICY = '{"mode":"deleted"}';
const ACTIVE_VAULT_POLICY = '{"mode":"restricted"}';
const VAULT_ITEM_ID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;

type VaultItemReader = {
  isSealed(): boolean;
  listItems(projectId: string): Array<{ id?: string; name?: string }>;
  decryptItem(projectId: string, itemId: string): string | null;
  createItem(projectId: string, name: string, type: string, value: string): string;
  updateItem(projectId: string, itemId: string, value: string): void;
  deleteItem(projectId: string, itemId: string): void;
};

function persistProviderConnections(
  projectId: string,
  providers: StoredManagedProvider[],
  principal: import("../middleware/auth.js").RequestPrincipal | undefined,
): void {
  const project = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data").prepare(
    "SELECT organization_id FROM projects WHERE id = ?",
  ).get(projectId) as { organization_id: string } | undefined;
  if (!project) throw new Error("Provider project is unavailable");
  const actorType = principal?.type === "runtime-service" ? "system" : principal?.type ?? "system";
  const actorId = principal?.id ?? null;
  const now = new Date().toISOString();
  execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    for (const provider of providers) {
      const requestedOwner = provider.ownerKind ?? "installation";
      const ownerKind = requestedOwner === "user" && principal?.type !== "user" ? "installation" : requestedOwner;
      const organizationId = ownerKind === "installation" ? null : project.organization_id;
      const ownerUserId = ownerKind === "user" ? principal!.id : null;
      const id = `${ownerKind}:${organizationId ?? "installation"}:${ownerUserId ?? "shared"}:${provider.id}`;
      db.prepare(
        `INSERT INTO provider_connections
         (id, provider_key, owner_kind, organization_id, owner_user_id, credential_item_id, display_name,
          provider_type, config_json, enabled, created_by_actor_type, created_by_actor_id, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, 'managed', ?, ?, ?, ?, ?, ?)
         ON CONFLICT(id) DO UPDATE SET credential_item_id = excluded.credential_item_id,
           display_name = excluded.display_name, config_json = excluded.config_json, enabled = excluded.enabled,
           revision = provider_connections.revision + 1, updated_at = excluded.updated_at`,
      ).run(id, provider.id, ownerKind, organizationId, ownerUserId,
        typeof provider.credentialItemId === "string" ? provider.credentialItemId : null,
        provider.name, JSON.stringify(provider), provider.enabled ? 1 : 0, actorType, actorId, now, now);
    }
  });
  checkpointAfterWrite();
}

const vault = (core as unknown as { vault?: VaultItemReader }).vault;
const LEGACY_PRIMARY_VAULT_KEY_NAME = "Synthesis Primary API Key";

function legacyVaultKeyName(providerId: string): string {
  return `Managed LLM API Key: ${providerId}`;
}

function getLegacyVaultApiKey(projectId: string, providerId: string): string | undefined {
  if (!vault || vault.isSealed()) return undefined;
  const item = vault.listItems(projectId).find((candidate) => candidate.name === legacyVaultKeyName(providerId));
  return item?.id ? vault.decryptItem(projectId, item.id) ?? undefined : undefined;
}

type VaultWriteRollback = () => void;

class VaultCredentialWriteError extends Error {
  constructor() {
    super("Vault credential write failed");
  }
}

/**
 * Write a group of credentials before committing their settings projection.
 * Vault items use their own transactions, so compensate successful earlier
 * writes if a later write fails.
 */
function stageLegacyVaultApiKeyWrites(projectId: string, keys: Record<string, string | undefined>): VaultWriteRollback {
  if (!Object.values(keys).some((key) => key)) return () => {};
  if (!vault || vault.isSealed()) throw new VaultCredentialWriteError();

  const rollbackSteps: VaultWriteRollback[] = [];
  try {
    for (const [providerId, key] of Object.entries(keys)) {
      if (!key) continue;
      const item = vault.listItems(projectId).find((candidate) => candidate.name === legacyVaultKeyName(providerId));
      if (item?.id) {
        const previousValue = vault.decryptItem(projectId, item.id);
        if (previousValue === null) throw new VaultCredentialWriteError();
        vault.updateItem(projectId, item.id, key);
        rollbackSteps.push(() => vault.updateItem(projectId, item.id!, previousValue));
      } else {
        const createdId = vault.createItem(projectId, legacyVaultKeyName(providerId), "api_key", key);
        if (!createdId || createdId === "Vault is sealed") throw new VaultCredentialWriteError();
        rollbackSteps.push(() => vault.deleteItem(projectId, createdId));
      }
    }
  } catch (error) {
    for (const rollback of rollbackSteps.reverse()) {
      try {
        rollback();
      } catch (rollbackError) {
        logger.error("settings", "Vault credential compensation failed", {
          errorName: rollbackError instanceof Error ? rollbackError.name : "UnknownError",
        });
      }
    }
    logger.warn("settings", "Vault credential write failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    throw new VaultCredentialWriteError();
  }

  return () => {
    for (const rollback of rollbackSteps.reverse()) {
      try {
        rollback();
      } catch (error) {
        logger.error("settings", "Vault credential compensation failed", {
          errorName: error instanceof Error ? error.name : "UnknownError",
        });
      }
    }
  };
}

function hasLegacyVaultApiKey(projectId: string, providerId: string): boolean {
  return Boolean(getLegacyVaultApiKey(projectId, providerId)?.trim());
}

function clearLegacyVaultApiKey(projectId: string, providerId: string): void {
  if (!vault || vault.isSealed()) return;
  const item = vault.listItems(projectId).find((candidate) => candidate.name === legacyVaultKeyName(providerId));
  if (item?.id) vault.deleteItem(projectId, item.id);
}

/**
 * One-way compatibility migration. Legacy values are read only while the vault
 * is unsealed, encrypted first, and removed in the same completed operation.
 */
function migrateLegacyProviderKeys(projectId: string): boolean {
  if (!vault || vault.isSealed()) return true;
  if (!migrateManagedProviderJsonSecrets(projectId)) return false;
  const legacyPrimaryItem = vault.listItems(projectId).find((candidate) => candidate.name === LEGACY_PRIMARY_VAULT_KEY_NAME);
  const legacyPrimaryKey = legacyPrimaryItem?.id ? vault.decryptItem(projectId, legacyPrimaryItem.id) : undefined;
  const legacy: Array<[string, string | undefined]> = [
    [settings.getSetting(projectId, "synthesis_provider") || "", settings.getSetting(projectId, "synthesis_api_key") ?? undefined],
    [settings.getSetting(projectId, "synthesis_backup_provider") || "", settings.getSetting(projectId, "synthesis_backup_api_key") ?? undefined],
    ...Object.entries(parseJsonObject(settings.getSetting(projectId, "llm_provider_api_keys"))),
    [settings.getSetting(projectId, "synthesis_provider") || "", legacyPrimaryKey ?? undefined],
  ];
  const migrated = legacy.filter(([providerId, key]) => providerId && key?.trim());
  if (migrated.length === 0) return true;

  let rollback: VaultWriteRollback;
  try {
    rollback = stageLegacyVaultApiKeyWrites(projectId, Object.fromEntries(
      migrated.filter(([providerId]) => !hasLegacyVaultApiKey(projectId, providerId)),
    ));
  } catch {
    return false;
  }
  try {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    execTransaction(() => {
      db.prepare("DELETE FROM settings WHERE project_id = ? AND key IN ('synthesis_api_key', 'synthesis_backup_api_key', 'llm_provider_api_keys')").run(projectId);
    });
  } catch (error) {
    rollback();
    logger.error("settings", "Legacy provider credential migration failed", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    return false;
  }
  checkpointAfterWrite();
  if (legacyPrimaryItem?.id) {
    try {
      vault.deleteItem(projectId, legacyPrimaryItem.id);
    } catch (error) {
      logger.warn("settings", "Legacy vault credential cleanup failed", {
        errorName: error instanceof Error ? error.name : "UnknownError",
      });
    }
  }
  return true;
}

const PROVIDER_SECRET_FIELD = /(?:token|api[_-]?key|client[_-]?secret|password)$/i;

function stripProviderSecrets(value: unknown, secrets: string[]): unknown {
  if (Array.isArray(value)) return value.map((entry) => stripProviderSecrets(entry, secrets));
  if (!value || typeof value !== "object") return value;
  return Object.fromEntries(Object.entries(value as Record<string, unknown>).flatMap(([key, entry]) => {
    if (PROVIDER_SECRET_FIELD.test(key)) {
      if (typeof entry === "string" && entry.length > 0) secrets.push(entry);
      return [];
    }
    return [[key, stripProviderSecrets(entry, secrets)]];
  }));
}

function migrateManagedProviderJsonSecrets(projectId: string): boolean {
  const raw = settings.getSetting(projectId, "llm_provider_configs");
  if (!raw) return true;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return true;
  }
  if (!Array.isArray(parsed)) return true;

  const keys: Record<string, string> = {};
  const references = new Map<string, string>();
  let changed = false;
  const sanitized = parsed.map((entry) => {
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) return entry;
    const secrets: string[] = [];
    const provider = stripProviderSecrets(entry, secrets) as Record<string, unknown>;
    if (secrets.length === 0) return provider;
    if (typeof provider.id !== "string" || !PROVIDER_ID_PATTERN.test(provider.id)) throw new VaultCredentialWriteError();
    const distinct = [...new Set(secrets)];
    keys[provider.id] = distinct.length === 1 ? distinct[0]! : JSON.stringify(distinct);
    if (typeof provider.credentialItemId === "string") references.set(provider.id, provider.credentialItemId);
    changed = true;
    return distinct.length === 1
      ? provider
      : { ...provider, enabled: false, credentialQuarantined: true };
  });
  if (!changed) return true;

  let staged: ManagedVaultCredentialStage;
  try {
    staged = stageManagedVaultApiKeyWrites(projectId, keys, references);
  } catch {
    return false;
  }
  try {
    const secured = sanitized.map((entry) => {
      if (!entry || typeof entry !== "object" || Array.isArray(entry) || typeof entry.id !== "string") return entry;
      const itemId = staged.references.get(entry.id);
      return itemId ? { ...entry, credentialItemId: itemId } : entry;
    });
    writeProviderSettings(projectId, [["llm_provider_configs", JSON.stringify(secured)]]);
    persistProviderConnections(projectId, secured.map((provider) => normalizeManagedProvider(provider as StoredManagedProviderRecord)), undefined);
    return true;
  } catch {
    try {
      writeProviderSettings(projectId, [["llm_provider_configs", raw]]);
    } catch {
      // Preserve the encrypted item for operator recovery if desired-state restoration fails.
      return false;
    }
    staged.rollback();
    return false;
  }
}

function parseJsonObject(value: string | undefined): Record<string, string> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    if (!parsed || Array.isArray(parsed) || typeof parsed !== "object") return {};
    return Object.fromEntries(
      Object.entries(parsed).filter((entry): entry is [string, string] => typeof entry[1] === "string"),
    );
  } catch {
    return {};
  }
}

function parseManagedProviders(value: string | undefined): StoredManagedProvider[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed)
      ? parsed.filter((provider): provider is StoredManagedProviderRecord =>
        !!provider && typeof provider === "object" && !Array.isArray(provider),
      )
        .map(normalizeManagedProvider)
      : [];
  } catch {
    return [];
  }
}

function normalizeRoles(roles: unknown, role: unknown): ProviderRoles {
  if (Array.isArray(roles)) return roles.filter((entry): entry is ProviderRole => entry === "available" || entry === "primary" || entry === "backup");
  if (role === "primary") return ["available", "primary"];
  if (role === "backup") return ["available", "backup"];
  return ["available"];
}

function normalizeManagedProvider(provider: StoredManagedProviderRecord): StoredManagedProvider {
  return {
    id: typeof provider.id === "string" ? provider.id : "",
    name: typeof provider.name === "string" ? provider.name : "",
    npm: typeof provider.npm === "string" ? provider.npm : "",
    baseURL: typeof provider.baseURL === "string" ? provider.baseURL : "",
    models: Array.isArray(provider.models)
      ? provider.models.filter((model): model is string => typeof model === "string")
      : [],
    defaultModel: typeof provider.defaultModel === "string" ? provider.defaultModel : "",
    roles: normalizeRoles(provider.roles, provider.role),
    enabled: provider.enabled === true,
    allowPrivateNetwork: provider.allowPrivateNetwork === true,
    ownerKind: provider.ownerKind === "user" || provider.ownerKind === "organization" ? provider.ownerKind : "installation",
    credentialQuarantined: provider.credentialQuarantined === true,
    ...(Object.prototype.hasOwnProperty.call(provider, "credentialItemId")
      ? { credentialItemId: provider.credentialItemId }
      : {}),
  };
}

interface ManagedCredentialReference {
  providerId: string;
  itemId: string;
}

interface ManagedVaultCredentialStage {
  references: Map<string, string>;
  rollback: VaultWriteRollback;
}

function managedVaultKeyName(providerId: string): string {
  return `Managed LLM API Key: ${providerId}`;
}

function isActiveManagedVaultCredential(projectId: string, providerId: string, itemId: string): boolean {
  if (!VAULT_ITEM_ID_PATTERN.test(itemId)) return false;
  try {
    return Boolean(getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data").prepare(
      `SELECT 1 FROM vault_items
       WHERE project_id = ? AND id = ? AND name = ? AND type = 'api_key' AND access_policy = ?`,
    ).get(projectId, itemId, managedVaultKeyName(providerId), ACTIVE_VAULT_POLICY));
  } catch {
    return false;
  }
}

function hasLegacyManagedVaultCredential(projectId: string, providerId: string): boolean {
  try {
    return Boolean(getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data").prepare(
      "SELECT 1 FROM vault_items WHERE project_id = ? AND name = ? AND type = 'api_key' AND access_policy <> ?",
    ).get(projectId, managedVaultKeyName(providerId), DELETED_VAULT_POLICY));
  } catch {
    return false;
  }
}

function resolveManagedCredentialReferences(
  projectId: string,
  providers: StoredManagedProvider[],
): Map<string, string> | undefined {
  const providerIds = new Set<string>();
  const itemIds = new Set<string>();
  const references = new Map<string, string>();
  for (const provider of providers) {
    if (!PROVIDER_ID_PATTERN.test(provider.id) || providerIds.has(provider.id)) return undefined;
    providerIds.add(provider.id);
    if (provider.credentialItemId === undefined) {
      if (hasLegacyManagedVaultCredential(projectId, provider.id)) return undefined;
      continue;
    }
    if (typeof provider.credentialItemId !== "string"
      || !VAULT_ITEM_ID_PATTERN.test(provider.credentialItemId)
      || itemIds.has(provider.credentialItemId)
      || !isActiveManagedVaultCredential(projectId, provider.id, provider.credentialItemId)) {
      return undefined;
    }
    itemIds.add(provider.credentialItemId);
    references.set(provider.id, provider.credentialItemId);
  }
  return references;
}

function hasManagedVaultApiKey(projectId: string, providerId: string, itemId: unknown): boolean {
  return typeof itemId === "string" && isActiveManagedVaultCredential(projectId, providerId, itemId);
}

function getManagedVaultApiKey(projectId: string, providerId: string, itemId: unknown): string | undefined {
  if (!vault || vault.isSealed() || typeof itemId !== "string") return undefined;
  if (!isActiveManagedVaultCredential(projectId, providerId, itemId)) return undefined;
  return vault.decryptItem(projectId, itemId) ?? undefined;
}

function stageManagedVaultApiKeyWrites(
  projectId: string,
  keys: Record<string, string | undefined>,
  existingReferences: Map<string, string>,
): ManagedVaultCredentialStage {
  const references = new Map(existingReferences);
  if (!Object.values(keys).some(Boolean)) return { references, rollback: () => {} };
  if (!vault || vault.isSealed()) throw new VaultCredentialWriteError();

  const rollbackSteps: VaultWriteRollback[] = [];
  try {
    for (const [providerId, key] of Object.entries(keys)) {
      if (!key) continue;
      const existingItemId = references.get(providerId);
      if (existingItemId) {
        const previousValue = vault.decryptItem(projectId, existingItemId);
        if (previousValue === null) throw new VaultCredentialWriteError();
        vault.updateItem(projectId, existingItemId, key);
        if (vault.decryptItem(projectId, existingItemId) !== key) throw new VaultCredentialWriteError();
        rollbackSteps.push(() => vault.updateItem(projectId, existingItemId, previousValue));
        continue;
      }
      const createdItemId = vault.createItem(projectId, managedVaultKeyName(providerId), "api_key", key);
      if (!createdItemId || createdItemId === "Vault is sealed" || vault.decryptItem(projectId, createdItemId) !== key) {
        throw new VaultCredentialWriteError();
      }
      references.set(providerId, createdItemId);
      rollbackSteps.push(() => vault.deleteItem(projectId, createdItemId));
    }
  } catch {
    for (const rollback of rollbackSteps.reverse()) {
      try {
        rollback();
      } catch {
        // A later request cannot safely infer a credential value from an incomplete rollback.
      }
    }
    throw new VaultCredentialWriteError();
  }

  return {
    references,
    rollback: () => {
      for (const rollback of rollbackSteps.reverse()) {
        try {
          rollback();
        } catch {
          // The settings write is rejected, so the existing configuration remains retryable.
        }
      }
    },
  };
}

function deleteManagedVaultCredential(projectId: string, reference: ManagedCredentialReference): boolean {
  if (!vault || !isActiveManagedVaultCredential(projectId, reference.providerId, reference.itemId)) return false;
  try {
    vault.deleteItem(projectId, reference.itemId);
    return !isActiveManagedVaultCredential(projectId, reference.providerId, reference.itemId);
  } catch {
    return false;
  }
}

function restoreManagedVaultCredential(projectId: string, reference: ManagedCredentialReference): boolean {
  try {
    const changed = execTransaction(() => getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data").prepare(
      `UPDATE vault_items SET access_policy = ?, updated_at = ?
       WHERE project_id = ? AND id = ? AND name = ? AND type = 'api_key' AND access_policy = ?`,
    ).run(
      ACTIVE_VAULT_POLICY,
      new Date().toISOString(),
      projectId,
      reference.itemId,
      managedVaultKeyName(reference.providerId),
      DELETED_VAULT_POLICY,
    ).changes === 1);
    if (changed) checkpointAfterWrite();
    return changed && isActiveManagedVaultCredential(projectId, reference.providerId, reference.itemId);
  } catch {
    return false;
  }
}

function deleteManagedVaultCredentials(
  projectId: string,
  references: ManagedCredentialReference[],
): ManagedCredentialReference[] | undefined {
  const deleted: ManagedCredentialReference[] = [];
  for (const reference of references) {
    if (deleteManagedVaultCredential(projectId, reference)) {
      deleted.push(reference);
      continue;
    }
    for (const previous of deleted.reverse()) restoreManagedVaultCredential(projectId, previous);
    return undefined;
  }
  return deleted;
}

function restoreManagedVaultCredentials(projectId: string, references: ManagedCredentialReference[]): void {
  for (const reference of [...references].reverse()) restoreManagedVaultCredential(projectId, reference);
}

function legacyManagedProviders(projectId: string): StoredManagedProvider[] {
  const primaryProvider = settings.getSetting(projectId, "synthesis_provider") || "";
  const primaryModel = settings.getSetting(projectId, "synthesis_model") || "";
  const backupProvider = settings.getSetting(projectId, "synthesis_backup_provider") || "";
  const backupModel = settings.getSetting(projectId, "synthesis_backup_model") || "";

  const entries: StoredManagedProvider[] = [];
  if (primaryProvider && primaryModel) {
    entries.push({
      id: "ingenium-primary",
      name: primaryProvider === "__custom__" ? "Primary provider" : primaryProvider,
      npm: opencodeProviderPackage(primaryProvider) || "@ai-sdk/openai-compatible",
      baseURL: settings.getSetting(projectId, "synthesis_endpoint") || "",
      models: [primaryModel],
      defaultModel: primaryModel,
      roles: ["available", "primary"],
      enabled: true,
      allowPrivateNetwork: settings.getSetting(projectId, "synthesis_allow_private_network") === "true",
    });
  }
  if (backupProvider && backupModel) {
    entries.push({
      id: "ingenium-backup",
      name: backupProvider === "__custom__" ? "Backup provider" : backupProvider,
      npm: opencodeProviderPackage(backupProvider) || "@ai-sdk/openai-compatible",
      baseURL: settings.getSetting(projectId, "synthesis_backup_endpoint") || "",
      models: [backupModel],
      defaultModel: backupModel,
      roles: ["available", "backup"],
      enabled: true,
      allowPrivateNetwork: settings.getSetting(projectId, "synthesis_backup_allow_private_network") === "true",
    });
  }
  return entries;
}

function getManagedProviders(projectId: string): ManagedProvider[] {
  const stored = parseManagedProviders(settings.getSetting(projectId, "llm_provider_configs"));
  const providers = stored.length > 0 ? stored : legacyManagedProviders(projectId);
  return providers.map(({ credentialItemId, ...provider }) => ({
    ...provider,
    apiKeySet: hasManagedVaultApiKey(projectId, provider.id, credentialItemId),
  }));
}

function saveLlmConfig(
  projectId: string,
  primary: Required<Pick<LlmConfigBody["primary"], "provider" | "model">> & Pick<LlmConfigBody["primary"], "apiKey" | "endpoint" | "allowPrivateNetwork">,
  backup: LlmConfigBody["backup"],
): void {
  const values: Array<[string, string]> = [
    ["synthesis_provider", primary.provider],
    ["synthesis_model", primary.model],
    ["synthesis_endpoint", primary.endpoint ?? ""],
    ["synthesis_allow_private_network", String(primary.allowPrivateNetwork === true)],
    ["synthesis_backup_provider", backup?.provider ?? ""],
    ["synthesis_backup_model", backup?.model ?? ""],
    ["synthesis_backup_endpoint", backup?.endpoint ?? ""],
    ["synthesis_backup_allow_private_network", String(backup?.allowPrivateNetwork === true)],
  ];

  // An omitted key means "keep the saved credential". The Settings UI only
  // receives apiKeySet metadata, never the credential itself, so treating an
  // omitted field as empty would erase a saved key on an unrelated save.
  execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const upsert = db.prepare(
      `INSERT INTO settings (project_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value`,
    );
    for (const [key, value] of values) upsert.run(projectId, key, value);
  });
  checkpointAfterWrite();
}

function writeProviderSettings(projectId: string, values: Array<[string, string]>): void {
  execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const upsert = db.prepare(
      `INSERT INTO settings (project_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value`,
    );
    for (const [key, value] of values) upsert.run(projectId, key, value);
  });
  checkpointAfterWrite();
}

function restoreProviderSettings(
  projectId: string,
  previousValues: Array<[string, string | undefined]>,
): boolean {
  try {
    execTransaction(() => {
      const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
      const upsert = db.prepare(
        `INSERT INTO settings (project_id, key, value) VALUES (?, ?, ?)
         ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value`,
      );
      const remove = db.prepare("DELETE FROM settings WHERE project_id = ? AND key = ?");
      for (const [key, value] of previousValues) {
        if (value === undefined) remove.run(projectId, key);
        else upsert.run(projectId, key, value);
      }
    });
    checkpointAfterWrite();
    return true;
  } catch {
    return false;
  }
}

/** Project the LLM config into the OpenCode global config as synthetic providers. */
function projectToOpenCodeConfig(
  globalProjectId: string,
  primary: { provider?: string; model?: string; endpoint?: string },
  backup: { provider?: string; model?: string; endpoint?: string } | undefined,
): string {
  // Read existing global config
  const existingConfig = configs.getConfig(globalProjectId, "global");
  let config: Record<string, unknown> = {};
  if (existingConfig) {
    try {
      config = JSON.parse(existingConfig.content);
    } catch {
      throw new Error("OpenCode global config is malformed or empty and was left unchanged");
    }
    if (Array.isArray(config) || config === null) {
      throw new Error("OpenCode global config must be a JSON object and was left unchanged");
    }
  }

  // Ensure provider section exists — preserve all existing keys
  if (!config.provider || typeof config.provider !== "object") {
    config.provider = {};
  }
  const providerSection = config.provider as Record<string, unknown>;

  // Build or remove ingenium-primary
  if (primary.provider) {
    providerSection["ingenium-primary"] = buildProviderEntry(primary);
  } else {
    delete providerSection["ingenium-primary"];
  }

  // Build or remove ingenium-backup
  if (backup?.provider) {
    providerSection["ingenium-backup"] = buildProviderEntry(backup);
  } else {
    delete providerSection["ingenium-backup"];
  }

  const projectedConfig = JSON.stringify(config, null, 2);
  configs.saveConfig(globalProjectId, "global", projectedConfig);
  logger.info("settings", "Projected LLM config into OpenCode global config (ingenium-primary / ingenium-backup)");
  return projectedConfig;
}

/** Build a single synthetic provider entry for the OpenCode config. */
function buildProviderEntry(cfg: { provider?: string; model?: string; endpoint?: string }): Record<string, unknown> {
  const pkg = opencodeProviderPackage(cfg.provider || "");
  const isCustom = cfg.provider === "__custom__";

  const entry: Record<string, unknown> = {
    name: `Ingenium ${isCustom ? "Custom" : cfg.provider}: ${cfg.model}`,
    npm: pkg || "@ai-sdk/openai-compatible",
  };

  // Endpoint — required for custom/openai-compatible providers.
  // 🔴 API key is NEVER written to the OpenCode config (avoids plaintext on disk).
  // The key lives only in the settings table and is read at runtime.
  if (cfg.endpoint && (isCustom || !pkg)) {
    entry.options = { baseURL: cfg.endpoint };
  }

  // Model entry
  if (cfg.model) {
    entry.models = {
      [cfg.model]: {
        name: cfg.model,
        id: cfg.model,
      },
    };
  }

  return entry;
}

function buildManagedOpenCodeConfig(
  globalProjectId: string,
  previousProviderIds: string[],
  providersToSave: Omit<ManagedProvider, "apiKeySet">[],
): string {
  const existingConfig = configs.getConfig(globalProjectId, "global");
  let config: Record<string, unknown> = {};
  if (existingConfig) {
    try {
      config = JSON.parse(existingConfig.content);
    } catch {
      throw new Error("OpenCode global config is malformed or empty and was left unchanged");
    }
    if (Array.isArray(config) || config === null) {
      throw new Error("OpenCode global config must be a JSON object and was left unchanged");
    }
  }

  if (!config.provider || Array.isArray(config.provider) || typeof config.provider !== "object") {
    config.provider = {};
  }
  const providerSection = config.provider as Record<string, unknown>;
  for (const id of previousProviderIds) delete providerSection[id];

  for (const provider of providersToSave) {
    if (!provider.enabled) continue;
    const models = Object.fromEntries(
      provider.models.map((model) => [model, { id: model, name: model }]),
    );
    providerSection[provider.id] = {
      name: provider.name,
      npm: provider.npm,
      ...(provider.baseURL ? { options: { baseURL: provider.baseURL } } : {}),
      models,
    };
  }

  return JSON.stringify(config, null, 2);
}

async function validateManagedProviders(providersToSave: ManagedProviderInput[]): Promise<string | null> {
  const ids = new Set<string>();
  let primaryCount = 0;
  let backupCount = 0;

  for (const [index, provider] of providersToSave.entries()) {
    const label = `providers[${index}]`;
    if (!provider || typeof provider !== "object") return `${label} must be an object`;
    if (!PROVIDER_ID_PATTERN.test(provider.id || "")) {
      return `${label}.id must use lowercase letters, numbers, dots, underscores, or hyphens`;
    }
    if (RESERVED_MANAGED_PROVIDER_IDS.has(provider.id)) {
      return `${label}.id is reserved for a built-in provider`;
    }
    if (ids.has(provider.id)) return `${label}.id must be unique`;
    ids.add(provider.id);
    if (!provider.name?.trim()) return `${label}.name is required`;
    if (!ALLOWED_PROVIDER_PACKAGES.has(provider.npm || "")) {
      return `${label}.npm is not an allowed provider package`;
    }
    if (!Array.isArray(provider.models) || provider.models.length === 0) {
      return `${label}.models must contain at least one model ID`;
    }
    const models = provider.models.map((model) => typeof model === "string" ? model.trim() : "");
    if (models.some((model) => !model)) return `${label}.models must contain non-empty strings`;
    if (new Set(models).size !== models.length) return `${label}.models must not contain duplicates`;
    if (!models.includes(provider.defaultModel?.trim())) {
      return `${label}.defaultModel must match one of its model IDs`;
    }
    const roles = normalizeRoles(provider.roles, provider.role);
    if ((provider.roles !== undefined && (!Array.isArray(provider.roles) || roles.length !== provider.roles.length))
      || (provider.role !== undefined && !(["available", "primary", "backup"] as const).includes(provider.role))) {
      return `${label}.roles is invalid`;
    }
    if (typeof provider.enabled !== "boolean") return `${label}.enabled must be a boolean`;
    if (provider.apiKey !== undefined && typeof provider.apiKey !== "string") {
      return `${label}.apiKey must be a string when supplied`;
    }
    if (roles.includes("primary")) primaryCount += 1;
    if (roles.includes("backup")) backupCount += 1;
    if (provider.allowPrivateNetwork !== undefined && typeof provider.allowPrivateNetwork !== "boolean") {
      return `${label}.allowPrivateNetwork must be a boolean`;
    }
    if (provider.ownerKind !== undefined && !["installation", "user", "organization"].includes(provider.ownerKind)) {
      return `${label}.ownerKind is invalid`;
    }
    if (provider.baseURL) {
      try {
        await validateEndpointUrl(provider.baseURL, provider.allowPrivateNetwork === true);
      } catch (err) {
        return `${label}.baseURL: ${err instanceof Error ? err.message : "endpoint is not allowed"}`;
      }
    }
  }

  if (primaryCount > 1) return "only one provider can be the primary provider";
  if (backupCount > 1) return "only one provider can be the backup provider";
  return null;
}

settingsRouter.get("/provider-configs", (_req, res) => {
  const projectId = requireCanonicalProviderProject(res);
  if (!projectId) return;
  if (!migrateLegacyProviderKeys(projectId)) {
    res.status(409).json({ error: { code: "VAULT_WRITE_FAILED", message: "Could not secure legacy credentials. Verify the vault is available and try again." } });
    return;
  }
  res.json({ data: { providers: getManagedProviders(projectId).map((provider) => ({
    ...provider,
    effectiveCapabilities: ["read", "write", "use"],
  })), synthesis: {
    primary: { providerId: settings.getSetting(projectId, "synthesis_provider") || "", modelId: settings.getSetting(projectId, "synthesis_model") || "" },
    secondary: { providerId: settings.getSetting(projectId, "synthesis_backup_provider") || "", modelId: settings.getSetting(projectId, "synthesis_backup_model") || "" },
  } } });
});

settingsRouter.put("/provider-configs", async (req, res) => {
  const projectId = requireCanonicalProviderProject(res);
  if (!projectId) return;
  const providersInput = req.body?.providers;
  if (!Array.isArray(providersInput)) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "providers must be an array" } });
    return;
  }
  const requestedSynthesis = req.body?.synthesis as { primary?: SynthesisSelection; secondary?: SynthesisSelection } | undefined;

  const validationError = await validateManagedProviders(providersInput as ManagedProviderInput[]);
  if (validationError) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: validationError } });
    return;
  }
  const previous = parseManagedProviders(settings.getSetting(projectId, "llm_provider_configs"));
  const previousReferences = resolveManagedCredentialReferences(projectId, previous);
  if (!previousReferences) {
    res.status(409).json({
      error: {
        code: "PROVIDER_CREDENTIAL_REFERENCE_INVALID",
        message: "Provider credential metadata requires operator review before it can be changed.",
      },
    });
    return;
  }
  if (!migrateLegacyProviderKeys(projectId)) {
    res.status(409).json({ error: { code: "VAULT_WRITE_FAILED", message: "Could not secure legacy credentials. Verify the vault is available and try again." } });
    return;
  }
  const previousIds = previous.map((provider) => provider.id);
  const resolvedKeys: Record<string, string | undefined> = {};
  const clearedKeyIds = new Set<string>();
  const metadata = (providersInput as ManagedProviderInput[]).map((provider) => {
    const normalized = {
      id: provider.id.trim(),
      name: provider.name.trim(),
      npm: provider.npm.trim(),
      baseURL: provider.baseURL?.trim() || "",
      models: provider.models.map((model) => model.trim()),
      defaultModel: provider.defaultModel.trim(),
      roles: normalizeRoles(provider.roles, provider.role),
      enabled: provider.enabled,
      allowPrivateNetwork: provider.allowPrivateNetwork === true,
      ownerKind: provider.ownerKind === "user" || provider.ownerKind === "organization" ? provider.ownerKind : "installation",
    } satisfies Omit<StoredManagedProvider, "credentialItemId">;
    const resolvedKey = provider.apiKey === undefined ? undefined : provider.apiKey.trim();
    if (resolvedKey) resolvedKeys[normalized.id] = resolvedKey;
    if (provider.apiKey !== undefined && !provider.apiKey.trim()) clearedKeyIds.add(normalized.id);
    return normalized;
  });

  if (Object.values(resolvedKeys).some((key) => key) && (!vault || vault.isSealed())) {
    res.status(409).json({ error: { code: "VAULT_REQUIRED", message: "Unseal and initialize the vault before saving an API key" } });
    return;
  }

  let projectedConfig: string;
  try {
    projectedConfig = buildManagedOpenCodeConfig(projectId, previousIds, metadata);
  } catch (err) {
    logger.warn("settings", `OpenCode provider projection failed: ${err instanceof Error ? err.message : String(err)}`);
    res.status(409).json({
      error: { code: "CONFIG_PROJECTION_FAILED", message: "OpenCode global config could not be updated and was left unchanged" },
    });
    return;
  }

  const primary = metadata.find((provider) => provider.enabled && provider.roles.includes("primary"));
  const backup = metadata.find((provider) => provider.enabled && provider.roles.includes("backup"));
  const select = (value: SynthesisSelection | undefined, fallback: typeof primary): SynthesisSelection | null => {
    if (!value?.providerId && !value?.modelId) return fallback ? { providerId: fallback.id, modelId: fallback.defaultModel } : { providerId: "", modelId: "" };
    const provider = metadata.find((candidate) => candidate.id === value?.providerId && candidate.enabled);
    return provider && provider.models.includes(value!.modelId) ? { providerId: provider.id, modelId: value!.modelId } : null;
  };
  const primarySelection = select(requestedSynthesis?.primary, primary);
  const secondarySelection = select(requestedSynthesis?.secondary, backup);
  if (!primarySelection || !secondarySelection || (primarySelection.providerId && primarySelection.providerId === secondarySelection.providerId && primarySelection.modelId === secondarySelection.modelId)) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "Synthesis selections must reference enabled custom models and cannot be identical" } });
    return;
  }
  const values: Array<[string, string]> = [
    ["llm_provider_configs", ""],
    ["synthesis_provider", primarySelection.providerId],
    ["synthesis_model", primarySelection.modelId],
    ["synthesis_endpoint", metadata.find((p) => p.id === primarySelection.providerId)?.baseURL ?? ""],
    ["synthesis_allow_private_network", String(metadata.find((p) => p.id === primarySelection.providerId)?.allowPrivateNetwork === true)],
    ["synthesis_backup_provider", secondarySelection.providerId],
    ["synthesis_backup_model", secondarySelection.modelId],
    ["synthesis_backup_endpoint", metadata.find((p) => p.id === secondarySelection.providerId)?.baseURL ?? ""],
    ["synthesis_backup_allow_private_network", String(metadata.find((p) => p.id === secondarySelection.providerId)?.allowPrivateNetwork === true)],
  ];
  if (metadata.some((provider) => provider.ownerKind !== "installation")) {
    res.status(422).json({
      error: {
        code: "PRIVATE_PROVIDER_RUNTIME_UNAVAILABLE",
        message: "User and organization provider credentials require an isolated provider runtime and cannot be loaded into shared OpenCode.",
      },
    });
    return;
  }
  let stagedCredentials: ManagedVaultCredentialStage;
  try {
    stagedCredentials = stageManagedVaultApiKeyWrites(projectId, resolvedKeys, previousReferences);
  } catch {
    res.status(409).json({ error: { code: "VAULT_WRITE_FAILED", message: "Could not save API credentials. Verify the vault is available and try again." } });
    return;
  }

  const removals: ManagedCredentialReference[] = [];
  for (const [providerId, itemId] of previousReferences) {
    if (!metadata.some((provider) => provider.id === providerId) || clearedKeyIds.has(providerId)) {
      removals.push({ providerId, itemId });
      stagedCredentials.references.delete(providerId);
    }
  }
  const deletedCredentials = deleteManagedVaultCredentials(projectId, removals);
  if (!deletedCredentials) {
    stagedCredentials.rollback();
    res.status(409).json({
      error: {
        code: "VAULT_CREDENTIAL_DELETE_FAILED",
        message: "Could not remove a provider credential. Provider configuration was left unchanged.",
      },
    });
    return;
  }

  const persistedMetadata = metadata.map((provider) => {
    const itemId = stagedCredentials.references.get(provider.id);
    return itemId ? { ...provider, credentialItemId: itemId } : provider;
  });
  values[0] = ["llm_provider_configs", JSON.stringify(persistedMetadata)];
  const previousSettings = values.map(([key]) => [key, settings.getSetting(projectId, key)] as [string, string | undefined]);
  const previousConfig = configs.getConfig(projectId, "global")?.content;

  let settingsSaved = false;
  try {
    writeProviderSettings(projectId, values);
    persistProviderConnections(projectId, persistedMetadata, req.principal);
    settingsSaved = true;
    configs.saveConfig(projectId, "global", projectedConfig);
    logger.info("settings", `Projected ${metadata.filter((provider) => provider.enabled).length} managed providers into OpenCode global config`);
  } catch (error) {
    if (settingsSaved) restoreProviderSettings(projectId, previousSettings);
    if (previousConfig !== undefined) {
      try {
        configs.saveConfig(projectId, "global", previousConfig);
      } catch {
        // The desired-state settings and credential references were restored first.
      }
    }
    restoreManagedVaultCredentials(projectId, deletedCredentials);
    stagedCredentials.rollback();
    logger.error("settings", "Provider configuration save failed after credential preparation", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    res.status(409).json({
      error: {
        code: "CONFIG_SAVE_FAILED",
        message: "Could not save provider configuration. Please try again.",
      },
    });
    return;
  }

  const authWarnings: string[] = [];
  const result = await callOpenCodeWithProviderDeadline((signal) =>
    opencodeClient.updateGlobalConfig(JSON.parse(projectedConfig) as Record<string, unknown>, signal),
  );
  if (isOpenCodeError(result)) {
    authWarnings.push("OpenCode could not reload the provider configuration automatically");
  }
  for (const provider of metadata) {
    if (clearedKeyIds.has(provider.id)) {
      const result = await callOpenCodeWithProviderDeadline((signal) =>
        opencodeClient.deleteAuth(provider.id, "/workspace", signal),
      );
      if (isOpenCodeError(result)) authWarnings.push("Authentication cleanup could not be completed");
      continue;
    }
    const key = resolvedKeys[provider.id] ?? getManagedVaultApiKey(
      projectId,
      provider.id,
      stagedCredentials.references.get(provider.id),
    );
    if (!provider.enabled || !key) continue;
    const result = await callOpenCodeWithProviderDeadline((signal) =>
      opencodeClient.addAuth(provider.id, { type: "api", key }, "/workspace", signal),
    );
    if (isOpenCodeError(result)) authWarnings.push("Authentication could not be updated");
  }
  for (const removedId of previousIds.filter((id) => !metadata.some((provider) => provider.id === id))) {
    const result = await callOpenCodeWithProviderDeadline((signal) =>
      opencodeClient.deleteAuth(removedId, "/workspace", signal),
    );
    if (isOpenCodeError(result)) authWarnings.push("Authentication cleanup could not be completed");
  }

  res.json({ data: { saved: true, warnings: authWarnings } });
});

settingsRouter.get("/llm-config", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  if (!migrateLegacyProviderKeys(projectId)) {
    res.status(409).json({ error: { code: "VAULT_WRITE_FAILED", message: "Could not secure legacy credentials. Verify the vault is available and try again." } });
    return;
  }

  const primaryProvider = settings.getSetting(projectId, "synthesis_provider") || "";
  const backupProvider = settings.getSetting(projectId, "synthesis_backup_provider") || "";

  const primary: LlmConfigEntry = {
    provider: settings.getSetting(projectId, "synthesis_provider") || "",
    model: settings.getSetting(projectId, "synthesis_model") || "",
    apiKeySet: hasLegacyVaultApiKey(projectId, primaryProvider),
    endpoint: settings.getSetting(projectId, "synthesis_endpoint") || "",
    allowPrivateNetwork: settings.getSetting(projectId, "synthesis_allow_private_network") === "true",
  };

  const backup: LlmConfigEntry = {
    provider: settings.getSetting(projectId, "synthesis_backup_provider") || "",
    model: settings.getSetting(projectId, "synthesis_backup_model") || "",
    apiKeySet: hasLegacyVaultApiKey(projectId, backupProvider),
    endpoint: settings.getSetting(projectId, "synthesis_backup_endpoint") || "",
    allowPrivateNetwork: settings.getSetting(projectId, "synthesis_backup_allow_private_network") === "true",
  };

  res.json({
    data: {
      primary,
      backup: backup.provider ? backup : null,
    },
  });
});

settingsRouter.post("/llm-config", async (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const { primary, backup } = req.body as LlmConfigBody;
  if (!primary || typeof primary !== "object") {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "primary config object is required" },
    });
    return;
  }

  // Validate required fields
  if (!primary.provider || primary.provider.trim().length === 0) {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "provider is required and must not be empty" },
    });
    return;
  }
  if (!primary.model || primary.model.trim().length === 0) {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: "model is required and must not be empty" },
    });
    return;
  }

  const suppliedKeys = [primary.apiKey, backup?.apiKey].filter((key): key is string => typeof key === "string" && key.trim().length > 0);
  if (suppliedKeys.length > 0 && (!vault || vault.isSealed())) {
    res.status(409).json({ error: { code: "VAULT_REQUIRED", message: "Unseal and initialize the vault before saving an API key" } });
    return;
  }
  if (!migrateLegacyProviderKeys(projectId)) {
    res.status(409).json({ error: { code: "VAULT_WRITE_FAILED", message: "Could not secure legacy credentials. Verify the vault is available and try again." } });
    return;
  }

  const endpointsToCheck = [primary.endpoint];
  if (backup?.endpoint) endpointsToCheck.push(backup.endpoint);
  try {
    for (const endpoint of endpointsToCheck) {
      if (endpoint) await validateEndpointUrl(endpoint, endpoint === primary.endpoint ? primary.allowPrivateNetwork === true : backup?.allowPrivateNetwork === true);
    }
  } catch (err) {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: err instanceof Error ? err.message : "endpoint is not allowed" },
    });
    return;
  }

  // Validate projection before saving settings so malformed global config does
  // not produce a success response or destroy unrelated OpenCode settings.
  const globalProject = projects.getGlobalProject();
  if (globalProject) {
    try {
      const projectedConfig = projectToOpenCodeConfig(globalProject.id, primary, backup?.provider ? backup : undefined);
      const result = await callOpenCodeWithProviderDeadline((signal) =>
        opencodeClient.updateGlobalConfig(JSON.parse(projectedConfig) as Record<string, unknown>, signal),
      );
      if (isOpenCodeError(result)) {
        logger.warn("settings", "OpenCode could not reload the LLM configuration automatically", {
          operation: "provider_config_reload",
          code: result.error.code,
        });
      }
    } catch (err) {
      logger.warn("settings", `OpenCode config projection failed: ${err instanceof Error ? err.message : String(err)}`);
      res.status(409).json({
        error: { code: "CONFIG_PROJECTION_FAILED", message: "OpenCode global config could not be updated and was left unchanged" },
      });
      return;
    }
  }

  const credentialWrites: Record<string, string | undefined> = {};
  if (primary.apiKey?.trim()) credentialWrites[primary.provider.trim()] = primary.apiKey.trim();
  if (backup?.provider && backup.apiKey?.trim()) credentialWrites[backup.provider.trim()] = backup.apiKey.trim();
  let rollbackVaultWrites: VaultWriteRollback;
  try {
    rollbackVaultWrites = stageLegacyVaultApiKeyWrites(projectId, credentialWrites);
  } catch {
    res.status(409).json({ error: { code: "VAULT_WRITE_FAILED", message: "Could not save API credentials. Verify the vault is available and try again." } });
    return;
  }
  try {
    saveLlmConfig(projectId, primary as Required<Pick<LlmConfigBody["primary"], "provider" | "model">> & Pick<LlmConfigBody["primary"], "apiKey" | "endpoint" | "allowPrivateNetwork">, backup);
  } catch (error) {
    rollbackVaultWrites();
    logger.error("settings", "LLM settings write failed after vault update", {
      errorName: error instanceof Error ? error.name : "UnknownError",
    });
    res.status(409).json({ error: { code: "CONFIG_SAVE_FAILED", message: "Could not save LLM configuration. Please try again." } });
    return;
  }
  if (primary.apiKey !== undefined) {
    if (!primary.apiKey.trim()) clearLegacyVaultApiKey(projectId, primary.provider.trim());
  }
  if (backup?.provider && backup.apiKey !== undefined) {
    if (!backup.apiKey.trim()) clearLegacyVaultApiKey(projectId, backup.provider.trim());
  }

  // Project into OpenCode global config for Chat
  if (globalProject) {
    // Projection was completed during preflight, before settings were saved.
  }

  res.json({ data: { saved: true } });
});
settingsRouter.post("/test-llm", async (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const { endpoint, model, apiKey, allowPrivateNetwork } = req.body;
  if (!endpoint || !model) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "endpoint and model are required" } });
    return;
  }
  if (typeof endpoint !== "string" || typeof model !== "string") {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "endpoint and model must be strings" } });
    return;
  }
  try {
    await validateEndpointUrl(endpoint, allowPrivateNetwork === true);
  } catch (err) {
    res.status(422).json({
      error: { code: "VALIDATION_ERROR", message: err instanceof Error ? err.message : "endpoint is not allowed" },
    });
    return;
  }
  const baseUrl = endpoint.replace(/\/v1\/?$/, "").replace(/\/$/, "");
  const url = `${baseUrl}/v1/chat/completions`;
  const headers: Record<string, string> = { "Content-Type": "application/json" };
  if (apiKey) headers["Authorization"] = `Bearer ${apiKey}`;

  safeLlmFetch(url, {
    method: "POST",
    headers,
    body: JSON.stringify({
      model,
      messages: [{ role: "user", content: "Reply with just 'ok'" }],
      max_tokens: 10,
    }),
  }, { allowPrivateNetwork: allowPrivateNetwork === true, timeoutMs: 15000 })
    .then(async (r) => {
      if (!r.ok) {
        res.json({ data: { ok: false, status: r.status, message: "LLM endpoint returned an error" } });
        return;
      }
      res.json({ data: { ok: true } });
    })
    .catch((err: Error) => {
      logger.error("settings", `LLM test connection failed: ${err.message}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n"), method: req.method, path: req.originalUrl });
      res.json({ data: { ok: false, status: 0, message: "Unable to reach LLM endpoint" } });
    });
});
