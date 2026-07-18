import { Router } from "express";
import { settings, logger, projects, configs, getDb, execTransaction, checkpointAfterWrite, validateEndpointUrl, safeLlmFetch } from "ingenium-core";
import * as core from "ingenium-core";
import { requireProject } from "../helpers.js";
import { opencodeClient, isOpenCodeError } from "../opencode-client.js";

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

settingsRouter.get("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const key = req.query.key as string;
  if (!key) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "key query parameter is required" } });
    return;
  }
  const value = settings.getSetting(projectId, key);
  if (isSensitiveSettingKey(key)) {
    res.json({ data: { key, value: "", isSet: Boolean(value?.trim()) } });
    return;
  }
  res.json({ data: { key, value } });
});

settingsRouter.post("/", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const { key, value } = req.body;
  if (!key || typeof value !== "string") {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "key and value are required" } });
    return;
  }
  settings.setSetting(projectId, key, value);

  // Self-heal: if saving synthesis_model config, ensure the project is marked global
  // so the self-learning pipeline can find it. The pipeline only reads from the global
  // project — if no project is marked global, extraction/synthesis silently disables.
  if (key === "synthesis_model") {
    const globalProject = projects.getGlobalProject();
    if (!globalProject) {
      const projectName = req.query.project as string;
      if (projectName) {
        const healed = projects.setProjectGlobal(projectName, true);
        if (healed) {
          logger.info("settings", `Self-healed: marked project "${projectName}" as global because synthesis_model was saved and no global project existed`);
        }
      }
    }
  }

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
}

interface ManagedProvider extends Omit<ManagedProviderInput, "apiKey" | "role" | "roles"> {
  roles: ProviderRoles;
  apiKeySet: boolean;
}

const PROVIDER_ID_PATTERN = /^[a-z0-9][a-z0-9._-]{0,63}$/;
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

type VaultItemReader = {
  isSealed(): boolean;
  findItemByName(projectId: string, name: string): { id: string } | null;
  revealItem(projectId: string, itemId: string): { value: string } | null;
};

const vault = (core as unknown as { vault?: VaultItemReader }).vault;

function getVaultPrimaryApiKey(projectId: string): string | undefined {
  if (!vault || vault.isSealed()) return undefined;
  const item = vault.findItemByName(projectId, "Synthesis Primary API Key");
  return item ? vault.revealItem(projectId, item.id)?.value : undefined;
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

function parseManagedProviders(value: string | undefined): Omit<ManagedProvider, "apiKeySet">[] {
  if (!value) return [];
  try {
    const parsed = JSON.parse(value);
    return Array.isArray(parsed) ? parsed.map(normalizeManagedProvider) : [];
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

function normalizeManagedProvider(provider: Record<string, unknown>): Omit<ManagedProvider, "apiKeySet"> {
  const { role, roles, ...rest } = provider;
  return {
    ...rest,
    roles: normalizeRoles(roles, role),
    allowPrivateNetwork: provider.allowPrivateNetwork === true,
  } as Omit<ManagedProvider, "apiKeySet">;
}

function legacyManagedProviders(projectId: string): Omit<ManagedProvider, "apiKeySet">[] {
  const primaryProvider = settings.getSetting(projectId, "synthesis_provider") || "";
  const primaryModel = settings.getSetting(projectId, "synthesis_model") || "";
  const backupProvider = settings.getSetting(projectId, "synthesis_backup_provider") || "";
  const backupModel = settings.getSetting(projectId, "synthesis_backup_model") || "";

  const entries: Omit<ManagedProvider, "apiKeySet">[] = [];
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
  return entries.map((provider) => normalizeManagedProvider(provider));
}

function getManagedProviders(projectId: string): ManagedProvider[] {
  const stored = parseManagedProviders(settings.getSetting(projectId, "llm_provider_configs"));
  const providers = (stored.length > 0 ? stored : legacyManagedProviders(projectId))
    .map((provider) => normalizeManagedProvider(provider));
  const keys = parseJsonObject(settings.getSetting(projectId, "llm_provider_api_keys"));
  const legacyPrimaryKey = getVaultPrimaryApiKey(projectId) ?? settings.getSetting(projectId, "synthesis_api_key");
  const legacyBackupKey = settings.getSetting(projectId, "synthesis_backup_api_key");

  return providers.map((provider) => ({
    ...provider,
    apiKeySet: Boolean(
      keys[provider.id]
       || (provider.roles.includes("primary") && legacyPrimaryKey)
       || (provider.roles.includes("backup") && legacyBackupKey),
    ),
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
    ["synthesis_restart_pending", "true"],
  ];

  // An omitted key means "keep the saved credential". The Settings UI only
  // receives apiKeySet metadata, never the credential itself, so treating an
  // omitted field as empty would erase a saved key on an unrelated save.
  if (primary.apiKey !== undefined) values.push(["synthesis_api_key", primary.apiKey]);
  if (backup?.apiKey !== undefined) values.push(["synthesis_backup_api_key", backup.apiKey]);

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

/** Project the LLM config into the OpenCode global config as synthetic providers. */
function projectToOpenCodeConfig(
  globalProjectId: string,
  primary: { provider?: string; model?: string; endpoint?: string },
  backup: { provider?: string; model?: string; endpoint?: string } | undefined,
): void {
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

  configs.saveConfig(globalProjectId, "global", JSON.stringify(config, null, 2));
  logger.info("settings", "Projected LLM config into OpenCode global config (ingenium-primary / ingenium-backup)");
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
    if (roles.includes("primary") && roles.includes("backup")) {
      return `${label}.roles: a provider cannot be both primary and backup`;
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

settingsRouter.get("/provider-configs", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  res.json({ data: { providers: getManagedProviders(projectId) } });
});

settingsRouter.put("/provider-configs", async (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;
  const providersInput = req.body?.providers;
  if (!Array.isArray(providersInput)) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: "providers must be an array" } });
    return;
  }

  const validationError = await validateManagedProviders(providersInput as ManagedProviderInput[]);
  if (validationError) {
    res.status(422).json({ error: { code: "VALIDATION_ERROR", message: validationError } });
    return;
  }

  const previous = getManagedProviders(projectId);
  const previousIds = previous.map((provider) => provider.id);
  const previousKeys = parseJsonObject(settings.getSetting(projectId, "llm_provider_api_keys"));
  const legacyPrimaryKey = getVaultPrimaryApiKey(projectId) ?? settings.getSetting(projectId, "synthesis_api_key") ?? "";
  const legacyBackupKey = settings.getSetting(projectId, "synthesis_backup_api_key") ?? "";
  const resolvedKeys: Record<string, string> = {};
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
    } satisfies Omit<ManagedProvider, "apiKeySet">;
    const previousRoles = previous.find((entry) => entry.id === normalized.id)?.roles ?? [];
    const preservedKey = previousKeys[normalized.id]
      || (previousRoles.includes("primary") ? legacyPrimaryKey : "")
      || (previousRoles.includes("backup") ? legacyBackupKey : "");
    const resolvedKey = provider.apiKey === undefined ? preservedKey : provider.apiKey.trim();
    if (resolvedKey) resolvedKeys[normalized.id] = resolvedKey;
    if (provider.apiKey !== undefined && !provider.apiKey.trim()) clearedKeyIds.add(normalized.id);
    return normalized;
  });

  let globalProject = projects.getGlobalProject();
  if (!globalProject) {
    const projectName = req.query.project as string;
    if (projectName) projects.setProjectGlobal(projectName, true);
    globalProject = projects.getGlobalProject();
  }

  let projectedConfig: string | null = null;
  if (globalProject) {
    try {
      projectedConfig = buildManagedOpenCodeConfig(globalProject.id, previousIds, metadata);
    } catch (err) {
      logger.warn("settings", `OpenCode provider projection failed: ${err instanceof Error ? err.message : String(err)}`);
      res.status(409).json({
        error: { code: "CONFIG_PROJECTION_FAILED", message: "OpenCode global config could not be updated and was left unchanged" },
      });
      return;
    }
  }

  const primary = metadata.find((provider) => provider.enabled && provider.roles.includes("primary"));
  const backup = metadata.find((provider) => provider.enabled && provider.roles.includes("backup"));
  const values: Array<[string, string]> = [
    ["llm_provider_configs", JSON.stringify(metadata)],
    ["llm_provider_api_keys", JSON.stringify(resolvedKeys)],
    ["synthesis_provider", primary?.id ?? ""],
    ["synthesis_model", primary?.defaultModel ?? ""],
    ["synthesis_endpoint", primary?.baseURL ?? ""],
    ["synthesis_allow_private_network", String(primary?.allowPrivateNetwork === true)],
    ["synthesis_api_key", primary ? resolvedKeys[primary.id] ?? "" : ""],
    ["synthesis_backup_provider", backup?.id ?? ""],
    ["synthesis_backup_model", backup?.defaultModel ?? ""],
    ["synthesis_backup_endpoint", backup?.baseURL ?? ""],
    ["synthesis_backup_allow_private_network", String(backup?.allowPrivateNetwork === true)],
    ["synthesis_backup_api_key", backup ? resolvedKeys[backup.id] ?? "" : ""],
    ["synthesis_restart_pending", "true"],
  ];
  execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
    const upsert = db.prepare(
      `INSERT INTO settings (project_id, key, value) VALUES (?, ?, ?)
       ON CONFLICT(project_id, key) DO UPDATE SET value = excluded.value`,
    );
    for (const [key, value] of values) upsert.run(projectId, key, value);
  });
  checkpointAfterWrite();

  if (globalProject && projectedConfig) {
    try {
      configs.saveConfig(globalProject.id, "global", projectedConfig);
      logger.info("settings", `Projected ${metadata.filter((provider) => provider.enabled).length} managed providers into OpenCode global config`);
    } catch (err) {
      logger.error("settings", `Provider settings were saved but OpenCode config projection failed: ${err instanceof Error ? err.message : String(err)}`);
      res.status(409).json({
        error: {
          code: "CONFIG_PROJECTION_FAILED",
          message: "Provider settings were saved, but OpenCode global config could not be updated",
        },
      });
      return;
    }
  }

  const authWarnings: string[] = [];
  for (const provider of metadata) {
    const key = resolvedKeys[provider.id];
    if (clearedKeyIds.has(provider.id)) {
      const result = await opencodeClient.deleteAuth(provider.id, "/workspace");
      if (isOpenCodeError(result)) authWarnings.push(`Authentication cleanup for ${provider.name} could not be completed`);
      continue;
    }
    if (!provider.enabled || !key) continue;
    const result = await opencodeClient.addAuth(provider.id, { type: "api", key }, "/workspace");
    if (isOpenCodeError(result)) authWarnings.push(`Authentication for ${provider.name} will require reconnecting after restart`);
  }
  for (const removedId of previousIds.filter((id) => !metadata.some((provider) => provider.id === id))) {
    const result = await opencodeClient.deleteAuth(removedId, "/workspace");
    if (isOpenCodeError(result)) authWarnings.push(`Authentication cleanup for removed provider ${removedId} could not be completed`);
  }

  res.json({ data: { saved: true, restartRequired: true, warnings: authWarnings } });
});

settingsRouter.get("/llm-config", (req, res) => {
  const projectId = requireProject(req, res);
  if (!projectId) return;

  const primaryKey = getVaultPrimaryApiKey(projectId) ?? settings.getSetting(projectId, "synthesis_api_key");
  const backupKey = settings.getSetting(projectId, "synthesis_backup_api_key");

  const primary: LlmConfigEntry = {
    provider: settings.getSetting(projectId, "synthesis_provider") || "",
    model: settings.getSetting(projectId, "synthesis_model") || "",
    apiKeySet: Boolean(primaryKey && primaryKey.trim().length > 0),
    endpoint: settings.getSetting(projectId, "synthesis_endpoint") || "",
    allowPrivateNetwork: settings.getSetting(projectId, "synthesis_allow_private_network") === "true",
  };

  const backup: LlmConfigEntry = {
    provider: settings.getSetting(projectId, "synthesis_backup_provider") || "",
    model: settings.getSetting(projectId, "synthesis_backup_model") || "",
    apiKeySet: Boolean(backupKey && backupKey.trim().length > 0),
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
      projectToOpenCodeConfig(globalProject.id, primary, backup?.provider ? backup : undefined);
    } catch (err) {
      logger.warn("settings", `OpenCode config projection failed: ${err instanceof Error ? err.message : String(err)}`);
      res.status(409).json({
        error: { code: "CONFIG_PROJECTION_FAILED", message: "OpenCode global config could not be updated and was left unchanged" },
      });
      return;
    }
  }

  saveLlmConfig(projectId, primary as Required<Pick<LlmConfigBody["primary"], "provider" | "model">> & Pick<LlmConfigBody["primary"], "apiKey" | "endpoint" | "allowPrivateNetwork">, backup);

  // Self-heal global project marking
  if (primary.provider || primary.model) {
    const globalProject = projects.getGlobalProject();
    if (!globalProject) {
      const projectName = req.query.project as string;
      if (projectName) {
        projects.setProjectGlobal(projectName, true);
        logger.info("settings", `Self-healed: marked project "${projectName}" as global`);
      }
    }
  }

  // Project into OpenCode global config for Chat
  if (globalProject) {
    // Projection was completed during preflight, before settings were saved.
  }

  res.json({ data: { saved: true, restartRequired: true } });
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
