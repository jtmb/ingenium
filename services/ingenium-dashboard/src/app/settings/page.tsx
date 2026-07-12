"use client";
import { useState, useEffect } from "react";
import { api } from "../../lib/api";
import { useTheme } from "../components/ThemeProvider";

/**
 * Settings page — user-configurable preferences for the Ingenium dashboard.
 * Settings are stored globally (global-default project) in the settings table (key-value).
 */
export default function SettingsPage() {
  const { theme, setTheme } = useTheme();
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

  // Email OAuth state
  const PROJECT = "gh-llm-bootstrap";
  const [gmailClientId, setGmailClientId] = useState("");
  const [gmailClientSecret, setGmailClientSecret] = useState("");
  const [outlookClientId, setOutlookClientId] = useState("");
  const [outlookClientSecret, setOutlookClientSecret] = useState("");
  const [savingOauth, setSavingOauth] = useState(false);
  const [oauthSaved, setOauthSaved] = useState(false);

  // Password visibility toggles
  const [showPw, setShowPw] = useState<Record<string, boolean>>({});
  const togglePw = (name: string) => setShowPw(prev => ({ ...prev, [name]: !prev[name] }));

  // Toast feedback
  const [toast, setToast] = useState("");
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(t);
  }, [toast]);

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
    setToast("Saved ✓");
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
    setToast("Interval updated ✓");
    setTimeout(() => setIntervalSaved(false), 2000);
  };

  // Load Email OAuth settings
  useEffect(() => {
    Promise.all([
      api.settings.get("oauth_gmail_client_id", PROJECT),
      api.settings.get("oauth_gmail_client_secret", PROJECT),
      api.settings.get("oauth_outlook_client_id", PROJECT),
      api.settings.get("oauth_outlook_client_secret", PROJECT),
    ]).then(([gid, gs, oid, os]) => {
      if (gid.data?.value) setGmailClientId(gid.data.value);
      if (gs.data?.value) setGmailClientSecret(gs.data.value);
      if (oid.data?.value) setOutlookClientId(oid.data.value);
      if (os.data?.value) setOutlookClientSecret(os.data.value);
    }).catch(() => {});
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveOauth = async () => {
    setSavingOauth(true);
    try {
      await api.settings.set("oauth_gmail_client_id", gmailClientId, PROJECT);
      await api.settings.set("oauth_gmail_client_secret", gmailClientSecret, PROJECT);
      await api.settings.set("oauth_outlook_client_id", outlookClientId, PROJECT);
      await api.settings.set("oauth_outlook_client_secret", outlookClientSecret, PROJECT);
      setOauthSaved(true);
      setToast("OAuth settings saved ✓");
      setTimeout(() => setOauthSaved(false), 2000);
    } catch (err: any) {
      alert("Failed to save OAuth settings: " + err.message);
    }
    setSavingOauth(false);
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
      setToast("LLM config saved ✓");
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

  /** Reusable password input with show/hide toggle */
  function PwInput({ value, onChange, placeholder, name }: { value: string; onChange: (v: string) => void; placeholder?: string; name: string }) {
    return (
      <div className="flex items-center gap-1">
        <input
          type={showPw[name] ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={placeholder}
          className="border p-2 rounded w-full text-sm"
        />
        <button
          type="button"
          onClick={() => togglePw(name)}
          className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] dark:hover:text-gray-200 whitespace-nowrap px-1"
        >
          {showPw[name] ? "🙈 Hide" : "👁 Show"}
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-8">
      {/* Hero header */}
      <div>
        <h1 className="text-3xl font-bold">Settings</h1>
        <p className="text-[var(--color-text-muted)] mt-1">Configure system preferences</p>
      </div>

      {/* ── Appearance ── */}
      <div className="bg-[var(--color-surface)] rounded border border-[var(--color-border)] p-6 space-y-4 hover:shadow-md transition-shadow">
        <h2 className="text-lg font-semibold flex items-center gap-2">🎨 Appearance</h2>
        <div>
          <label className="block text-sm font-medium mb-1">Theme</label>
          <select
            value={theme}
            onChange={(e) => setTheme(e.target.value as "system" | "light" | "dark")}
            className="border border-[var(--color-border)] rounded px-3 py-1.5 text-sm bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] dark:hover:bg-gray-700 cursor-pointer"
          >
            <option value="system">System</option>
            <option value="light">Light</option>
            <option value="dark">Dark</option>
          </select>
        </div>
      </div>

      {/* ── Archive Retention ── */}
      <div className="bg-[var(--color-surface)] rounded border border-[var(--color-border)] p-6 space-y-4 hover:shadow-md transition-shadow">
        <h2 className="text-lg font-semibold flex items-center gap-2">🗄️ Archive Retention</h2>
        <div>
          <p className="text-xs text-[var(--color-text-muted)] mb-2">
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
            <span className="text-sm text-[var(--color-text-secondary)]">days</span>
            {saved && <span className="text-sm text-[var(--color-success-text)]">Saved!</span>}
          </div>
        </div>
      </div>

      {/* ── Synthesis LLM ── */}
      <div className="bg-[var(--color-surface)] rounded border border-[var(--color-border)] p-6 space-y-4 hover:shadow-md transition-shadow">
        <h2 className="text-lg font-semibold flex items-center gap-2">🧠 Synthesis LLM</h2>
        <p className="text-sm text-[var(--color-text-muted)]">Select an LLM provider for the self-learning pipeline to synthesize observations into skills and update personality traits.</p>

        {providers.length === 0 ? (
          <p className="text-sm text-[var(--color-warning-text)]">No OpenCode providers detected. Configure a provider or use &quot;Custom Provider&quot; below.</p>
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
          }} className="border p-2 rounded w-full text-sm hover:bg-[var(--color-surface-hover)] dark:hover:bg-gray-700 cursor-pointer">
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
            <select value={selectedModel} onChange={(e) => setSelectedModel(e.target.value)} className="border p-2 rounded w-full text-sm hover:bg-[var(--color-surface-hover)] dark:hover:bg-gray-700 cursor-pointer">
              {providerModels.map(([key, val]) => (
                <option key={key} value={key}>{key} {(val as any)?.id ? `(${(val as any).id})` : ""}</option>
              ))}
            </select>
          </div>
        )}

        {isCustom && (
          <div className="grid grid-cols-2 gap-4 p-3 bg-[var(--color-surface-muted)] rounded border">
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
              <PwInput name="synthesisApiKey" value={apiKeyState} onChange={setApiKey} placeholder="sk-..." />
            </div>
          </div>
        )}

        {!isCustom && providerId && (
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium">API Key {providerId === "opencode" ? <span className="font-normal">(optional for free tier)</span> : ""}</label>
              <PwInput name="synthesisApiKey" value={apiKeyState} onChange={setApiKey} placeholder="sk-..." />
            </div>
          </div>
        )}

        <div>
          <label className="block text-sm font-medium mb-1">Run every</label>
          <select value={String(intervalMin)} onChange={(e) => { setIntervalMin(Number(e.target.value)); handleIntervalSave(Number(e.target.value)); }} className="border p-2 rounded w-48 text-sm hover:bg-[var(--color-surface-hover)] dark:hover:bg-gray-700 cursor-pointer">
            <option value="5">5 minutes</option>
            <option value="15">15 minutes</option>
            <option value="30">30 minutes</option>
            <option value="60">1 hour</option>
            <option value="240">4 hours</option>
            <option value="0">Disabled</option>
          </select>
          {intervalSaved && <span className="text-sm text-[var(--color-success-text)] ml-2">Saved!</span>}
        </div>

        {/* Backup Provider */}
        <div className="border-t pt-3 mt-3">
          <button type="button" onClick={() => setShowBackup(!showBackup)} className="text-sm font-medium text-[var(--color-text-secondary)] hover:text-[var(--color-text-primary)] dark:hover:text-gray-100">
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
                }} className="border p-2 rounded w-full text-sm hover:bg-[var(--color-surface-hover)] dark:hover:bg-gray-700 cursor-pointer">
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
                <div className="space-y-3 p-3 bg-[var(--color-surface-muted)] rounded border">
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
                  <select value={backupSelectedModel} onChange={(e) => setBackupSelectedModel(e.target.value)} className="border p-2 rounded w-full text-sm hover:bg-[var(--color-surface-hover)] dark:hover:bg-gray-700 cursor-pointer">
                    {backupModels.map(([key, val]) => (
                      <option key={key} value={key}>{key} {(val as any)?.id ? `(${(val as any).id})` : ""}</option>
                    ))}
                  </select>
                </div>
              )}
              {backupProviderId && (
                <div>
                  <label className="block text-sm font-medium">API Key {backupProviderId === "opencode" ? <span className="font-normal">(optional for free tier)</span> : ""}</label>
                  <PwInput name="backupApiKey" value={backupApiKey} onChange={setBackupApiKey} placeholder="sk-..." />
                </div>
              )}
            </div>
          )}
        </div>

        <div className="flex gap-2 items-center">
          <button onClick={saveLlmConfig} disabled={savingLlm} className="bg-blue-600 text-white p-2 rounded hover:bg-blue-700 disabled:opacity-50 text-sm">
            {savingLlm ? "Saving..." : "Save"}
          </button>
          <button onClick={testLlmConnection} disabled={testing || !endpoint} className="bg-gray-200 text-[var(--color-text-primary)] p-2 rounded hover:bg-gray-300 dark:hover:bg-gray-600 disabled:opacity-50 text-sm">
            {testing ? "Testing..." : "Test Connection"}
          </button>
          {llmStatus && <span className={`text-sm ${llmStatus.startsWith("✅") ? "text-[var(--color-success-text)]" : "text-[var(--color-error-text)]"}`}>{llmStatus}</span>}
        </div>

        {isCustom && customModel && endpoint && (
          <div className="text-xs text-[var(--color-text-muted)]">
            Using custom provider: <strong>{endpoint}</strong> model: <strong>{customModel}</strong>
          </div>
        )}
        {!isCustom && selectedProvider && (
          <div className="text-xs text-[var(--color-text-muted)]">
            Using <strong>{selectedModel || Object.keys(selectedProvider.models || {})[0]}</strong> from {selectedProvider.name} via {endpoint}
          </div>
        )}
        {providerId && (
          <div className="text-xs text-[var(--color-text-muted)]">
            Synthesis runs every 15 minutes — observes → analyzes → creates/updates skills.
            See <a href="/pipeline" className="text-[var(--color-text-link)] underline">Pipeline</a> for activity.
            Current mode: <strong>LLM-driven skill synthesis</strong>
          </div>
        )}
        {!providerId && (
          <div className="text-xs text-[var(--color-text-muted)]">
            Current mode: <strong>Heuristic trait-only synthesis</strong>. Observations still processed into personality traits.
          </div>
        )}
      </div>

      {/* ── Email OAuth ── */}
      <div className="bg-[var(--color-surface)] rounded border border-[var(--color-border)] p-6 space-y-4 hover:shadow-md transition-shadow">
        <h2 className="text-lg font-semibold flex items-center gap-2">✉️ Email OAuth</h2>
        <p className="text-sm text-[var(--color-text-muted)]">Google and Microsoft OAuth 2.0 credentials for connecting email accounts.</p>

        {/* Google */}
        <div>
          <h3 className="text-sm font-medium text-[var(--color-text-primary)] mb-2">Google (Gmail)</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium">Client ID</label>
              <input type="text" value={gmailClientId} onChange={(e) => setGmailClientId(e.target.value)}
                placeholder="Google Cloud OAuth client ID" className="border p-2 rounded w-full text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium">Client Secret</label>
              <PwInput name="gmailSecret" value={gmailClientSecret} onChange={setGmailClientSecret} placeholder="Google Cloud OAuth client secret" />
            </div>
          </div>
        </div>

        {/* Microsoft */}
        <div className="border-t pt-3">
          <h3 className="text-sm font-medium text-[var(--color-text-primary)] mb-2">Microsoft (Outlook)</h3>
          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium">Client ID</label>
              <input type="text" value={outlookClientId} onChange={(e) => setOutlookClientId(e.target.value)}
                placeholder="Azure AD application client ID" className="border p-2 rounded w-full text-sm" />
            </div>
            <div>
              <label className="block text-sm font-medium">Client Secret</label>
              <PwInput name="outlookSecret" value={outlookClientSecret} onChange={setOutlookClientSecret} placeholder="Azure AD application client secret" />
            </div>
          </div>
        </div>

        <div className="flex gap-2 items-center">
          <button onClick={saveOauth} disabled={savingOauth}
            className="bg-blue-600 text-white p-2 rounded hover:bg-blue-700 disabled:opacity-50 text-sm">
            {savingOauth ? "Saving..." : "Save"}
          </button>
          {oauthSaved && <span className="text-sm text-[var(--color-success-text)]">Saved!</span>}
        </div>
      </div>

      {/* Toast feedback */}
      {toast && (
        <div className="fixed bottom-4 right-4 bg-green-600 text-white px-4 py-2 rounded shadow-lg z-50 text-sm">
          {toast}
        </div>
      )}
    </div>
  );
}
