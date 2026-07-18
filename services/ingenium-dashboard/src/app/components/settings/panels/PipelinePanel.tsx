"use client";

import { useEffect, useRef, useState } from "react";
import { api, type ManagedProviderConfig } from "../../../../lib/api";
import {
  opencode,
  type OpenCodeIntegration,
  type OpenCodeIntegrationAttempt,
  type OpenCodeIntegrationMethod,
  type OpenCodeProvider,
} from "../../../../lib/opencode";
import SettingRow from "../SettingRow";

/** Internal type that adds a stable draft ID for React keys and collapse/key-visibility state. */
type DraftProvider = ManagedProviderConfig & { _draftId?: string };

const PACKAGE_OPTIONS = [
  ["@ai-sdk/openai-compatible", "OpenAI compatible"],
  ["@ai-sdk/openai", "OpenAI"],
  ["@ai-sdk/anthropic", "Anthropic"],
  ["@ai-sdk/deepseek", "DeepSeek"],
  ["@ai-sdk/google", "Google"],
  ["@ai-sdk/azure", "Azure OpenAI"],
  ["@ai-sdk/mistral", "Mistral"],
  ["@ai-sdk/xai", "xAI"],
  ["@ai-sdk/groq", "Groq"],
  ["@ai-sdk/cohere", "Cohere"],
  ["@ai-sdk/amazon-bedrock", "Amazon Bedrock"],
  ["@openrouter/ai-sdk-provider", "OpenRouter"],
] as const;

const POPULAR_PROVIDER_IDS = [
  "opencode",
  "opencode-go",
  "openai",
  "anthropic",
  "github-copilot",
  "deepseek",
] as const;

function newProvider(index: number): DraftProvider {
  return {
    id: `provider-${index + 1}`,
    _draftId: crypto.randomUUID(),
    name: `Provider ${index + 1}`,
    npm: "@ai-sdk/openai-compatible",
    baseURL: "",
    models: [""],
    defaultModel: "",
    roles: ["available"],
    enabled: true,
    allowPrivateNetwork: false,
    apiKeySet: false,
  };
}

/** Stable key for a provider — uses the draft ID when available so editing the `id` field
 *  doesn't trigger a React key change that destroys and recreates the DOM element. */
function draftKey(provider: DraftProvider): string {
  return provider._draftId || provider.id;
}

export default function PipelinePanel() {
  const [providers, setProviders] = useState<DraftProvider[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [intervalMin, setIntervalMin] = useState(15);
  const [primaryProviderId, setPrimaryProviderId] = useState("");
  const [backupProviderId, setBackupProviderId] = useState("");
  const [nativeProviders, setNativeProviders] = useState<OpenCodeProvider[]>([]);
  const [integrations, setIntegrations] = useState<OpenCodeIntegration[]>([]);
  const [connectProviderId, setConnectProviderId] = useState<string | null>(null);
  const [connectMethod, setConnectMethod] = useState<OpenCodeIntegrationMethod | null>(null);
  const [connectInputs, setConnectInputs] = useState<Record<string, string>>({});
  const [connectKey, setConnectKey] = useState("");
  const [oauthAttempt, setOauthAttempt] = useState<OpenCodeIntegrationAttempt | null>(null);
  const [oauthCode, setOauthCode] = useState("");
  const [connecting, setConnecting] = useState(false);
  const activeAttemptRef = useRef<string | null>(null);

  const refreshNativeProviders = async () => {
    const [runtime, integrationResponse] = await Promise.all([
      opencode.providers.list("/workspace"),
      opencode.integrations.list("/workspace"),
    ]);
    setNativeProviders(runtime.all);
    setIntegrations(integrationResponse.data);
  };

  useEffect(() => {
    Promise.all([
      api.settings.getProviderConfigs("global-default"),
      api.settings.get("synthesis_interval_ms", "global-default"),
      opencode.providers.list("/workspace"),
      opencode.integrations.list("/workspace"),
    ])
      .then(([providerResponse, intervalResponse, runtime, integrationResponse]) => {
        setProviders(providerResponse.data.providers);
        setPrimaryProviderId(providerResponse.data.providers.find((provider) => provider.roles.includes("primary"))?.id ?? "");
        setBackupProviderId(providerResponse.data.providers.find((provider) => provider.roles.includes("backup"))?.id ?? "");
        const ms = Number(intervalResponse.data.value);
        if (Number.isFinite(ms) && ms >= 0) setIntervalMin(ms / 60000);
        setNativeProviders(runtime.all);
        setIntegrations(integrationResponse.data);
      })
      .catch((error: unknown) => {
        setStatus(error instanceof Error ? error.message : "Unable to load provider configuration");
      })
      .finally(() => setLoading(false));
  }, []);

  const updateProvider = (index: number, patch: Partial<ManagedProviderConfig>) => {
    setProviders((current) => current.map((provider, providerIndex) => (
      providerIndex === index ? { ...provider, ...patch } : provider
    )));
  };

  const updateModel = (providerIndex: number, modelIndex: number, model: string) => {
    setProviders((current) => current.map((provider, index) => {
      if (index !== providerIndex) return provider;
      const previousModel = provider.models[modelIndex];
      const models = provider.models.map((value, currentModelIndex) => currentModelIndex === modelIndex ? model : value);
      return {
        ...provider,
        models,
        defaultModel: provider.defaultModel === previousModel || !provider.defaultModel ? model : provider.defaultModel,
      };
    }));
  };

  const removeModel = (providerIndex: number, modelIndex: number) => {
    setProviders((current) => current.map((provider, index) => {
      if (index !== providerIndex || provider.models.length === 1) return provider;
      const models = provider.models.filter((_, currentModelIndex) => currentModelIndex !== modelIndex);
      return {
        ...provider,
        models,
        defaultModel: models.includes(provider.defaultModel) ? provider.defaultModel : models[0] || "",
      };
    }));
  };

  const moveProvider = (index: number, direction: -1 | 1) => {
    const target = index + direction;
    if (target < 0 || target >= providers.length) return;
    setProviders((current) => {
      const next = [...current];
      [next[index], next[target]] = [next[target]!, next[index]!];
      return next;
    });
  };

  const save = async () => {
    setSaving(true);
    setStatus("");
    try {
      const providersToSave: ManagedProviderConfig[] = providers.map(
        (p) => {
          const { _draftId: _unused, ...rest } = p;
          const roles = ["available", ...(p.id === primaryProviderId ? ["primary"] : []), ...(p.id === backupProviderId ? ["backup"] : [])];
          return { ...rest, roles } as ManagedProviderConfig;
        },
      );
      const response = await api.settings.saveProviderConfigs(providersToSave, "global-default");
      const refreshed = await api.settings.getProviderConfigs("global-default");
        setProviders(refreshed.data.providers);
        setPrimaryProviderId(refreshed.data.providers.find((provider) => provider.roles.includes("primary"))?.id ?? "");
        setBackupProviderId(refreshed.data.providers.find((provider) => provider.roles.includes("backup"))?.id ?? "");
        setStatus(response.data.warnings.length > 0
          ? `Saved. ${response.data.warnings.join(" ")}`
          : "Saved. OpenCode provider configuration reloaded.");
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : "Provider configuration could not be saved");
    } finally {
      setSaving(false);
    }
  };

  const saveInterval = async (minutes: number) => {
    setIntervalMin(minutes);
    try {
      await api.settings.set("synthesis_interval_ms", String(minutes * 60000), "global-default");
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : "Synthesis interval could not be saved");
    }
  };

  const isNativeConnected = (providerId: string) => (
    Boolean(integrations.find((integration) => integration.id === providerId)?.connections.length)
  );

  const openConnect = (providerId: string) => {
    const integration = integrations.find((candidate) => candidate.id === providerId);
    const method = integration?.methods.find((candidate) => candidate.type === "oauth")
      ?? integration?.methods.find((candidate) => candidate.type === "key")
      ?? null;
    setConnectProviderId(providerId);
    setConnectMethod(method);
    setConnectInputs({});
    setConnectKey("");
    setOauthAttempt(null);
    setOauthCode("");
    setStatus("");
  };

  const closeConnect = async () => {
    const attemptID = activeAttemptRef.current;
    activeAttemptRef.current = null;
    if (attemptID) await opencode.integrations.cancelAttempt(attemptID).catch(() => undefined);
    setConnectProviderId(null);
    setConnectMethod(null);
    setOauthAttempt(null);
    setConnectKey("");
    setOauthCode("");
  };

  const waitForOAuth = async (attempt: OpenCodeIntegrationAttempt) => {
    for (let count = 0; count < 60 && activeAttemptRef.current === attempt.attemptID; count += 1) {
      const response = await opencode.integrations.attemptStatus(attempt.attemptID);
      if (response.data.status === "complete") return true;
      if (response.data.status === "failed" || response.data.status === "expired") {
        throw new Error(response.data.message || `Connection ${response.data.status}`);
      }
      await new Promise((resolve) => setTimeout(resolve, 2000));
    }
    return false;
  };

  const connectNativeProvider = async () => {
    if (!connectProviderId || !connectMethod) return;
    setConnecting(true);
    setStatus("");
    try {
      if (connectMethod.type === "key") {
        await opencode.integrations.connectKey(connectProviderId, connectKey);
        await refreshNativeProviders();
        setConnectProviderId(null);
        setConnectMethod(null);
        setConnectKey("");
        setStatus("Provider connected. Models were discovered automatically.");
        return;
      }
      if (!connectMethod.id) throw new Error("This OAuth method is unavailable");
      const response = await opencode.integrations.beginOAuth(connectProviderId, connectMethod.id, connectInputs);
      setOauthAttempt(response.data);
      activeAttemptRef.current = response.data.attemptID;
      window.open(response.data.url, "_blank", "noopener,noreferrer");
      setStatus("Complete authorization in the opened page. A direct link is available in this dialog.");
      if (response.data.mode === "auto") {
        void waitForOAuth(response.data).then(async (connected) => {
          if (!connected) return;
          activeAttemptRef.current = null;
          await refreshNativeProviders();
          setConnectProviderId(null);
          setConnectMethod(null);
          setOauthAttempt(null);
          setStatus("Provider connected. Models were discovered automatically.");
        }).catch((error: unknown) => {
          setStatus(error instanceof Error ? error.message : "Provider connection failed");
        });
      }
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : "Provider connection failed");
    } finally {
      setConnecting(false);
    }
  };

  const finishOAuth = async () => {
    if (!oauthAttempt) return;
    setConnecting(true);
    try {
      if (oauthAttempt.mode === "code") {
        await opencode.integrations.completeAttempt(oauthAttempt.attemptID, oauthCode || undefined);
      } else {
        const response = await opencode.integrations.attemptStatus(oauthAttempt.attemptID);
        if (response.data.status !== "complete") {
          setStatus(response.data.message || `Connection status: ${response.data.status}`);
          return;
        }
      }
      await refreshNativeProviders();
      activeAttemptRef.current = null;
      setConnectProviderId(null);
      setConnectMethod(null);
      setOauthAttempt(null);
      setOauthCode("");
      setStatus("Provider connected. Models were discovered automatically.");
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : "OAuth connection failed");
    } finally {
      setConnecting(false);
    }
  };

  const disconnectNativeProvider = async (providerId: string) => {
    setStatus("");
    try {
      await opencode.auth.disconnect(providerId);
      await refreshNativeProviders();
      setStatus("Provider disconnected.");
    } catch (error: unknown) {
      setStatus(error instanceof Error ? error.message : "Provider could not be disconnected");
    }
  };

  const popularProviders = POPULAR_PROVIDER_IDS
    .map((id) => nativeProviders.find((provider) => provider.id === id))
    .filter((provider): provider is OpenCodeProvider => Boolean(provider));
  const managedIds = new Set(providers.map((provider) => provider.id));
  const connectedNativeProviders = nativeProviders.filter((provider) => (
    isNativeConnected(provider.id) && !managedIds.has(provider.id)
  ));
  const selectedIntegration = integrations.find((integration) => integration.id === connectProviderId);
  const actionableMethods = selectedIntegration?.methods.filter((method) => method.type === "key" || method.type === "oauth") ?? [];
  const selectedNativeProvider = nativeProviders.find((provider) => provider.id === connectProviderId);

  return (
    <div className="px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h3 className="text-base font-semibold text-[var(--color-text-primary)]">Providers</h3>
          <p className="text-xs text-[var(--color-text-muted)] mt-1 max-w-2xl">
            Connect native OpenCode providers or configure an OpenAI-compatible custom endpoint.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setProviders((current) => [...current, newProvider(current.length)])}
          className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
        >
          + Add custom provider
        </button>
      </div>

      <section className="mb-6">
        <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">Connected providers</h4>
        <div className="mt-3 space-y-2">
          {connectedNativeProviders.length === 0 ? (
            <p className="rounded-lg border border-dashed border-[var(--color-border)] px-4 py-5 text-sm text-[var(--color-text-muted)]">No native providers connected.</p>
          ) : connectedNativeProviders.map((provider) => (
            <div key={provider.id} className="flex items-center justify-between gap-4 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] px-4 py-3">
              <div className="min-w-0">
                <div className="font-medium text-sm text-[var(--color-text-primary)]">{provider.name}</div>
                <div className="text-xs text-[var(--color-text-muted)]">{Object.keys(provider.models).length} models available automatically</div>
              </div>
              <button type="button" onClick={() => disconnectNativeProvider(provider.id)} className="text-xs font-medium text-red-500 hover:underline cursor-pointer">Disconnect</button>
            </div>
          ))}
        </div>
      </section>

      <section className="mb-6">
        <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">Native providers</h4>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">Authentication and model catalogs are managed by OpenCode.</p>
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          {popularProviders.map((provider) => {
            const connected = isNativeConnected(provider.id);
            return (
              <div key={provider.id} className="flex items-center justify-between gap-3 rounded-lg border border-[var(--color-border)] bg-[var(--color-surface)] p-4">
                <div className="min-w-0">
                  <div className="font-medium text-sm text-[var(--color-text-primary)]">{provider.name}</div>
                  <div className="mt-0.5 text-xs text-[var(--color-text-muted)]">{Object.keys(provider.models).length} models</div>
                </div>
                {connected ? (
                  <span className="rounded-full bg-green-500/15 px-2 py-1 text-[11px] font-medium text-green-600 dark:text-green-400">Connected</span>
                ) : (
                  <button type="button" onClick={() => openConnect(provider.id)} className="rounded border border-[var(--color-border)] px-3 py-1.5 text-xs font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] cursor-pointer">Connect</button>
                )}
              </div>
            );
          })}
        </div>
      </section>

      <div className="mb-3 border-t border-[var(--color-border)] pt-5">
        <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">Custom providers</h4>
        <p className="mt-1 text-xs text-[var(--color-text-muted)]">Use this for LM Studio and other custom OpenAI-compatible endpoints.</p>
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-[var(--color-text-muted)] animate-pulse">Loading providers...</div>
      ) : providers.length === 0 ? (
        <button
          type="button"
          onClick={() => setProviders([newProvider(0)])}
          className="w-full rounded-xl border border-dashed border-[var(--color-border)] px-6 py-12 text-center text-sm text-[var(--color-text-muted)] hover:border-blue-500 hover:text-[var(--color-text-primary)] cursor-pointer"
        >
          No custom providers configured. Add your first custom provider.
        </button>
      ) : (
        <div className="space-y-4">
          {providers.map((provider, index) => {
            const key = draftKey(provider);
            const isCollapsed = Boolean(collapsed[key]);
            return (
              <section
                key={key}
                className="rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] overflow-hidden"
              >
                <div className="flex items-center gap-3 px-4 py-3 bg-[var(--color-surface-muted)] border-b border-[var(--color-border)]">
                  <button
                    type="button"
                    onClick={() => setCollapsed((current) => ({ ...current, [key]: !isCollapsed }))}
                    className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer"
                    aria-label={isCollapsed ? `Expand ${provider.name}` : `Collapse ${provider.name}`}
                  >
                    {isCollapsed ? "▸" : "▾"}
                  </button>
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className="truncate text-sm font-semibold text-[var(--color-text-primary)]">{provider.name || "Unnamed provider"}</span>
                      {!provider.enabled && <span className="text-[10px] uppercase text-[var(--color-text-muted)]">Disabled</span>}
                    </div>
                    <div className="truncate font-mono text-[11px] text-[var(--color-text-muted)]">{provider.id}</div>
                  </div>
                  <button type="button" onClick={() => moveProvider(index, -1)} disabled={index === 0} className="px-1 text-sm text-[var(--color-text-muted)] disabled:opacity-30 cursor-pointer" aria-label={`Move ${provider.name} up`}>↑</button>
                  <button type="button" onClick={() => moveProvider(index, 1)} disabled={index === providers.length - 1} className="px-1 text-sm text-[var(--color-text-muted)] disabled:opacity-30 cursor-pointer" aria-label={`Move ${provider.name} down`}>↓</button>
                  <button
                    type="button"
                    onClick={() => setProviders((current) => current.filter((_, currentIndex) => currentIndex !== index))}
                    className="ml-1 rounded px-2 py-1 text-xs text-red-500 hover:bg-red-500/10 cursor-pointer"
                  >
                    Remove
                  </button>
                </div>

                {!isCollapsed && (
                  <div className="p-4 space-y-4">
                    <div className="grid gap-4 md:grid-cols-2">
                      <label className="text-xs font-medium text-[var(--color-text-secondary)]">
                        Display name
                        <input value={provider.name} onChange={(event) => updateProvider(index, { name: event.target.value })} className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)]" />
                      </label>
                      <label className="text-xs font-medium text-[var(--color-text-secondary)]">
                        Provider ID
                        <input value={provider.id} onChange={(event) => {
                          const nextId = event.target.value.toLowerCase();
                          if (primaryProviderId === provider.id) setPrimaryProviderId(nextId);
                          if (backupProviderId === provider.id) setBackupProviderId(nextId);
                          updateProvider(index, { id: nextId });
                        }} className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)]" />
                      </label>
                      <label className="text-xs font-medium text-[var(--color-text-secondary)]">
                        Provider package
                        <select value={provider.npm} onChange={(event) => updateProvider(index, { npm: event.target.value })} className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm hover:bg-[var(--color-surface-hover)] cursor-pointer">
                          {PACKAGE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label} ({value})</option>)}
                        </select>
                      </label>
                    </div>

                    <label className="block text-xs font-medium text-[var(--color-text-secondary)]">
                      Base URL <span className="font-normal text-[var(--color-text-muted)]">(optional for native providers)</span>
                      <input value={provider.baseURL} onChange={(event) => updateProvider(index, { baseURL: event.target.value })} placeholder="https://api.provider.com/v1" className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)]" />
                    </label>

                    <label className="block text-xs font-medium text-[var(--color-text-secondary)]">
                      API key
                      <div className="mt-1 flex gap-2">
                        <input
                          type={visibleKeys[key] ? "text" : "password"}
                          value={provider.apiKey || ""}
                          onChange={(event) => updateProvider(index, { apiKey: event.target.value || undefined })}
                          placeholder={provider.apiKey === ""
                            ? "Saved key will be cleared"
                            : provider.apiKeySet ? "Saved key (leave blank to keep)" : "API key"}
                          autoComplete="off"
                          className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)]"
                        />
                        <button type="button" onClick={() => setVisibleKeys((current) => ({ ...current, [key]: !current[key] }))} className="rounded border border-[var(--color-border)] px-3 text-xs text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] cursor-pointer">
                          {visibleKeys[key] ? "Hide" : "Show"}
                        </button>
                        {provider.apiKeySet && (
                          <button
                            type="button"
                            onClick={() => updateProvider(index, { apiKey: provider.apiKey === "" ? undefined : "" })}
                            className="rounded border border-red-500/40 px-3 text-xs text-red-500 hover:bg-red-500/10 cursor-pointer"
                          >
                            {provider.apiKey === "" ? "Keep saved key" : "Clear saved key"}
                          </button>
                        )}
                      </div>
                    </label>

                    <div>
                      <div className="mb-2 flex items-center justify-between">
                        <span className="text-xs font-medium text-[var(--color-text-secondary)]">Models</span>
                        <button type="button" onClick={() => updateProvider(index, { models: [...provider.models, ""] })} className="text-xs font-medium text-blue-500 hover:underline cursor-pointer">+ Add model</button>
                      </div>
                      <div className="space-y-2">
                        {provider.models.map((model, modelIndex) => (
                          <div key={modelIndex} className="flex items-center gap-2">
                            <input type="radio" name={`default-model-${index}`} checked={provider.defaultModel === model && Boolean(model)} onChange={() => updateProvider(index, { defaultModel: model })} aria-label={`Use ${model || `model ${modelIndex + 1}`} as default`} />
                            <input value={model} onChange={(event) => updateModel(index, modelIndex, event.target.value)} placeholder="model-id" className="min-w-0 flex-1 rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)]" />
                            <button type="button" onClick={() => removeModel(index, modelIndex)} disabled={provider.models.length === 1} className="rounded px-2 py-1 text-xs text-red-500 hover:bg-red-500/10 disabled:opacity-30 cursor-pointer">Remove</button>
                          </div>
                        ))}
                      </div>
                      <p className="mt-1 text-[11px] text-[var(--color-text-muted)]">Select the radio button beside the default model.</p>
                    </div>

                    <label className="flex items-center gap-2 text-xs font-medium text-[var(--color-text-secondary)] cursor-pointer">
                      <input type="checkbox" checked={provider.enabled} onChange={(event) => updateProvider(index, { enabled: event.target.checked })} />
                      Enabled in OpenCode
                    </label>
                    <label className="flex items-center gap-2 text-xs font-medium text-[var(--color-text-secondary)] cursor-pointer">
                      <input type="checkbox" checked={provider.allowPrivateNetwork ?? false} onChange={(event) => updateProvider(index, { allowPrivateNetwork: event.target.checked })} />
                      Allow private network endpoints
                    </label>
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <div className="mt-6 border-t border-[var(--color-border)] pt-5">
        <div className="mb-5">
          <h4 className="text-sm font-semibold text-[var(--color-text-primary)]">Synthesis providers</h4>
          <p className="mt-1 text-xs text-[var(--color-text-muted)]">Choose the providers Ingenium uses for primary and secondary synthesis.</p>
          <div className="mt-3 grid gap-4 md:grid-cols-2">
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">
              Primary
              <select value={primaryProviderId} onChange={(event) => {
                setPrimaryProviderId(event.target.value);
                if (backupProviderId === event.target.value) setBackupProviderId("");
              }} className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm hover:bg-[var(--color-surface-hover)] cursor-pointer">
                <option value="">Not configured</option>
                {providers.filter((provider) => provider.enabled).map((provider) => <option key={provider.id} value={provider.id}>{provider.name} ({provider.id})</option>)}
              </select>
            </label>
            <label className="text-xs font-medium text-[var(--color-text-secondary)]">
              Secondary
              <select value={backupProviderId} onChange={(event) => setBackupProviderId(event.target.value)} className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm hover:bg-[var(--color-surface-hover)] cursor-pointer">
                <option value="">Not configured</option>
                {providers.filter((provider) => provider.enabled && provider.id !== primaryProviderId).map((provider) => <option key={provider.id} value={provider.id}>{provider.name} ({provider.id})</option>)}
              </select>
            </label>
          </div>
        </div>
        <SettingRow label="Synthesis schedule" description="How often Ingenium processes observations">
          <select value={String(intervalMin)} onChange={(event) => saveInterval(Number(event.target.value))} className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm hover:bg-[var(--color-surface-hover)] cursor-pointer">
            <option value="5">5 minutes</option>
            <option value="15">15 minutes</option>
            <option value="30">30 minutes</option>
            <option value="60">1 hour</option>
            <option value="240">4 hours</option>
            <option value="0">Disabled</option>
          </select>
        </SettingRow>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <button type="button" onClick={save} disabled={saving || loading} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer">
          {saving ? "Saving..." : "Save providers"}
        </button>
        {status && <span role="status" className="text-sm text-[var(--color-text-secondary)]">{status}</span>}
      </div>

      {connectProviderId && (
        <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" role="dialog" aria-modal="true" aria-label={`Connect ${selectedNativeProvider?.name ?? connectProviderId}`}>
          <div className="w-full max-w-lg rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-5 shadow-2xl">
            <div className="flex items-start justify-between gap-4">
              <div>
                <h4 className="text-base font-semibold text-[var(--color-text-primary)]">Connect {selectedNativeProvider?.name ?? connectProviderId}</h4>
                <p className="mt-1 text-xs text-[var(--color-text-muted)]">Models will be loaded automatically from OpenCode.</p>
              </div>
              <button type="button" onClick={closeConnect} aria-label="Close provider connection" className="text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] cursor-pointer">×</button>
            </div>

            {!oauthAttempt && (
              <div className="mt-5 space-y-4">
                {actionableMethods.length > 1 && (
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)]">
                    Login method
                    <select value={connectMethod?.id ?? connectMethod?.type ?? ""} onChange={(event) => {
                      const method = actionableMethods.find((candidate) => (candidate.id ?? candidate.type) === event.target.value) ?? null;
                      setConnectMethod(method);
                      setConnectInputs({});
                    }} className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm hover:bg-[var(--color-surface-hover)] cursor-pointer">
                      {actionableMethods.map((method, index) => <option key={`${method.id ?? method.type}-${index}`} value={method.id ?? method.type}>{method.label ?? (method.type === "key" ? "API key" : "OAuth")}</option>)}
                    </select>
                  </label>
                )}
                {connectMethod?.prompts?.map((prompt) => (
                  <label key={prompt.key} className="block text-xs font-medium text-[var(--color-text-secondary)]">
                    {prompt.message}
                    {prompt.type === "select" ? (
                      <select value={connectInputs[prompt.key] ?? ""} onChange={(event) => setConnectInputs((current) => ({ ...current, [prompt.key]: event.target.value }))} className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm hover:bg-[var(--color-surface-hover)] cursor-pointer">
                        <option value="">Select...</option>
                        {prompt.options?.map((option) => <option key={option.value} value={option.value}>{option.label}</option>)}
                      </select>
                    ) : (
                      <input value={connectInputs[prompt.key] ?? ""} onChange={(event) => setConnectInputs((current) => ({ ...current, [prompt.key]: event.target.value }))} placeholder={prompt.placeholder} className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)]" />
                    )}
                  </label>
                ))}
                {connectMethod?.type === "key" && (
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)]">
                    API key
                    <input type="password" value={connectKey} onChange={(event) => setConnectKey(event.target.value)} autoComplete="off" className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)]" />
                  </label>
                )}
                <button type="button" onClick={connectNativeProvider} disabled={connecting || !connectMethod || (connectMethod.type === "key" && !connectKey.trim())} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer">
                  {connecting ? "Connecting..." : connectMethod?.type === "oauth" ? "Continue in browser" : "Connect"}
                </button>
              </div>
            )}

            {oauthAttempt && (
              <div className="mt-5 space-y-4">
                {oauthAttempt.instructions && <p className="text-sm text-[var(--color-text-secondary)]">{oauthAttempt.instructions}</p>}
                <div className="flex flex-wrap items-center gap-3">
                  <a href={oauthAttempt.url} target="_blank" rel="noreferrer" className="inline-flex rounded border border-blue-500 px-3 py-2 text-sm font-medium text-blue-500 hover:bg-blue-500/10">Open authorization page</a>
                  {oauthAttempt.mode === "auto" && <span className="text-sm text-[var(--color-text-secondary)]">Waiting for authorization...</span>}
                </div>
                {oauthAttempt.mode === "code" && (
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)]">
                    Authorization code
                    <input type="password" value={oauthCode} onChange={(event) => setOauthCode(event.target.value)} autoComplete="off" className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm text-[var(--color-text-primary)]" />
                  </label>
                )}
                {oauthAttempt.mode === "code" && (
                  <button type="button" onClick={finishOAuth} disabled={connecting || !oauthCode.trim()} className="rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 disabled:opacity-50 cursor-pointer">
                    {connecting ? "Checking..." : "Complete connection"}
                  </button>
                )}
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
