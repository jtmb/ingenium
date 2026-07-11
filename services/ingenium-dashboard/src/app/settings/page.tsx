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

  // Synthesis LLM state
  const [providers, setProviders] = useState<any[]>([]);
  const [providerId, setProviderId] = useState("");
  const [apiKeyState, setApiKey] = useState("");
  const [endpoint, setEndpoint] = useState("");
  const [savingLlm, setSavingLlm] = useState(false);
  const [testing, setTesting] = useState(false);
  const [llmStatus, setLlmStatus] = useState("");
  const [isCustom, setIsCustom] = useState(false);
  const [customName, setCustomName] = useState("");
  const [customModel, setCustomModel] = useState("");
  const selectedProvider = providers.find(p => p.id === providerId);

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
    }).catch(() => {});
  }, []);

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
        const firstModel = p ? Object.values(p.models || {})[0] : null;
        modelId = firstModel ? (firstModel as any).id : "";
        ep = firstModel ? (firstModel as any).api?.url || "" : "";
      }

      await api.settings.set("synthesis_model", modelId, "global-default");
      await api.settings.set("synthesis_provider", providerId, "global-default");
      if (apiKeyState) await api.settings.set("synthesis_api_key", apiKeyState, "global-default");
      await api.settings.set("synthesis_endpoint", ep, "global-default");
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
      const modelId = isCustom
        ? customModel
        : (Object.values(selectedProvider?.models || {})[0] as any)?.id || providerId;
      const ep = isCustom
        ? endpoint
        : endpoint;

      const result = await api.settings.testLlm(ep, modelId, apiKeyState);
      if (result.ok) setLlmStatus("✅ Connection successful");
      else setLlmStatus(`❌ ${result.status || "error"}: ${result.message || "unknown"}`);
    } catch (err: any) {
      setLlmStatus(`❌ ${err.message}`);
    }
    setTesting(false);
  };

  return (
    <div className="space-y-8">
      <h1 className="text-3xl font-bold">Settings</h1>

      <div className="bg-white p-6 rounded border space-y-4">
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
      <div className="bg-white p-4 rounded border space-y-3">
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
            } else if (val) {
              const p = providers.find(x => x.id === val);
              const m = p ? Object.values(p.models || {})[0] : null;
              setEndpoint((m as any)?.api?.url || "");
            }
          }} className="border p-2 rounded w-full text-sm">
            <option value="">— No LLM (heuristics only) —</option>
            <option value="__custom__">— Custom Provider —</option>
            {(() => {
              const pinned: [string, number][] = [
                ["opencode", 0], ["go", 1], ["opencode zen", 2],
                ["opencode pro", 3], ["zen", 4], ["deepseek", 5],
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
              return sorted.map(p => (
                <option key={p.id} value={p.id}>{p.name}</option>
              ));
            })()}
          </select>
        </div>

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
              <label className="block text-sm font-medium">API Key</label>
              <input type="password" value={apiKeyState} onChange={(e) => setApiKey(e.target.value)} placeholder="sk-..." className="border p-2 rounded w-full text-sm" />
            </div>
          </div>
        )}

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
            Using <strong>{Object.keys(selectedProvider.models || {})[0]}</strong> from {selectedProvider.name} via {endpoint}
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
