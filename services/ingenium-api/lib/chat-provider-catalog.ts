import { settings } from "ingenium-core";
import { isOpenCodeError, opencodeClient } from "./opencode-client.js";
import { isSafeBrowserIdentifier, isSafeBrowserLabel } from "./browser-safe-scalars.js";

export interface ChatModelInfo {
  id: string;
  label: string;
}

export interface ExpandedChatProviderInfo {
  providerId: string;
  label: string;
  models: ChatModelInfo[];
  defaultModel: string;
  source: "managed" | "builtin";
}

interface ManagedProviderConfig {
  id?: unknown;
  name?: unknown;
  models?: unknown;
  defaultModel?: unknown;
  roles?: unknown;
  role?: unknown;
  enabled?: unknown;
}

const BUILTIN_CHAT_PROVIDER_ID = "opencode";
export const CHAT_SELECTION_SETTING = "chat_selection";
const LEGACY_LLM_PROVIDER_LABELS: Readonly<Record<string, string>> = {
  lmstudio: "LM Studio",
  deepseek: "DeepSeek",
  openai: "OpenAI",
  anthropic: "Anthropic",
  __custom__: "Custom provider",
};

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Provider/model IDs are sent to OpenCode only after this strict catalog check. */
export function isValidChatSelectionIdentifier(value: unknown): value is string {
  return isSafeBrowserIdentifier(value);
}

function isSafeChatLabel(value: unknown): value is string {
  return isSafeBrowserLabel(value);
}

function hasAvailableRole(provider: ManagedProviderConfig): boolean {
  if (Array.isArray(provider.roles)) {
    return provider.roles.some((role) => role === "available" || role === "primary" || role === "backup");
  }
  return provider.role === "available" || provider.role === "primary" || provider.role === "backup";
}

/** Return managed providers that are currently selectable by Chat for a project. */
export function getManagedChatProviders(projectId: string): ExpandedChatProviderInfo[] {
  const stored = settings.getSetting(projectId, "llm_provider_configs");
  let providers: unknown[] = [];

  try {
    const parsed = stored ? JSON.parse(stored) : [];
    providers = Array.isArray(parsed) ? parsed : [];
  } catch {
    providers = [];
  }

  return providers.flatMap((provider) => {
    if (!isRecord(provider)) return [];
    const managedProvider = provider as ManagedProviderConfig;
    if (managedProvider.enabled !== true || !hasAvailableRole(managedProvider)
      || managedProvider.id === BUILTIN_CHAT_PROVIDER_ID
      || !isValidChatSelectionIdentifier(managedProvider.id)
      || !Array.isArray(managedProvider.models)
      || !isValidChatSelectionIdentifier(managedProvider.defaultModel)) {
      return [];
    }
    const models = managedProvider.models
      .filter(isValidChatSelectionIdentifier)
      .map((id) => ({ id, label: id }));
    if (models.length === 0) return [];
    return [{
      providerId: managedProvider.id,
      label: isSafeChatLabel(managedProvider.name) ? managedProvider.name : managedProvider.id,
      models,
      defaultModel: models.some((model) => model.id === managedProvider.defaultModel)
        ? managedProvider.defaultModel
        : models[0]!.id,
      source: "managed" as const,
    }];
  });
}

/**
 * Compatibility projection for the legacy `/settings/llm-config` fields.
 *
 * Those settings predate managed provider blocks, so their values are never
 * trusted as a browser catalog. Only a complete, exact provider/model pair is
 * admitted, and the provider must be one of the small legacy execution
 * allowlist. This intentionally excludes arbitrary settings-table values.
 */
function getValidatedLegacyLlmConfigProviders(projectId: string): ExpandedChatProviderInfo[] {
  const pairs = ([
    {
      role: "primary" as const,
      provider: settings.getSetting(projectId, "synthesis_provider") || "",
      model: settings.getSetting(projectId, "synthesis_model") || "",
    },
    {
      role: "backup" as const,
      provider: settings.getSetting(projectId, "synthesis_backup_provider") || "",
      model: settings.getSetting(projectId, "synthesis_backup_model") || "",
    },
  ]);
  const providers = new Map<string, ExpandedChatProviderInfo>();

  for (const pair of pairs) {
    const label = LEGACY_LLM_PROVIDER_LABELS[pair.provider];
    const providerId = pair.provider === "__custom__"
      ? `ingenium-${pair.role}`
      : pair.provider;
    if (!label || !isValidChatSelectionIdentifier(providerId)
      || !isValidChatSelectionIdentifier(pair.model)) {
      continue;
    }

    const existing = providers.get(providerId);
    if (existing) {
      if (!existing.models.some((model) => model.id === pair.model)) {
        existing.models.push({ id: pair.model, label: pair.model });
      }
      continue;
    }

    providers.set(providerId, {
      providerId,
      label,
      models: [{ id: pair.model, label: pair.model }],
      defaultModel: pair.model,
      source: "managed",
    });
  }

  return [...providers.values()];
}

export function getBuiltinChatProvider(result: unknown): ExpandedChatProviderInfo | null {
  if (isOpenCodeError(result)) return null;
  if (!isRecord(result) || !Array.isArray(result.all)) return null;
  const opencodeZen = result.all.find((provider): provider is Record<string, unknown> =>
    isRecord(provider) && provider.id === BUILTIN_CHAT_PROVIDER_ID,
  );
  if (!opencodeZen || !isRecord(opencodeZen.models)) return null;

  const models = Object.values(opencodeZen.models)
    .flatMap((model) => {
      if (!isRecord(model)) return [];
      const candidate = model;
      const cost = candidate.cost;
      if (candidate.status !== "active" || typeof candidate.id !== "string"
        || !isValidChatSelectionIdentifier(candidate.id)
        || !isRecord(cost) || cost.input !== 0 || cost.output !== 0) {
        return [];
      }
      return [{
        id: candidate.id,
        label: isSafeChatLabel(candidate.name) ? candidate.name : candidate.id,
      }];
    });
  if (models.length === 0) return null;

  const runtimeDefault = isRecord(result.default) && isValidChatSelectionIdentifier(result.default.opencode)
    ? result.default.opencode
    : undefined;
  return {
    providerId: BUILTIN_CHAT_PROVIDER_ID,
    label: isSafeChatLabel(opencodeZen.name) ? opencodeZen.name : "OpenCode Zen",
    models,
    defaultModel: models.some((model) => model.id === runtimeDefault) ? runtimeDefault! : models[0]!.id,
    source: "builtin",
  };
}

export function getManagedPrimaryProvider(
  projectId: string,
  providers: ExpandedChatProviderInfo[],
): ExpandedChatProviderInfo | undefined {
  try {
    const stored = settings.getSetting(projectId, "llm_provider_configs");
    const configuredProviders = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(configuredProviders)) return undefined;
    return providers.find((candidate) => configuredProviders.some((item: unknown) => {
      if (!isRecord(item) || item.id !== candidate.providerId) return false;
      return Array.isArray(item.roles)
        ? item.roles.some((role) => role === "primary")
        : item.role === "primary";
    }));
  } catch {
    return undefined;
  }
}

export function getAllowedLegacyChatSelection(
  projectId: string,
  providers: ExpandedChatProviderInfo[],
  role: "primary" | "backup",
): { providerId: string; modelId: string } | null {
  const providerSetting = role === "primary" ? "synthesis_provider" : "synthesis_backup_provider";
  const modelSetting = role === "primary" ? "synthesis_model" : "synthesis_backup_model";
  const storedProvider = settings.getSetting(projectId, providerSetting) || "";
  const modelId = settings.getSetting(projectId, modelSetting) || "";
  const providerId = storedProvider === "__custom__"
    ? role === "primary" ? "ingenium-primary" : "ingenium-backup"
    : storedProvider;
  if (!isValidChatSelectionIdentifier(providerId) || !isValidChatSelectionIdentifier(modelId)) return null;
  const provider = providers.find((candidate) => candidate.providerId === providerId
    && candidate.models.some((model) => model.id === modelId));
  return provider ? { providerId, modelId } : null;
}

export async function getChatProviderCatalog(projectId: string): Promise<{
  providers: ExpandedChatProviderInfo[];
  /** A client-normalized OpenCode failure; details remain server-only. */
  unavailable: "network" | "catalog" | null;
}> {
  const managedProviders = getManagedChatProviders(projectId);
  const configuredProviders = managedProviders.length > 0
    ? managedProviders
    : getValidatedLegacyLlmConfigProviders(projectId);
  const builtinResult = await opencodeClient.listProviders();
  if (isOpenCodeError(builtinResult)) {
    // The client error shape may contain provider diagnostics. Convert every
    // failure into a route-owned signal so no caller can mistake it for a
    // valid empty catalog. Preserve the established startup state only for the
    // client-normalized network error; all other failures share the catalog
    // contract without exposing their code or message.
    return {
      providers: [],
      unavailable: builtinResult.error.code === "NETWORK_ERROR" ? "network" : "catalog",
    };
  }
  const builtinProvider = getBuiltinChatProvider(builtinResult);
  return {
    providers: builtinProvider ? [...configuredProviders, builtinProvider] : configuredProviders,
    unavailable: null,
  };
}

export function getDefaultChatSelection(
  projectId: string,
  providers: ExpandedChatProviderInfo[],
): { providerId: string; modelId: string } | null {
  const managedProviders = providers.filter((provider) => provider.source === "managed");
  const managedPrimary = getManagedPrimaryProvider(projectId, managedProviders);
  const builtinProvider = providers.find((provider) => provider.source === "builtin");
  if (managedPrimary) {
    return { providerId: managedPrimary.providerId, modelId: managedPrimary.defaultModel };
  }
  const legacyPrimary = getAllowedLegacyChatSelection(projectId, providers, "primary");
  if (legacyPrimary) return legacyPrimary;
  if (builtinProvider) {
    return { providerId: builtinProvider.providerId, modelId: builtinProvider.defaultModel };
  }
  // Do not silently select an arbitrary available managed provider. The user
  // must select one in Chat and Docs will validate that exact pair.
  return null;
}

/**
 * Read the server-owned Chat selection. This setting is written only by the
 * authenticated selection route after exact catalog validation; parsing it
 * defensively keeps stale or manually-corrupted state out of the broker.
 */
export function getPersistedChatSelection(
  projectId: string,
): { providerId: string; modelId: string } | null {
  const stored = settings.getSetting(projectId, CHAT_SELECTION_SETTING);
  if (!stored) return null;
  try {
    const parsed: unknown = JSON.parse(stored);
    if (!isRecord(parsed)
      || !isValidChatSelectionIdentifier(parsed.providerId)
      || !isValidChatSelectionIdentifier(parsed.modelId)) {
      return null;
    }
    return { providerId: parsed.providerId, modelId: parsed.modelId };
  } catch {
    return null;
  }
}

/** Prefer the validated stored user selection, otherwise use a safe default. */
export function getStoredOrDefaultChatSelection(
  projectId: string,
  providers: ExpandedChatProviderInfo[],
): { providerId: string; modelId: string } | null {
  const persisted = getPersistedChatSelection(projectId);
  if (persisted && isAllowedChatSelection(providers, persisted)) return persisted;
  return getDefaultChatSelection(projectId, providers);
}

export function isAllowedChatSelection(
  providers: ExpandedChatProviderInfo[],
  selection: { providerId: string; modelId: string },
): boolean {
  return isValidChatSelectionIdentifier(selection.providerId)
    && isValidChatSelectionIdentifier(selection.modelId)
    && providers.some((provider) => provider.providerId === selection.providerId
    && provider.models.some((model) => model.id === selection.modelId));
}
