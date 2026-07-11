"use client";
import { jsx as _jsx, jsxs as _jsxs } from "react/jsx-runtime";
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
    const [providers, setProviders] = useState([]);
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
    const backupModels = backupProvider ? Object.entries(backupProvider.models || {}) : [];
    const selectedProvider = providers.find(p => p.id === providerId);
    const providerModels = selectedProvider ? Object.entries(selectedProvider.models || {}) : [];
    useEffect(() => {
        api.settings.get("archive_retention_days", "global-default").then((r) => {
            const val = parseInt(r.data.value, 10);
            if (!isNaN(val))
                setRetentionDays(val);
        }).catch(() => { });
    }, []);
    const save = async (days) => {
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
            if (k.data?.value)
                setApiKey(k.data.value);
            if (e.data?.value)
                setEndpoint(e.data.value);
            if (pid === "__custom__" && m.data?.value)
                setCustomModel(m.data.value);
            // Restore selected model for non-custom providers
            if (pid && pid !== "__custom__" && m.data?.value) {
                setSelectedModel("");
                // Find which model key has this ID
                const prov = providers.find(x => x.id === pid);
                if (prov) {
                    const match = Object.entries(prov.models || {}).find(([, v]) => v.id === m.data.value);
                    if (match)
                        setSelectedModel(match[0]);
                }
            }
        }).catch(() => { });
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
            if (bPid) {
                setBackupProviderId(bPid);
                setShowBackup(true);
            }
            setBackupIsCustom(bPid === "__custom__");
            if (bPid === "__custom__") {
                if (m.data?.value)
                    setBackupCustomModel(m.data.value);
                if (e.data?.value)
                    setBackupCustomEndpoint(e.data.value);
            }
            else if (bPid && m.data?.value) {
                const bp = providers.find(x => x.id === bPid);
                if (bp) {
                    const match = Object.entries(bp.models || {}).find(([, v]) => v.id === m.data.value);
                    if (match)
                        setBackupSelectedModel(match[0]);
                }
            }
            if (k.data?.value)
                setBackupApiKey(k.data.value);
        }).catch(() => { });
    }, [providers]);
    // Fetch saved synthesis interval
    useEffect(() => {
        api.settings.get("synthesis_interval_ms", "global-default").then((r) => {
            const ms = parseInt(r.data.value, 10);
            if (!isNaN(ms) && ms >= 0)
                setIntervalMin(ms / 60000);
        }).catch(() => { });
    }, []);
    const handleIntervalSave = async (min) => {
        await api.settings.set("synthesis_interval_ms", String(min * 60000), "global-default");
        setIntervalSaved(true);
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
            if (gid.data?.value)
                setGmailClientId(gid.data.value);
            if (gs.data?.value)
                setGmailClientSecret(gs.data.value);
            if (oid.data?.value)
                setOutlookClientId(oid.data.value);
            if (os.data?.value)
                setOutlookClientSecret(os.data.value);
        }).catch(() => { });
    }, []); // eslint-disable-line react-hooks/exhaustive-deps
    const saveOauth = async () => {
        setSavingOauth(true);
        try {
            await api.settings.set("oauth_gmail_client_id", gmailClientId, PROJECT);
            await api.settings.set("oauth_gmail_client_secret", gmailClientSecret, PROJECT);
            await api.settings.set("oauth_outlook_client_id", outlookClientId, PROJECT);
            await api.settings.set("oauth_outlook_client_secret", outlookClientSecret, PROJECT);
            setOauthSaved(true);
            setTimeout(() => setOauthSaved(false), 2000);
        }
        catch (err) {
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
            }
            else {
                const p = providers.find(x => x.id === providerId);
                const models = p ? Object.entries(p.models || {}) : [];
                const model = models.find(([k]) => k === selectedModel) || models[0];
                modelId = model ? model[1]?.id || "" : "";
                ep = model ? model[1]?.api?.url || "" : "";
            }
            await api.settings.set("synthesis_model", modelId, "global-default");
            await api.settings.set("synthesis_provider", providerId, "global-default");
            if (apiKeyState)
                await api.settings.set("synthesis_api_key", apiKeyState, "global-default");
            await api.settings.set("synthesis_endpoint", ep, "global-default");
            // Save backup config
            if (backupProviderId) {
                await api.settings.set("synthesis_backup_provider", backupProviderId, "global-default");
                if (backupIsCustom) {
                    if (backupCustomModel)
                        await api.settings.set("synthesis_backup_model", backupCustomModel, "global-default");
                    if (backupCustomEndpoint)
                        await api.settings.set("synthesis_backup_endpoint", backupCustomEndpoint, "global-default");
                }
                else {
                    const bp = backupProvider;
                    const bModels = bp ? Object.entries(bp.models || {}) : [];
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
            setEndpoint(ep);
            setLlmStatus("✅ Configuration saved");
        }
        catch (err) {
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
                const bEp = backupIsCustom ? backupCustomEndpoint : backupModels[0]?.[1]?.api?.url || backupCustomEndpoint;
                const br = await api.settings.testLlm(bEp, bModelId, backupApiKey);
                status += br.ok ? " | ✅ Backup OK" : ` | ❌ Backup: ${br.status || "error"} ${br.message || ""}`;
            }
            setLlmStatus(status);
        }
        catch (err) {
            setLlmStatus(`❌ ${err.message}`);
        }
        setTesting(false);
    };
    return (_jsxs("div", { className: "space-y-8", children: [_jsx("h1", { className: "text-3xl font-bold", children: "Settings" }), _jsx("div", { className: "bg-white p-6 rounded border space-y-4 hover:shadow-md transition-shadow", children: _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium mb-1", children: "Archive retention (days)" }), _jsx("p", { className: "text-xs text-gray-500 mb-2", children: "Projects stay in the archive for this many days before being permanently deleted." }), _jsxs("div", { className: "flex items-center gap-3", children: [_jsx("input", { type: "number", min: 1, max: 365, value: retentionDays, onChange: (e) => save(parseInt(e.target.value, 10) || 7), className: "border p-2 rounded w-24" }), _jsx("span", { className: "text-sm text-gray-600", children: "days" }), saved && _jsx("span", { className: "text-sm text-green-600", children: "Saved!" })] })] }) }), _jsxs("div", { className: "bg-white p-4 rounded border space-y-3 hover:shadow-md transition-shadow", children: [_jsx("h2", { className: "font-semibold text-lg", children: "Synthesis LLM" }), _jsx("p", { className: "text-sm text-gray-500", children: "Select an LLM provider for the self-learning pipeline to synthesize observations into skills and update personality traits." }), providers.length === 0 ? (_jsx("p", { className: "text-sm text-amber-600", children: "No OpenCode providers detected. Configure a provider or use \"Custom Provider\" below." })) : null, _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium", children: "Provider" }), _jsxs("select", { value: providerId, onChange: (e) => {
                                    const val = e.target.value;
                                    setProviderId(val);
                                    setIsCustom(val === "__custom__");
                                    if (val === "__custom__") {
                                        setEndpoint("");
                                        setSelectedModel("");
                                    }
                                    else if (val) {
                                        const p = providers.find(x => x.id === val);
                                        const models = p ? Object.entries(p.models || {}) : [];
                                        const firstModel = models[0];
                                        setEndpoint(firstModel?.[1]?.api?.url || "");
                                        setSelectedModel(firstModel?.[0] || "");
                                    }
                                }, className: "border p-2 rounded w-full text-sm hover:bg-gray-50 cursor-pointer", children: [_jsx("option", { value: "", children: "\u2014 No LLM (heuristics only) \u2014" }), _jsx("option", { value: "__custom__", children: "\u2014 Custom Provider \u2014" }), (() => {
                                        const pinned = [
                                            ["opencode zen", 0], ["opencode pro", 1], ["opencode", 2],
                                            ["go", 3], ["deepseek", 4], ["zen", 5],
                                        ];
                                        const rank = (p) => {
                                            const name = (p.name || "").toLowerCase();
                                            for (const [kw, r] of pinned) {
                                                if (name.includes(kw))
                                                    return r;
                                            }
                                            return 999;
                                        };
                                        const sorted = [...providers]
                                            .filter(p => Object.keys(p.models || {}).length > 0)
                                            .sort((a, b) => {
                                            const ar = rank(a), br = rank(b);
                                            if (ar !== br)
                                                return ar - br;
                                            return a.name.localeCompare(b.name);
                                        });
                                        return sorted.map(p => {
                                            const isFree = p.id === "opencode";
                                            return (_jsxs("option", { value: p.id, children: [p.name, isFree ? " (Free)" : ""] }, p.id));
                                        });
                                    })()] })] }), !isCustom && providerId && providerModels.length > 0 && (_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium", children: "Model" }), _jsx("select", { value: selectedModel, onChange: (e) => setSelectedModel(e.target.value), className: "border p-2 rounded w-full text-sm hover:bg-gray-50 cursor-pointer", children: providerModels.map(([key, val]) => (_jsxs("option", { value: key, children: [key, " ", val?.id ? `(${val.id})` : ""] }, key))) })] })), isCustom && (_jsxs("div", { className: "grid grid-cols-2 gap-4 p-3 bg-gray-50 rounded border", children: [_jsxs("div", { className: "col-span-2", children: [_jsx("label", { className: "block text-sm font-medium", children: "Base URL" }), _jsx("input", { type: "text", value: endpoint, onChange: (e) => setEndpoint(e.target.value), placeholder: "https://api.myprovider.com/v1", className: "border p-2 rounded w-full text-sm font-mono" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium", children: "Model ID" }), _jsx("input", { type: "text", value: customModel, onChange: (e) => setCustomModel(e.target.value), placeholder: "model-id", className: "border p-2 rounded w-full text-sm font-mono" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium", children: "API Key" }), _jsx("input", { type: "password", value: apiKeyState, onChange: (e) => setApiKey(e.target.value), placeholder: "sk-...", className: "border p-2 rounded w-full text-sm" })] })] })), !isCustom && providerId && (_jsx("div", { className: "grid grid-cols-2 gap-4", children: _jsxs("div", { children: [_jsxs("label", { className: "block text-sm font-medium", children: ["API Key ", providerId === "opencode" ? _jsx("span", { className: "text-gray-400 font-normal", children: "(optional for free tier)" }) : ""] }), _jsx("input", { type: "password", value: apiKeyState, onChange: (e) => setApiKey(e.target.value), placeholder: "sk-...", className: "border p-2 rounded w-full text-sm" })] }) })), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium mb-1", children: "Run every" }), _jsxs("select", { value: String(intervalMin), onChange: (e) => { setIntervalMin(Number(e.target.value)); handleIntervalSave(Number(e.target.value)); }, className: "border p-2 rounded w-48 text-sm hover:bg-gray-50 cursor-pointer", children: [_jsx("option", { value: "5", children: "5 minutes" }), _jsx("option", { value: "15", children: "15 minutes" }), _jsx("option", { value: "30", children: "30 minutes" }), _jsx("option", { value: "60", children: "1 hour" }), _jsx("option", { value: "240", children: "4 hours" }), _jsx("option", { value: "0", children: "Disabled" })] }), intervalSaved && _jsx("span", { className: "text-sm text-green-600 ml-2", children: "Saved!" })] }), _jsxs("div", { className: "border-t pt-3 mt-3", children: [_jsxs("button", { type: "button", onClick: () => setShowBackup(!showBackup), className: "text-sm font-medium text-gray-600 hover:text-gray-900", children: [showBackup ? "▾" : "▸", " Backup Provider (fallback)"] }), showBackup && (_jsxs("div", { className: "mt-3 space-y-3", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium", children: "Provider" }), _jsxs("select", { value: backupProviderId, onChange: (e) => {
                                                    const val = e.target.value;
                                                    setBackupProviderId(val);
                                                    setBackupIsCustom(val === "__custom__");
                                                    if (val === "__custom__") {
                                                        setBackupSelectedModel("");
                                                    }
                                                    else if (val) {
                                                        const p = providers.find(x => x.id === val);
                                                        const models = p ? Object.entries(p.models || {}) : [];
                                                        setBackupSelectedModel(models[0]?.[0] || "");
                                                    }
                                                    else {
                                                        setBackupSelectedModel("");
                                                    }
                                                }, className: "border p-2 rounded w-full text-sm hover:bg-gray-50 cursor-pointer", children: [_jsx("option", { value: "", children: "\u2014 None \u2014" }), _jsx("option", { value: "__custom__", children: "\u2014 Custom Provider \u2014" }), (() => {
                                                        const sorted = [...providers]
                                                            .filter(p => Object.keys(p.models || {}).length > 0)
                                                            .sort((a, b) => {
                                                            const rank = (n) => n.toLowerCase().includes("opencode zen") ? 0 : n.toLowerCase().includes("deepseek") ? 1 : 999;
                                                            return rank(a.name) - rank(b.name) || a.name.localeCompare(b.name);
                                                        });
                                                        return sorted.map(p => {
                                                            const isFree = p.id === "opencode";
                                                            return _jsxs("option", { value: p.id, children: [p.name, isFree ? " (Free)" : ""] }, p.id);
                                                        });
                                                    })()] })] }), backupIsCustom && (_jsxs("div", { className: "space-y-3 p-3 bg-gray-50 rounded border", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium", children: "Endpoint" }), _jsx("input", { type: "text", value: backupCustomEndpoint, onChange: (e) => setBackupCustomEndpoint(e.target.value), placeholder: "https://api.myprovider.com/v1", className: "border p-2 rounded w-full text-sm font-mono" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium", children: "Model ID" }), _jsx("input", { type: "text", value: backupCustomModel, onChange: (e) => setBackupCustomModel(e.target.value), placeholder: "model-id", className: "border p-2 rounded w-full text-sm font-mono" })] })] })), backupProviderId && backupModels.length > 0 && (_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium", children: "Model" }), _jsx("select", { value: backupSelectedModel, onChange: (e) => setBackupSelectedModel(e.target.value), className: "border p-2 rounded w-full text-sm hover:bg-gray-50 cursor-pointer", children: backupModels.map(([key, val]) => (_jsxs("option", { value: key, children: [key, " ", val?.id ? `(${val.id})` : ""] }, key))) })] })), backupProviderId && (_jsxs("div", { children: [_jsxs("label", { className: "block text-sm font-medium", children: ["API Key ", backupProviderId === "opencode" ? _jsx("span", { className: "text-gray-400 font-normal", children: "(optional for free tier)" }) : ""] }), _jsx("input", { type: "password", value: backupApiKey, onChange: (e) => setBackupApiKey(e.target.value), placeholder: "sk-...", className: "border p-2 rounded w-full text-sm" })] }))] }))] }), _jsxs("div", { className: "flex gap-2 items-center", children: [_jsx("button", { onClick: saveLlmConfig, disabled: savingLlm, className: "bg-blue-600 text-white p-2 rounded hover:bg-blue-700 disabled:opacity-50 text-sm", children: savingLlm ? "Saving..." : "Save" }), _jsx("button", { onClick: testLlmConnection, disabled: testing || !endpoint, className: "bg-gray-200 text-gray-700 p-2 rounded hover:bg-gray-300 disabled:opacity-50 text-sm", children: testing ? "Testing..." : "Test Connection" }), llmStatus && _jsx("span", { className: `text-sm ${llmStatus.startsWith("✅") ? "text-green-600" : "text-red-600"}`, children: llmStatus })] }), isCustom && customModel && endpoint && (_jsxs("div", { className: "text-xs text-gray-400", children: ["Using custom provider: ", _jsx("strong", { children: endpoint }), " model: ", _jsx("strong", { children: customModel })] })), !isCustom && selectedProvider && (_jsxs("div", { className: "text-xs text-gray-400", children: ["Using ", _jsx("strong", { children: selectedModel || Object.keys(selectedProvider.models || {})[0] }), " from ", selectedProvider.name, " via ", endpoint] })), providerId && (_jsxs("div", { className: "text-xs text-gray-400", children: ["Synthesis runs every 15 minutes \u2014 observes \u2192 analyzes \u2192 creates/updates skills. See ", _jsx("a", { href: "/pipeline", className: "text-blue-600 underline", children: "Pipeline" }), " for activity. Current mode: ", _jsx("strong", { children: "LLM-driven skill synthesis" })] })), !providerId && (_jsxs("div", { className: "text-xs text-gray-400", children: ["Current mode: ", _jsx("strong", { children: "Heuristic trait-only synthesis" }), ". Observations still processed into personality traits."] }))] }), _jsxs("div", { className: "bg-white p-4 rounded border space-y-3 hover:shadow-md transition-shadow", children: [_jsx("h2", { className: "font-semibold text-lg", children: "Email OAuth" }), _jsx("p", { className: "text-sm text-gray-500", children: "Google and Microsoft OAuth 2.0 credentials for connecting email accounts." }), _jsxs("div", { children: [_jsx("h3", { className: "text-sm font-medium text-gray-700 mb-2", children: "Google (Gmail)" }), _jsxs("div", { className: "grid grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium", children: "Client ID" }), _jsx("input", { type: "text", value: gmailClientId, onChange: (e) => setGmailClientId(e.target.value), placeholder: "Google Cloud OAuth client ID", className: "border p-2 rounded w-full text-sm" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium", children: "Client Secret" }), _jsx("input", { type: "password", value: gmailClientSecret, onChange: (e) => setGmailClientSecret(e.target.value), placeholder: "Google Cloud OAuth client secret", className: "border p-2 rounded w-full text-sm" })] })] })] }), _jsxs("div", { className: "border-t pt-3", children: [_jsx("h3", { className: "text-sm font-medium text-gray-700 mb-2", children: "Microsoft (Outlook)" }), _jsxs("div", { className: "grid grid-cols-2 gap-4", children: [_jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium", children: "Client ID" }), _jsx("input", { type: "text", value: outlookClientId, onChange: (e) => setOutlookClientId(e.target.value), placeholder: "Azure AD application client ID", className: "border p-2 rounded w-full text-sm" })] }), _jsxs("div", { children: [_jsx("label", { className: "block text-sm font-medium", children: "Client Secret" }), _jsx("input", { type: "password", value: outlookClientSecret, onChange: (e) => setOutlookClientSecret(e.target.value), placeholder: "Azure AD application client secret", className: "border p-2 rounded w-full text-sm" })] })] })] }), _jsxs("div", { className: "flex gap-2 items-center", children: [_jsx("button", { onClick: saveOauth, disabled: savingOauth, className: "bg-blue-600 text-white p-2 rounded hover:bg-blue-700 disabled:opacity-50 text-sm", children: savingOauth ? "Saving..." : "Save" }), oauthSaved && _jsx("span", { className: "text-sm text-green-600", children: "Saved!" })] })] })] }));
}
