import { projects, settings } from "ingenium-core";
import {
  getAllowedLegacyChatSelection,
  getChatProviderCatalog,
  getStoredOrDefaultChatSelection,
  type ExpandedChatProviderInfo,
} from "./chat-provider-catalog.js";

export interface SynthesisProviderSelection {
  providerID: string;
  modelID: string;
}

export interface SynthesisProviderResolution {
  selections: SynthesisProviderSelection[];
  catalogUnavailable: boolean;
}

interface ManagedProviderConfig {
  id?: unknown;
  models?: unknown;
  roles?: unknown;
  role?: unknown;
  enabled?: unknown;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasRole(config: ManagedProviderConfig, role: "primary" | "backup"): boolean {
  return Array.isArray(config.roles)
    ? config.roles.includes(role)
    : config.role === role;
}

function getManagedSynthesisSelection(
  projectId: string,
  providers: ExpandedChatProviderInfo[],
  role: "primary" | "backup",
): SynthesisProviderSelection | null {
  const selection = getAllowedLegacyChatSelection(projectId, providers, role);
  if (!selection) return null;

  const provider = providers.find((candidate) => candidate.providerId === selection.providerId);
  if (!provider || provider.source !== "managed") return null;

  try {
    const stored = settings.getSetting(projectId, "llm_provider_configs");
    const configuredProviders: unknown = stored ? JSON.parse(stored) : [];
    if (!Array.isArray(configuredProviders)) return null;
    const managed = configuredProviders.find((entry): entry is ManagedProviderConfig =>
      isRecord(entry)
      && entry.id === selection.providerId
      && entry.enabled === true
      && hasRole(entry, role)
      && Array.isArray(entry.models)
      && entry.models.includes(selection.modelId),
    );
    return managed ? { providerID: selection.providerId, modelID: selection.modelId } : null;
  } catch {
    return null;
  }
}

function appendUnique(
  selections: SynthesisProviderSelection[],
  candidate: SynthesisProviderSelection | null,
): void {
  if (!candidate || selections.some((selection) =>
    selection.providerID === candidate.providerID && selection.modelID === candidate.modelID,
  )) {
    return;
  }
  selections.push(candidate);
}

/**
 * Resolve server-owned broker choices without accepting any request-provided
 * provider/model pair. Managed primary and backup roles are used only when the
 * stored pair is still present in the sanitized catalog. A stale or absent
 * managed choice falls through to the server-resolved Chat default, which can
 * be OpenCode Zen.
 *
 * Managed synthesis configuration is globally owned. External projects retain
 * their own execution scope while sharing that global configuration; if no
 * active global project exists, the current project is the safe fallback.
 */
export async function resolveSynthesisProviderSelections(
  projectId: string,
): Promise<SynthesisProviderResolution> {
  const catalogProjectId = projects.getGlobalProject()?.id ?? projectId;
  const catalog = await getChatProviderCatalog(catalogProjectId);
  if (catalog.unavailable) {
    return { selections: [], catalogUnavailable: true };
  }

  const selections: SynthesisProviderSelection[] = [];
  appendUnique(selections, getManagedSynthesisSelection(catalogProjectId, catalog.providers, "primary"));
  appendUnique(selections, getManagedSynthesisSelection(catalogProjectId, catalog.providers, "backup"));

  const chatDefault = getStoredOrDefaultChatSelection(catalogProjectId, catalog.providers);
  appendUnique(selections, chatDefault && {
    providerID: chatDefault.providerId,
    modelID: chatDefault.modelId,
  });

  return { selections, catalogUnavailable: false };
}
