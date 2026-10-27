import { projects } from "ingenium-core";
import { getChatProviderCatalog, type ExpandedChatProviderInfo } from "./chat-provider-catalog.js";
import { isSafeBrowserIdentifier, isSafeBrowserLabel } from "./browser-safe-scalars.js";
import { isOpenCodeError, opencodeClient } from "./opencode-client.js";

function record(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** Manual choices add connected native models without changing the Chat catalog or any defaults. */
export async function getManualSynthesisModels(projectId: string): Promise<{
  providers: ExpandedChatProviderInfo[];
  unavailable: boolean;
}> {
  const catalog = await getChatProviderCatalog(projects.getGlobalProject()?.id ?? projectId);
  if (catalog.unavailable) return { providers: [], unavailable: true };
  const native = await opencodeClient.listProviders();
  if (isOpenCodeError(native) || !record(native) || !Array.isArray(native.all) || !Array.isArray(native.connected)) {
    return { providers: [], unavailable: true };
  }
  const connected = new Set(native.connected.filter(isSafeBrowserIdentifier));
  const providers = [...catalog.providers];
  for (const provider of native.all) {
    if (!record(provider) || !isSafeBrowserIdentifier(provider.id) || !connected.has(provider.id)
      || providers.some((entry) => entry.providerId === provider.id) || !record(provider.models)) continue;
    const models = Object.values(provider.models).flatMap((model) => {
      if (!record(model) || model.status !== "active" || !isSafeBrowserIdentifier(model.id)) return [];
      return [{ id: model.id, label: isSafeBrowserLabel(model.name) ? model.name : model.id }];
    });
    if (!models.length) continue;
    providers.push({
      providerId: provider.id,
      label: isSafeBrowserLabel(provider.name) ? provider.name : provider.id,
      models,
      defaultModel: models[0]!.id,
      source: "builtin",
    });
  }
  return { providers, unavailable: false };
}
