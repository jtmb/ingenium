"use client";
import { useState, useEffect } from "react";
import { api } from "../../../../lib/api";
import SettingRow from "../SettingRow";

/** Get models array from a provider object. */
function providerModels(p: any): [string, any][] {
  return Object.entries(p?.models || {}) as [string, any][];
}

/**
 * Sort providers for the dropdown: known providers first with a fixed ranking
 * (OpenCode free → Pro → Zen → Go → DeepSeek → Zen), then alphabetically.
 * Filters out providers with no models.
 */
function sortProviders(providers: any[]): any[] {
  const pinned: [string, number][] = [
    ["opencode zen", 0],
    ["opencode pro", 1],
    ["opencode", 2],
    ["go", 3],
    ["deepseek", 4],
    ["zen", 5],
  ];
  const rank = (p: any): number => {
    const name = (p.name || "").toLowerCase();
    for (const [kw, r] of pinned) {
      if (name.includes(kw)) return r;
    }
    return 999;
  };
  return [...providers]
    .filter((p) => Object.keys(p.models || {}).length > 0)
    .sort((a, b) => {
      const ar = rank(a),
        br = rank(b);
      if (ar !== br) return ar - br;
      return a.name.localeCompare(b.name);
    });
}

/**
 * Synthesis pipeline settings: LLM provider selection (primary + backup),
 * API key management, custom endpoint support, and polling interval.
 *
 * Providers are fetched directly from the OpenCode HTTP API (port 4098) rather
 * than from the Ingenium API because OpenCode is the source of truth for
 * available LLM providers and their model listings.
 */
export default function PipelinePanel() {
  // Providers
  const [providers, setProviders] = useState<any[]>([]);
  const [loadingProviders, setLoadingProviders] = useState(true);
  const [loadingConfig, setLoadingConfig] = useState(true);

  // Primary
  const [providerId, setProviderId] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [apiKeyState, setApiKeyState] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [isCustom, setIsCustom] = useState(false);
  const [customModel, setCustomModel] = useState("");
  const [showCustom, setShowCustom] = useState(false);

  // Backup
  const [showBackup, setShowBackup] = useState(false);
  const [backupProviderId, setBackupProviderId] = useState("");
  const [backupSelectedModel, setBackupSelectedModel] = useState("");
  const [backupApiKey, setBackupApiKey] = useState("");
  const [backupIsCustom, setBackupIsCustom] = useState(false);
  const [backupCustomEndpoint, setBackupCustomEndpoint] = useState("");
  const [backupCustomModel, setBackupCustomModel] = useState("");

  // Interval
  const [intervalMin, setIntervalMin] = useState(15);
  const [loadingInterval, setLoadingInterval] = useState(true);

  // Actions
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [llmStatus, setLlmStatus] = useState("");

  // Password toggles
  const [showPw, setShowPw] = useState<Record<string, boolean>>({});
  const togglePw = (name: string) => setShowPw((prev) => ({ ...prev, [name]: !prev[name] }));

  const [toast, setToast] = useState("");
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Derived
  const selectedProvider = providers.find((p) => p.id === providerId);
  const primaryModels = providerModels(selectedProvider);
  const backupProvider = providers.find((p) => p.id === backupProviderId);
  const backupModels = providerModels(backupProvider);
  const sortedProviders = sortProviders(providers);

  // Fetch providers from OpenCode's own HTTP API (port 4098).
  // This is the canonical source for available LLM providers + their models.
  useEffect(() => {
    fetch("/opencode-proxy/provider?directory=/workspace")
      .then((r) => r.json())
      .then((d) => setProviders(d.all || []))
      .catch(() => setProviders([]))
      .finally(() => setLoadingProviders(false));
  }, []);

  // Load saved synthesis config — re-runs when providers arrive so we can
  // match the stored model ID against the provider's model list.
  useEffect(() => {
    Promise.all([
      api.settings.get("synthesis_provider", "global-default"),
      api.settings.get("synthesis_api_key", "global-default"),
      api.settings.get("synthesis_endpoint", "global-default"),
      api.settings.get("synthesis_model", "global-default"),
    ])
      .then(([p, k, e, m]) => {
        const pid = p.data?.value || "";
        setProviderId(pid);
        setIsCustom(pid === "__custom__");
        if (k.data?.value) setApiKeyState(k.data.value);
        if (e.data?.value) setEndpoint(e.data.value);
        if (pid === "__custom__") {
          if (m.data?.value) setCustomModel(m.data.value);
          setShowCustom(true);
        }
        if (pid && pid !== "__custom__" && m.data?.value) {
          const prov = providers.find((x) => x.id === pid);
          if (prov) {
            const match = Object.entries(prov.models || {}).find(
              ([, v]: [string, any]) => v.id === m.data.value,
            );
            if (match) setSelectedModel(match[0]);
          }
        }
      })
      .catch(() => {})
      .finally(() => setLoadingConfig(false));
  }, [providers]);

  // Load backup synthesis config — same re-run pattern as primary.
  useEffect(() => {
    Promise.all([
      api.settings.get("synthesis_backup_provider", "global-default"),
      api.settings.get("synthesis_backup_model", "global-default"),
      api.settings.get("synthesis_backup_endpoint", "global-default"),
      api.settings.get("synthesis_backup_api_key", "global-default"),
    ])
      .then(([pr, m, e, k]) => {
        const bPid = pr.data?.value || "";
        if (bPid) {
          setBackupProviderId(bPid);
          setShowBackup(true);
        }
        setBackupIsCustom(bPid === "__custom__");
        if (bPid === "__custom__") {
          if (m.data?.value) setBackupCustomModel(m.data.value);
          if (e.data?.value) setBackupCustomEndpoint(e.data.value);
        } else if (bPid && m.data?.value) {
          const bp = providers.find((x) => x.id === bPid);
          if (bp) {
            const match = Object.entries(bp.models || {}).find(
              ([, v]: [string, any]) => v.id === m.data.value,
            );
            if (match) setBackupSelectedModel(match[0]);
          }
        }
        if (k.data?.value) setBackupApiKey(k.data.value);
      })
      .catch(() => {});
  }, [providers]);

  // Load synthesis polling interval.
  useEffect(() => {
    api.settings
      .get("synthesis_interval_ms", "global-default")
      .then((r) => {
        const ms = parseInt(r.data.value, 10);
        if (!isNaN(ms) && ms >= 0) setIntervalMin(ms / 60000);
      })
      .catch(() => {})
      .finally(() => setLoadingInterval(false));
  }, []);

  // ── Actions ──

  const handleIntervalSave = async (min: number) => {
    try {
      await api.settings.set("synthesis_interval_ms", String(min * 60000), "global-default");
      setToast("Interval updated ✓");
    } catch (err: any) {
      setToast(`Error: ${err.message}`);
    }
  };

  /**
   * Save both primary and backup LLM configuration to the global-default project.
   * For non-custom providers, extracts the model ID and endpoint URL from the
   * provider metadata. The `__custom__` sentinel signals ad-hoc provider details.
   */
  const saveLlmConfig = async () => {
    setSaving(true);
    setLlmStatus("");
    try {
      let modelId = "";
      let ep = "";

      if (isCustom) {
        modelId = customModel;
        ep = endpoint;
      } else {
        const p = providers.find((x) => x.id === providerId);
        const models = providerModels(p);
        const model = models.find(([k]) => k === selectedModel) || models[0];
        modelId = model ? model[1]?.id || "" : "";
        ep = model ? model[1]?.api?.url || "" : "";
      }

      await api.settings.set("synthesis_model", modelId, "global-default");
      await api.settings.set("synthesis_provider", providerId, "global-default");
      if (apiKeyState) await api.settings.set("synthesis_api_key", apiKeyState, "global-default");
      await api.settings.set("synthesis_endpoint", ep, "global-default");
      setEndpoint(ep);

      if (backupProviderId) {
        await api.settings.set("synthesis_backup_provider", backupProviderId, "global-default");
        if (backupIsCustom) {
          if (backupCustomModel)
            await api.settings.set("synthesis_backup_model", backupCustomModel, "global-default");
          if (backupCustomEndpoint)
            await api.settings.set(
              "synthesis_backup_endpoint",
              backupCustomEndpoint,
              "global-default",
            );
        } else {
          const bp = backupProvider;
          const bModels = providerModels(bp);
          const bModel = bModels.find(([k]) => k === backupSelectedModel) || bModels[0];
          const bModelId = bModel ? bModel[1]?.id || "" : "";
          const bEp = bModel ? bModel[1]?.api?.url || "" : "";
          if (bModelId)
            await api.settings.set("synthesis_backup_model", bModelId, "global-default");
          if (bEp)
            await api.settings.set("synthesis_backup_endpoint", bEp, "global-default");
        }
      }
      if (backupApiKey)
        await api.settings.set("synthesis_backup_api_key", backupApiKey, "global-default");

      setLlmStatus("✅ Configuration saved");
      setToast("LLM config saved ✓");
    } catch (err: any) {
      setLlmStatus(`❌ Save failed: ${err.message}`);
    }
    setSaving(false);
  };

  /**
   * Test both primary and backup LLM connections sequentially via the API's
   * `testLlm` endpoint. Reports combined status (e.g., "✅ Primary OK | ✅ Backup OK").
   */
  const testLlmConnection = async () => {
    setTesting(true);
    setLlmStatus("");
    try {
      const modelId = isCustom
        ? customModel
        : (() => {
            const models = primaryModels;
            const match = models.find(([k]) => k === selectedModel) || models[0];
            return match?.[1]?.id || selectedModel || providerId;
          })();

      let status = "";
      const pr = await api.settings.testLlm(endpoint, modelId, apiKeyState);
      status = pr.ok ? "✅ Primary OK" : `❌ Primary: ${pr.status || "error"} ${pr.message || ""}`;

      if (backupProviderId) {
        const bModelId = backupIsCustom
          ? backupCustomModel
          : (() => {
              const models = backupModels;
              const match = models.find(([k]) => k === backupSelectedModel) || models[0];
              return match?.[1]?.id || backupSelectedModel || backupProviderId;
            })();
        const bEp = backupIsCustom
          ? backupCustomEndpoint
          : (backupModels[0]?.[1] as any)?.api?.url || backupCustomEndpoint;
        const br = await api.settings.testLlm(bEp, bModelId, backupApiKey);
        status += br.ok
          ? " | ✅ Backup OK"
          : ` | ❌ Backup: ${br.status || "error"} ${br.message || ""}`;
      }

      setLlmStatus(status);
    } catch (err: any) {
      setLlmStatus(`❌ ${err.message}`);
    }
    setTesting(false);
  };

  /**
   * Reusable password input with show/hide toggle.
   * Defined inline because it captures `showPw` and `togglePw` from the panel scope.
   */
  function PwInput({
    value,
    onChange,
    placeholder,
    name,
  }: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    name: string;
  }) {
    return (
      <div className="flex items-center gap-1">
        <input
          type={showPw[name] ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="border border-[var(--color-border)] rounded px-3 py-1.5 text-sm bg-[var(--color-surface)] w-56 text-[var(--color-text-primary)]"
        />
        <button
          type="button"
          onClick={() => togglePw(name)}
          className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] whitespace-nowrap px-1"
        >
          {showPw[name] ? "Hide" : "Show"}
        </button>
      </div>
    );
  }

  return (
    <div>
      <div className="px-6 pt-5 pb-2">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Synthesis LLM</h3>
        <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
          Select an LLM provider for the self-learning pipeline to synthesize observations into skills
          and update personality traits.
        </p>
      </div>

      {loadingProviders || loadingConfig ? (
        <div className="px-6 py-4 text-sm text-[var(--color-text-muted)] animate-pulse">
          Loading provider list...
        </div>
      ) : providers.length === 0 && !isCustom ? (
        <div className="px-6 py-4 text-sm text-[var(--color-warning-text)]">
          No OpenCode providers detected. Configure a provider or use Custom Provider below.
        </div>
      ) : null}

      <SettingRow label="Provider" description="Choose an LLM provider for synthesis">
        <select
          value={providerId}
          onChange={(e) => {
            const val = e.target.value;
            setProviderId(val);
            setIsCustom(val === "__custom__");
            if (val === "__custom__") {
              setEndpoint("");
              setSelectedModel("");
              setShowCustom(true);
            } else if (val) {
              const p = providers.find((x) => x.id === val);
              const models = providerModels(p);
              const firstModel = models[0];
              setEndpoint((firstModel?.[1] as any)?.api?.url || "");
              setSelectedModel(firstModel?.[0] || "");
              setShowCustom(false);
            } else {
              setSelectedModel("");
              setShowCustom(false);
            }
          }}
          className="border border-[var(--color-border)] rounded px-3 py-1.5 text-sm bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] cursor-pointer w-64"
        >
          <option value="">— No LLM (heuristics only) —</option>
          <option value="__custom__">— Custom Provider —</option>
          {sortedProviders.map((p) => {
            const isFree = p.id === "opencode";
            return (
              <option key={p.id} value={p.id}>
                {p.name}
                {isFree ? " (Free)" : ""}
              </option>
            );
          })}
        </select>
      </SettingRow>

      {!isCustom && providerId && primaryModels.length > 0 && (
        <SettingRow label="Model" description="Select a specific model from this provider">
          <select
            value={selectedModel}
            onChange={(e) => setSelectedModel(e.target.value)}
            className="border border-[var(--color-border)] rounded px-3 py-1.5 text-sm bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] cursor-pointer w-64"
          >
            {primaryModels.map(([key, val]) => (
              <option key={key} value={key}>
                {key} {(val as any)?.id ? `(${(val as any).id})` : ""}
              </option>
            ))}
          </select>
        </SettingRow>
      )}

      {!isCustom && providerId && (
        <SettingRow
          label="API Key"
          description={
            providerId === "opencode"
              ? "Optional for free tier"
              : "API key for this provider"
          }
        >
          <PwInput
            name="synthesisApiKey"
            value={apiKeyState}
            onChange={setApiKeyState}
            placeholder="sk-..."
          />
        </SettingRow>
      )}

      {/* Custom provider (collapsible) — uses __custom__ sentinel to toggle between predefined and ad-hoc provider */}
      <div className="border-t border-[var(--color-border)]">
        <button
          type="button"
          onClick={() => setShowCustom(!showCustom)}
          className="w-full flex items-center gap-2 px-6 py-3 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-left cursor-pointer"
        >
          {showCustom ? "▾" : "▸"} Custom Provider
        </button>
        {showCustom && (
          <div className="px-6 pb-4 space-y-3">
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                Base URL
              </label>
              <input
                type="text"
                value={endpoint}
                onChange={(e) => setEndpoint(e.target.value)}
                placeholder="https://api.myprovider.com/v1"
                className="border border-[var(--color-border)] rounded px-3 py-1.5 text-sm bg-[var(--color-surface)] w-full text-[var(--color-text-primary)]"
              />
            </div>
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                  Model ID
                </label>
                <input
                  type="text"
                  value={isCustom ? customModel : ""}
                  onChange={(e) => {
                    setCustomModel(e.target.value);
                    if (!isCustom) setIsCustom(true);
                  }}
                  placeholder="model-id"
                  className="border border-[var(--color-border)] rounded px-3 py-1.5 text-sm bg-[var(--color-surface)] w-full text-[var(--color-text-primary)]"
                />
              </div>
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                  API Key
                </label>
                <PwInput
                  name="synthesisApiKey"
                  value={apiKeyState}
                  onChange={setApiKeyState}
                  placeholder="sk-..."
                />
              </div>
            </div>
          </div>
        )}
      </div>

      {loadingInterval ? (
        <div className="px-6 py-4 text-sm text-[var(--color-text-muted)] animate-pulse">
          Loading interval...
        </div>
      ) : (
        <SettingRow label="Run every" description="How often the synthesis pipeline runs">
          <div className="flex items-center gap-2">
            <select
              value={String(intervalMin)}
              onChange={(e) => {
                const min = Number(e.target.value);
                setIntervalMin(min);
                handleIntervalSave(min);
              }}
              className="border border-[var(--color-border)] rounded px-3 py-1.5 text-sm bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
            >
              <option value="5">5 minutes</option>
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
              <option value="60">1 hour</option>
              <option value="240">4 hours</option>
              <option value="0">Disabled</option>
            </select>
          </div>
        </SettingRow>
      )}

      {/* Backup Provider (collapsible) — fallback if primary LLM is unreachable */}
      <div className="border-t border-[var(--color-border)]">
        <button
          type="button"
          onClick={() => setShowBackup(!showBackup)}
          className="w-full flex items-center gap-2 px-6 py-3 text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] text-left cursor-pointer"
        >
          {showBackup ? "▾" : "▸"} Backup Provider (fallback)
        </button>
        {showBackup && (
          <div className="px-6 pb-4 space-y-3">
            <div>
              <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                Provider
              </label>
              <select
                value={backupProviderId}
                onChange={(e) => {
                  const val = e.target.value;
                  setBackupProviderId(val);
                  setBackupIsCustom(val === "__custom__");
                  if (val === "__custom__") {
                    setBackupSelectedModel("");
                  } else if (val) {
                    const p = providers.find((x) => x.id === val);
                    const models = providerModels(p);
                    setBackupSelectedModel(models[0]?.[0] || "");
                  } else {
                    setBackupSelectedModel("");
                  }
                }}
                className="border border-[var(--color-border)] rounded px-3 py-1.5 text-sm bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] cursor-pointer w-64"
              >
                <option value="">— None —</option>
                <option value="__custom__">— Custom Provider —</option>
                {sortedProviders.map((p) => {
                  const isFree = p.id === "opencode";
                  return (
                    <option key={p.id} value={p.id}>
                      {p.name}
                      {isFree ? " (Free)" : ""}
                    </option>
                  );
                })}
              </select>
            </div>

            {backupIsCustom && (
              <div className="space-y-3 p-3 bg-[var(--color-surface-muted)] rounded border border-[var(--color-border)]">
                <div>
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                    Endpoint
                  </label>
                  <input
                    type="text"
                    value={backupCustomEndpoint}
                    onChange={(e) => setBackupCustomEndpoint(e.target.value)}
                    placeholder="https://api.myprovider.com/v1"
                    className="border border-[var(--color-border)] rounded px-3 py-1.5 text-sm bg-[var(--color-surface)] w-full text-[var(--color-text-primary)]"
                  />
                </div>
                <div>
                  <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                    Model ID
                  </label>
                  <input
                    type="text"
                    value={backupCustomModel}
                    onChange={(e) => setBackupCustomModel(e.target.value)}
                    placeholder="model-id"
                    className="border border-[var(--color-border)] rounded px-3 py-1.5 text-sm bg-[var(--color-surface)] w-full text-[var(--color-text-primary)]"
                  />
                </div>
              </div>
            )}

            {backupProviderId && backupModels.length > 0 && !backupIsCustom && (
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                  Model
                </label>
                <select
                  value={backupSelectedModel}
                  onChange={(e) => setBackupSelectedModel(e.target.value)}
                  className="border border-[var(--color-border)] rounded px-3 py-1.5 text-sm bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] cursor-pointer w-64"
                >
                  {backupModels.map(([key, val]) => (
                    <option key={key} value={key}>
                      {key} {(val as any)?.id ? `(${(val as any).id})` : ""}
                    </option>
                  ))}
                </select>
              </div>
            )}

            {backupProviderId && (
              <div>
                <label className="block text-xs font-medium text-[var(--color-text-secondary)] mb-1">
                  API Key
                  {backupProviderId === "opencode" ? (
                    <span className="font-normal ml-1">(optional for free tier)</span>
                  ) : (
                    ""
                  )}
                </label>
                <PwInput
                  name="backupApiKey"
                  value={backupApiKey}
                  onChange={setBackupApiKey}
                  placeholder="sk-..."
                />
              </div>
            )}
          </div>
        )}
      </div>

      <div className="px-6 py-4 border-t border-[var(--color-border)] flex items-center gap-3">
        <button
          onClick={saveLlmConfig}
          disabled={saving}
          className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
        >
          {saving ? "Saving..." : "Save"}
        </button>
        <button
          onClick={testLlmConnection}
          disabled={testing || !endpoint}
          className="bg-[var(--color-surface)] text-[var(--color-text-primary)] px-4 py-1.5 rounded text-sm border border-[var(--color-border)] hover:bg-[var(--color-surface-hover)] disabled:opacity-50 cursor-pointer"
        >
          {testing ? "Testing..." : "Test Connection"}
        </button>
        {llmStatus && (
          <span
            className={`text-sm ${
              llmStatus.startsWith("✅")
                ? "text-[var(--color-success-text)]"
                : "text-[var(--color-error-text)]"
            }`}
          >
            {llmStatus}
          </span>
        )}
      </div>

      {!loadingProviders && !loadingConfig && (
        <div className="px-6 py-3 text-xs text-[var(--color-text-muted)] space-y-1">
          {isCustom && customModel && endpoint && (
            <div>
              Using custom provider: <strong>{endpoint}</strong> model:{" "}
              <strong>{customModel}</strong>
            </div>
          )}
          {!isCustom && selectedProvider && (
            <div>
              Using <strong>{selectedModel || Object.keys(selectedProvider.models || {})[0]}</strong>{" "}
              from {selectedProvider.name} via {endpoint}
            </div>
          )}
          {providerId ? (
            <div>
              Synthesis runs every {intervalMin} minutes — observes → analyzes → creates/updates
              skills. Current mode: <strong>LLM-driven skill synthesis</strong>
            </div>
          ) : (
            <div>
              Current mode: <strong>Heuristic trait-only synthesis</strong>. Observations still
              processed into personality traits.
            </div>
          )}
        </div>
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 bg-green-600 text-white px-4 py-2 rounded shadow-lg z-50 text-sm">
          {toast}
        </div>
      )}
    </div>
  );
}
