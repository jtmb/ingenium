import type { vault } from "ingenium-core";
import { getBuiltinChatProvider } from "./chat-provider-catalog.js";
import { opencodeClient } from "./opencode-client.js";

export async function getNativeJobProviderCatalog() {
  return getBuiltinChatProvider(await opencodeClient.listProviders());
}

/** Select only a granted model; anonymous Zen also needs the current free catalog. */
export async function resolveJobProviderModel(provider: vault.JobProviderRuntimeResolution): Promise<string> {
  const identifier = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,255}$/;
  if (!identifier.test(provider.providerKey)) throw new Error("Job provider is unavailable");
  if (provider.authentication === "anonymous") {
    const catalog = await getNativeJobProviderCatalog();
    if (provider.providerKey !== "opencode" || !catalog?.models.some((model) => model.id === provider.modelId)) {
      throw new Error("Job provider is unavailable");
    }
    return provider.providerKey + "/" + provider.modelId;
  }
  const models = Array.isArray(provider.config.models)
    ? provider.config.models.filter((value): value is string => typeof value === "string" && identifier.test(value)) : [];
  const configured = provider.config.defaultModel;
  const selected = typeof configured === "string" && configured.length > 0
    ? models.includes(configured) ? configured : undefined
    : models.length === 1 ? models[0] : undefined;
  if (!selected) throw new Error("Job provider model is unavailable");
  return provider.providerKey + "/" + selected;
}
