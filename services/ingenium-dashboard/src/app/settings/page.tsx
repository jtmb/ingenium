"use client";
import { useState, useEffect } from "react";
import { api } from "../../lib/api";

/**
 * Settings page — user-configurable preferences for the Ingenium dashboard.
 * Settings are stored globally (global-default project) in the settings table (key-value).
 */
export default function SettingsPage() {
  const [retentionDays, setRetentionDays] = useState(7);
  const [saved, setSaved] = useState(false);

  // Synthesis interval state
  const [intervalMin, setIntervalMin] = useState(15);
  const [intervalSaved, setIntervalSaved] = useState(false);

  // Synthesis LLM state
  const [providers, setProviders] = useState<any[]>([]);
  const [providerId, setProviderId] = useState("");
  const [selectedModel, setSelectedModel] = useState("");
  const [apiKeyState, setApiKey] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [savingLlm, setSavingLlm] = useState(false);
  const [testing, setTesting] = useState(false);
  const [llmStatus, setLlmStatus] = useState("");
  const [isCustom, setIsCustom] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customModel, setCustomModel] = useState("");

  // Backup synthesis LLM state
  const [showBackup, setShowBackup] = useState(false);
  const [backupProviderId, setBackupProviderId] = useState("");
  const [backupSelectedModel, setBackupSelectedModel] = useState("");
  const [backupApiKey, setBackupApiKey] = useState("");
  const [backupIsCustom, setBackupIsCustom] = useState(false);
  const [backupCustomEndpoint, setBackupCustomEndpoint] = useState("");
  const [backupCustomModel, setBackupCustomModel] = useState("");
  const backupProvider = providers.find(p => p.id === backupProviderId);
  const backupModels = backupProvider ? Object.entries(backupProvider.models || {}) as [string, any][] : [];
  const selectedProvider = providers.find(p => p.id === providerId);
  const providerModels = selectedProvider ? Object.entries(selectedProvider.models || {}) as [string, any][] : [];

  useEffect(() => {
    api.settings.get("archive_retention_days", "global-default").then((r) => {
      const val = parseInt(r.data.value, 10);
      if (!isNaN(val)) setRetentionDays(val);
    }).catch(() => {});
  }, []);

  const save = async (days: number) => {
    setRetentionDays(days);
    await api.settings.set("archive_retention_days", String(days), "global-default");
    setSaved(true);
    setTimeout(() => setSaved(false), 2000);
  };

  // Fetch OpenCode providers
  useEffect(() => {
    fetch("http://localhost:4098/provider?directory=/workspace")
      .then(r => r.json())
      .then(d => setProviders(d.all || []))
      .catch(() => setProviders([]));
  }, []);

  // Fetch saved synthesis config
  useEffect(() => {
    Promise.all([
      api.settings.get("synthesis_provider", "global-default"),
      api.settings.get("synthesis_api_key", "global-default"),
      api.settings.get("synthesis_endpoint", "global-default"),
      api.settings.get("synthesis_model", "global-default"),
    ]).then(([p, k, e, m]) => {
      const pid = p.data?.value || "";
      setProviderId(pid);
      setIsCustom(pid === "__custom__");
      if (k.data?.value) setApiKey(k.data.value);
      if (e.data?.value) setEndpoint(e.data.value);
      if (pid === "__custom__" && m.data?.value) setCustomModel(m.data.value);
      // Restore selected model for non-custom providers
      if (pid && pid !== "__custom__" && m.data?.value) {
        setSelectedModel("");
        // Find which model key has this ID
        const prov = providers.find(x => x.id === pid);
        if (prov) {
          const match = Object.entries(prov.models || {}).find(([, v]: [string, any]) => v.id === m.data.value);
          if (match) setSelectedModel(match[0]);
        }
      }
    }).catch(() => {});
  }, [providers]);

  // Load backup synthesis config
  useEffect(() => {
    Promise.all([
      api.settings.get("synthesis_backup_provider", "global-default"),
      api.settings.get("synthesis_backup_model", "global-default"),
      api.settings.get("synthesis_backup_endpoint", "global-default"),
      api.settings.get("synthesis_backup_api_key", "global-default"),
    ]).then(([pr, m, e, k]) => {
      const bPid = pr.data?.value || "";
      if (bPid) { setBackupProviderId(bPid); setShowBackup(true); }
      setBackupIsCustom(bPid === "__custom__");
      if (bPid === "__custom__") {
        if (m.data?.value) setBackupCustomModel(m.data.value);
        if (e.data?.value) setBackupCustomEndpoint(e.data.value);
      } else if (bPid && m.data?.value) {
        const bp = providers.find(x => x.id === bPid);
        if (bp) {
          const match = Object.entries(bp.models || {}).find(([, v]: [string, any]) => v.id === m.data.value);
          if (match) setBackupSelectedModel(match[0]);
        }
      }
      if (k.data?.value) setBackupApiKey(k.data.value);
    }).catch(() => {});
  }, [providers]);

  // Fetch saved synthesis interval
  useEffect(() => {
    api.settings.get("synthesis_interval_ms", "global-default").then((r) => {
      const ms = parseInt(r.data.value, 10);
      if (!isNaN(ms) && ms >= 0) setIntervalMin(ms / 60000);
    }).catch(() => {});
  }, []);

  const handleIntervalSave = async (min: number) => {
    await api.settings.set("synthesis_interval_ms", String(min * 60000), "global-default");
    setIntervalSaved(true);
    setTimeout(() => setIntervalSaved(false), 2000);
  };

  const saveLlmConfig = async () => {
    setSavingLlm(true);
    try {
      let modelId = "";
      let ep = "";

      if (isCustom) {
        modelId = customModel;
        ep = endpoint;
      } else {
        const p = providers.find(x => x.id === providerId);
        const models = p ? Object.entries(p.models || {}) as [string, any][] : [];
        const model = models.find(([k]) => k === selectedModel) || models[0];
        modelId = model ? model[1]?.id || "" : "";
        ep = model ? model[1]?.api?.url || "" : "";
      }

      await api.settings.set("synthesis_model", modelId, "global-default");
      await api.settings.set("synthesis_provider", providerId, "global-default");
      if (apiKeyState) await api.settings.set("synthesis_api_key", apiKeyState, "global-default");
      await api.settings.set("synthesis_endpoint", ep, "global-default");
      // Save backup config
      if (backupProviderId) {
        await api.settings.set("synthesis_backup_provider", backupProviderId, "global-default");
        if (backupIsCustom) {
          if (backupCustomModel) await api.settings.set("synthesis_backup_model", backupCustomModel, "global-default");
          if (backupCustomEndpoint) await api.settings.set("synthesis_backup_endpoint", backupCustomEndpoint, "global-default");
        } else {
          const bp = backupProvider;
          const bModels = bp ? Object.entries(bp.models || {}) as [string, any][] : [];
          const bModel = bModels.find(([k]) => k === backupSelectedModel) || bModels[0];
          const bModelId = bModel ? bModel[1]?.id || "" : "";
          const bEp = bModel ? bModel[1]?.api?.url || "" : "";
          if (bModelId) await api.settings.set("synthesis_backup_model", bModelId, "global-default");
          if (bEp) await api.settings.set("synthesis_backup_endpoint", bEp, "global-default");
        }
      }
      if (backupApiKey) await api.settings.set("synthesis_backup_api_key", backupApiKey, "global-default");
      setEndpoint(ep);
      setLlmStatus("✅ Configuration saved");
    } catch (err: any) {
      setLlmStatus(`❌ Save failed: ${err.message}`);
    }
    setSavingLlm(false);
  };

  const testLlmConnection = async () => {
    setTesting(true);
    setLlmStatus("");
    try {
      // Primary
      const modelId = isCustom
        ? customModel
        : (() => {
            const models = providerModels;
            const match = models.find(([k]) => k === selectedModel) || models[0];
            return match?.[1]?.id || selectedModel || providerId;
          })();
      const ep = isCustom ? endpoint : endpoint;

      let status = "";
      const pr = await api.settings.testLlm(ep, modelId, apiKeyState);
      status = pr.ok ? "✅ Primary OK" : `❌ Primary: ${pr.status || "error"} ${pr.message || ""}`;

      // Backup
      if (backupProviderId) {
        const bModelId = backupIsCustom
          ? backupCustomModel
          : (() => {
              const models = backupModels;
              const match = models.find(([k]) => k === backupSelectedModel) || models[0];
              return match?.[1]?.id || backupSelectedModel || backupProviderId;
            })();
        const bEp = backupIsCustom ? backupCustomEndpoint : (backupModels[0]?.[1] as any)?.api?.url || backupCustomEndpoint;
        const br = await api.settings.testLlm(bEp, bModelId, backupApiKey);
        status += br.ok ? " | ✅ Backup OK" : ` | ❌ Backup: ${br.status || "error"} ${br.message || ""}`;
      }

      setLlmStatus(status);
    } catch (err: any) {
      setLlmStatus(`❌ ${err.message}`);
    }
    setTesting(false);
  };

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Settings</h1>

      <div className="bg-white p-6 rounded border space-y-4 hover:shadow-md transition-shadow">
        <div>
          <label className="block text-sm font-medium mb-1">Archive retention (days)</label>
          <p className="text-xs text-gray-500 mb-2">
            Projects stay in the archive for this many days before being permanently deleted.
          </p>
          <div className="flex items-center gap-3">
            <input
              type="number"
              min={1}
              max={365}
              value={retentionDays}
              onChange={(e) => save(parseInt(e.target.value, 10) || 7)}
              className="border p-2 rounded w-24"
            />
            <span className="text-sm text-gray-600">days</span>
            {saved && <span className="text-sm text-green-600">Saved!</span>}
          </div>
        </div>
      </div>

      {/* ── Synthesis LLM ── */}
      <div className="bg-white p-4 rounded border space-y-3 hover:shadow-md transition-shadow">
        <h2 className="font-semibold text-lg">Synthesis LLM</h2>
        <p className="text-sm text-gray-500">Select an LLM provider for the self-learning pipeline to synthesize observations into skills and update personality traits.</p>

        {providers.length === 0 ? (
          <p className="text-sm text-amber-600">No OpenCode providers detected. Configure a provider or use "Custom Provider" below.</p>
        ) : null}

        <div>
          <label className="block text-sm font-medium">Provider</label>
          <select value={providerId} onChange={(e) => {
            const val = e.target.value;
            setProviderId(val);
            setIsCustom(val === "__custom__");
            if (val === "__custom__") {
              setEndpoint("");
              setSelectedModel("");
            } else if (val) {
              const p = providers.find(x => x.id === val);
              const models = p ? Object.entries(p.models || {}) : [];
              const firstModel = models[0];
              setEndpoint((firstModel?.[1] as any)?.api?.url || "");
              setSelectedModel(firstModel?.[0] || "");
            }
          }} className="border p-2 rounded w-full text-sm hover:bg-gray-50 cursor-pointer">
            <option value="">— No LLM (heuristics only) —</option>
            <option value="__custom__">— Custom Provider —</option>
            {(() => {
              const pinned: [string, number][] = [
                ["opencode zen", 0], ["opencode pro", 1], ["opencode", 2],
                ["go", 3], ["deepseek", 4], ["zen", 5],
              ];
              const rank = (p: any): number => {
                const name = (p.name || "").toLowerCase();
                for (const [kw, r] of pinned) {
                  if (name.includes(kw)) return r;
                }
                return 999;
              };
              const sorted = [...providers]
                .filter(p => Object.keys(p.models || {}).length > 0)
                .sort((a, b) => {
                  const ar = rank(a), br = rank(b);
                  if (ar !== br) return ar - br;
                  return a.name.localeCompare(b.name);
                });
               return sorted.map(p => {
                  const isFree = p.id === "opencode";
                  return (
                    <option key={p.id} value={p.id}>{p.name}{isFree ? " (Free)" : ""}</option>
                  );
                });
            })()}
          </select>
        </div>

        {!isCustom && providerId && providerModels.length > 0 && (
          <div>
            <label className="block text-sm font-medium">Model</label>
            <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} className="border p-2 rounded w-full text-sm hover:bg-gray-50 cursor-pointer">
              {providerModels.map(([key, val]) => (
                <option key={key} value={key}>{key} {(val as any)?.id ? `(${(val as any).id})` : ""}</option>
              ))}
            </select>
          </div>
        )}

        {isCustom && (
          <div className="grid grid-cols-2 gap-4 p-3 bg-gray-50 rounded border">
            <div className="col-span-2">
              <label className="block text-sm font-medium">Base URL</label>
              <input type="text" value={endpoint} onChange={(e) => setEndpoint(e.target.value)} placeholder="https://api.myprovider.com/v1" className="border p-2 rounded w-full text-sm font-mono" />
            </div>
            <div>
              <label className="block text-sm font-medium">Model ID</label>
              <input type="text" value={customModel} onChange={(e) => setCustomModel(e.target.value)} placeholder="model-id" className="border p-2 rounded w-full text-sm font-mono" />
            </div>
            <div>
              <label className="block text-sm font-medium">API Key</label>
              <input type="password" value={apiKeyState} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." className="border p-2 rounded w-full text-sm" />
            </div>
          </div>
        )}

        {!isCustom && providerId && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium">API Key {providerId === "opencode" ? <span className="text-gray-400 font-normal">(optional for free tier)</span> : ""}</label>
              <input type="password" value={apiKeyState} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." className="border p-2 rounded w-full text-sm" />
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">Run every</label>
          <select value={String(intervalMin)} onChange={(e) => { setIntervalMin(Number(e.target.value)); handleIntervalSave(Number(e.target.value)); }} className="border p-2 rounded w-48 text-sm hover:bg-gray-50 cursor-pointer">
            <option value="5">5 minutes</option>
            <option value="15">15 minutes</option>
            <option value="30">30 minutes</option>
            <option value="60">1 hour</option>
            <option value="240">4 hours</option>
            <option value="0">Disabled</option>
          </select>
          {intervalSaved && <span className="text-sm text-green-600 ml-2">Saved!</span>}
        </div>

        {/* Backup Provider */}
        <div className="border-t pt-3 mt-3">
          <button type="button" onClick={() => setShowBackup(!showBackup)} className="text-sm font-medium text-gray-600 hover:text-gray-900">
            {showBackup ? "▾" : "▸"} Backup Provider (fallback)
          </button>
          {showBackup && (
            <div className="mt-3 space-y-3">
              <div>
                <label className="block text-sm font-medium">Provider</label>
                <select value={backupProviderId} onChange={(e) => {
                  const val = e.target.value;
                  setBackupProviderId(val);
                  setBackupIsCustom(val === "__custom__");
                  if (val === "__custom__") {
                    setBackupSelectedModel("");
                  } else if (val) {
                    const p = providers.find(x => x.id === val);
                    const models = p ? Object.entries(p.models || {}) : [];
                    setBackupSelectedModel(models[0]?.[0] || "");
                  } else {
                    setBackupSelectedModel("");
                  }
                }} className="border p-2 rounded w-full text-sm hover:bg-gray-50 cursor-pointer">
                  <option value="">— None —</option>
                  <option value="__custom__">— Custom Provider —</option>
                  {(() => {
                    const sorted = [...providers]
                      .filter(p => Object.keys(p.models || {}).length > 0)
                      .sort((a, b) => {
                        const rank = (n: string) => n.toLowerCase().includes("opencode zen") ? 0 : n.toLowerCase().includes("deepseek") ? 1 : 999;
                        return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name);
                      });
                    return sorted.map(p => {
                      const isFree = p.id === "opencode";
                      return <option key={p.id} value={p.id}>{p.name}{isFree ? " (Free)" : ""}</option>;
                    });
                  })()}
                </select>
              </div>
              {backupIsCustom && (
                <div className="space-y-3 p-3 bg-gray-50 rounded border">
                  <div>
                    <label className="block text-sm font-medium">Endpoint</label>
                    <input type="text" value={backupCustomEndpoint} onChange={(e) => setBackupCustomEndpoint(e.target.value)} placeholder="https://api.myprovider.com/v1" className="border p-2 rounded w-full text-sm font-mono" />
                  </div>
                  <div>
                    <label className="block text-sm font-medium">Model ID</label>
                    <input type="text" value={backupCustomModel} onChange={(e) => setBackupCustomModel(e.target.value)} placeholder="model-id" className="border p-2 rounded w-full text-sm font-mono" />
                  </div>
                </div>
              )}
              {backupProviderId && backupModels.length > 0 && (
                <div>
                  <label className="block text-sm font-medium">Model</label>
                  <select value={backupSelectedModel} onChange={(e) => setBackupSelectedModel(e.target.value)} className="border p-2 rounded w-full text-sm hover:bg-gray-50 cursor-pointer">
                    {backupModels.map(([key, val]) => (
                      <option key={key} value={key}>{key} {(val as any)?.id ? `(${(val as any).id})` : ""}</option>
                    ))}
                  </select>
                </div>
              )}
              {backupProviderId && (
                <div>
                  <label className="block text-sm font-medium">API Key {backupProviderId === "opencode" ? <span className="text-gray-400 font-normal">(optional for free tier)</span> : ""}</label>
                  <input type="password" value={backupApiKey} onChange={(e) => setBackupApiKey(e.target.value)} placeholder="sk-..." className="border p-2 rounded w-full text-sm" />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2 items-center">
          <button onClick={saveLlmConfig} disabled={savingLlm} className="bg-blue-600 text-white p-2 rounded hover:bg-blue-700 disabled:opacity-50 text-sm">
            {savingLlm ? "Saving..." : "Save"}
          </button>
          <button onClick={testLlmConnection} disabled={testing || !endpoint} className="bg-gray-200 text-gray-700 p-2 rounded hover:bg-gray-300 disabled:opacity-50 text-sm">
            {testing ? "Testing..." : "Test Connection"}
          </button>
          {llmStatus && <span className={`text-sm ${llmStatus.startsWith("✅") ? "text-green-600" : "text-red-600"}`}>{llmStatus}</span>}
        </div>

        {isCustom && customModel && endpoint && (
          <div className="text-xs text-gray-400">
            Using custom provider: <strong>{endpoint}</strong> model: <strong>{customModel}</strong>
          </div>
        )}
        {!isCustom && selectedProvider && (
          <div className="text-xs text-gray-400">
            Using <strong>{selectedModel || Object.keys(selectedProvider.models || {})[0]}</strong> from {selectedProvider.name} via {endpoint}
          </div>
        )}
        {providerId && (
          <div className="text-xs text-gray-400">
            Synthesis runs every 15 minutes — observes → analyzes → creates/updates skills.
            See <a href="/pipeline" className="text-blue-600 underline">Pipeline</a> for activity.
            Current mode: <strong>LLM-driven skill synthesis</strong>
          </div>
        )}
        {!providerId && (
          <div className="text-xs text-gray-400">
            Current mode: <strong>Heuristic trait-only synthesis</strong>. Observations still processed into personality traits.
          </div>
        )}
      </div>
    </div>
  );
}
