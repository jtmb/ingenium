"use client";

import { useEffect, useState } from "react";
import { api, type ManagedProviderConfig, type ProviderRole } from "../../../../lib/api";
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
    apiKeySet: false,
  };
}

/** Stable key for a provider — uses the draft ID when available so editing the `id` field
 *  doesn't trigger a React key change that destroys and recreates the DOM element. */
function draftKey(provider: DraftProvider): string {
  return provider._draftId || provider.id;
}

function getPriorityRole(roles: ProviderRole[]): ProviderRole {
  if (roles.includes("primary")) return "primary";
  if (roles.includes("backup")) return "backup";
  return "available";
}

export default function PipelinePanel() {
  const [providers, setProviders] = useState<DraftProvider[]>([]);
  const [collapsed, setCollapsed] = useState<Record<string, boolean>>({});
  const [visibleKeys, setVisibleKeys] = useState<Record<string, boolean>>({});
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [status, setStatus] = useState("");
  const [intervalMin, setIntervalMin] = useState(15);

  useEffect(() => {
    Promise.all([
      api.settings.getProviderConfigs("global-default"),
      api.settings.get("synthesis_interval_ms", "global-default"),
    ])
      .then(([providerResponse, intervalResponse]) => {
        setProviders(providerResponse.data.providers);
        const ms = Number(intervalResponse.data.value);
        if (Number.isFinite(ms) && ms >= 0) setIntervalMin(ms / 60000);
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

  const setRole = (index: number, role: ProviderRole) => {
    setProviders((current) => current.map((provider, providerIndex) => {
      if (providerIndex === index) {
        return { ...provider, roles: role === "available" ? ["available"] : ["available", role] };
      }
      if (role !== "available" && provider.roles.includes(role)) {
        return {
          ...provider,
          roles: ["available", ...provider.roles.filter((providerRole) => providerRole !== "available" && providerRole !== role)],
        };
      }
      return provider;
    }));
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
        (p) => { const { _draftId: _unused, ...rest } = p; return rest as ManagedProviderConfig; },
      );
      const response = await api.settings.saveProviderConfigs(providersToSave, "global-default");
      const refreshed = await api.settings.getProviderConfigs("global-default");
      setProviders(refreshed.data.providers);
      setStatus(response.data.warnings.length > 0
        ? `Saved. ${response.data.warnings.join(" ")}`
        : "Saved. Restart OpenCode to load provider changes.");
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

  return (
    <div className="px-6 py-5">
      <div className="flex flex-wrap items-start justify-between gap-3 mb-5">
        <div>
          <h3 className="text-base font-semibold text-[var(--color-text-primary)]">LLM Providers</h3>
          <p className="text-xs text-[var(--color-text-muted)] mt-1 max-w-2xl">
            Build the provider catalog used by OpenCode and Ingenium. Provider order is preserved;
            primary and backup roles control synthesis and Chat defaults.
          </p>
        </div>
        <button
          type="button"
          onClick={() => setProviders((current) => [...current, newProvider(current.length)])}
          className="rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm font-medium text-[var(--color-text-primary)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
        >
          + Add provider
        </button>
      </div>

      {loading ? (
        <div className="py-10 text-center text-sm text-[var(--color-text-muted)] animate-pulse">Loading providers...</div>
      ) : providers.length === 0 ? (
        <button
          type="button"
          onClick={() => setProviders([newProvider(0)])}
          className="w-full rounded-xl border border-dashed border-[var(--color-border)] px-6 py-12 text-center text-sm text-[var(--color-text-muted)] hover:border-blue-500 hover:text-[var(--color-text-primary)] cursor-pointer"
        >
          No providers configured. Add your first provider.
        </button>
      ) : (
        <div className="space-y-4">
          {providers.map((provider, index) => {
            const key = draftKey(provider);
            const isCollapsed = Boolean(collapsed[key]);
            const priorityRole = getPriorityRole(provider.roles);
            return (
              <section
                key={key}
                className={`rounded-xl border bg-[var(--color-surface)] overflow-hidden ${
                  priorityRole === "primary"
                    ? "border-blue-500/70"
                    : priorityRole === "backup"
                      ? "border-amber-500/70"
                      : "border-[var(--color-border)]"
                }`}
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
                      {priorityRole !== "available" && (
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${
                          priorityRole === "primary" ? "bg-blue-500/15 text-blue-500" : "bg-amber-500/15 text-amber-500"
                        }`}>
                          {priorityRole}
                        </span>
                      )}
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
                        <input value={provider.id} onChange={(event) => updateProvider(index, { id: event.target.value.toLowerCase() })} className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 font-mono text-sm text-[var(--color-text-primary)]" />
                      </label>
                      <label className="text-xs font-medium text-[var(--color-text-secondary)]">
                        Provider package
                        <select value={provider.npm} onChange={(event) => updateProvider(index, { npm: event.target.value })} className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm hover:bg-[var(--color-surface-hover)] cursor-pointer">
                          {PACKAGE_OPTIONS.map(([value, label]) => <option key={value} value={value}>{label} ({value})</option>)}
                        </select>
                      </label>
                      <label className="text-xs font-medium text-[var(--color-text-secondary)]">
                        Role
                        <select value={priorityRole} onChange={(event) => setRole(index, event.target.value as ProviderRole)} className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-sm hover:bg-[var(--color-surface-hover)] cursor-pointer">
                          <option value="available">Available in OpenCode</option>
                          <option value="primary">Primary for Ingenium</option>
                          <option value="backup">Backup for Ingenium</option>
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
                  </div>
                )}
              </section>
            );
          })}
        </div>
      )}

      <div className="mt-6 border-t border-[var(--color-border)] pt-5">
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
    </div>
  );
}
