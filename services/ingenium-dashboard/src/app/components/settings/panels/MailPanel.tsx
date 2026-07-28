"use client";
import { useState, useEffect } from "react";
import { api, type OAuthClientSecretOperation, type OAuthClientSecretSetting } from "../../../../lib/api";
import { resolveGlobalProjectName, useProject } from "../../../../lib/ProjectContext";
import SettingRow from "../SettingRow";

type SecretField = "gmail" | "outlook";

interface SecretState {
  isSet: boolean;
  masked: boolean;
}

const EMPTY_SECRET_STATE: SecretState = { isSet: false, masked: false };

function secretState(data: Partial<OAuthClientSecretSetting> | undefined): SecretState {
  return {
    isSet: data?.isSet === true,
    masked: data?.masked === true,
  };
}

function secretStatusLabel(state: SecretState): string {
  if (!state.isSet) return "Not configured";
  return state.masked ? "Configured (masked)" : "Configured";
}

/**
 * Mail settings panel — OAuth credentials (gated by project), mail sync intervals,
 * body/header caching windows, and smart-reply configuration.
 *
 * All mail settings are stored in the server's canonical global project because
 * the mail engine and email routes always resolve that project.
 */
export default function MailPanel() {
  const project = useProject();

  // Mail and OAuth are server-global resources. Resolve the actual global
  // project from the API rather than assuming that the selected project is
  // global-default; the latter can be an external worktree.
  const [globalProject, setGlobalProject] = useState<string | null>(null);
  const [globalProjectLoading, setGlobalProjectLoading] = useState(true);

  // OAuth state
  const [gmailClientId, setGmailClientId] = useState("");
  const [gmailClientSecret, setGmailClientSecret] = useState("");
  const [outlookClientId, setOutlookClientId] = useState("");
  const [outlookClientSecret, setOutlookClientSecret] = useState("");
  const [gmailSecretState, setGmailSecretState] = useState<SecretState>(EMPTY_SECRET_STATE);
  const [outlookSecretState, setOutlookSecretState] = useState<SecretState>(EMPTY_SECRET_STATE);
  const [clearingSecret, setClearingSecret] = useState<SecretField | null>(null);
  const [savingOauth, setSavingOauth] = useState(false);
  const [loadingOauth, setLoadingOauth] = useState(true);

  // Mail sync state
  const [mailIntervalMin, setMailIntervalMin] = useState<number>(5);
  const [offlineWindow, setOfflineWindow] = useState(500);
  const [bodyWindow, setBodyWindow] = useState(200);
  const [loadingSync, setLoadingSync] = useState(true);

  // Smart replies state
  const [smartRepliesEnabled, setSmartRepliesEnabled] = useState(true);
  const [smartRepliesMode, setSmartRepliesMode] = useState("auto");
  const [smartRepliesPrefetch, setSmartRepliesPrefetch] = useState(false);

  // Password visibility toggles
  const [showPw, setShowPw] = useState<Record<string, boolean>>({});
  const togglePw = (name: string) => setShowPw((prev) => ({ ...prev, [name]: !prev[name] }));

  const [toast, setToast] = useState("");
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Resolve the server's canonical global project before any mail setting can
  // be read or written. Mail settings belong to the active global namespace,
  // not to whichever external worktree is selected in the dashboard.
  useEffect(() => {
    let cancelled = false;
    setGlobalProjectLoading(true);

    api.projects.list()
      .then((response) => {
        if (cancelled) return;
        const resolved = resolveGlobalProjectName(response.data);
        setGlobalProject(resolved);
      })
      .catch(() => {
        if (!cancelled) setGlobalProject(null);
      })
      .finally(() => {
        if (!cancelled) setGlobalProjectLoading(false);
      });

    return () => { cancelled = true; };
  }, [project]);

  // Load OAuth settings from the canonical global project. Secret responses
  // are metadata-only; a response value is intentionally never copied into
  // an input, even if a compromised/legacy server includes one.
  useEffect(() => {
    if (!globalProject) {
      if (!globalProjectLoading) setLoadingOauth(false);
      return;
    }
    setLoadingOauth(true);
    Promise.all([
      api.settings.get("oauth_gmail_client_id", globalProject),
      api.settings.get("oauth_gmail_client_secret", globalProject),
      api.settings.get("oauth_outlook_client_id", globalProject),
      api.settings.get("oauth_outlook_client_secret", globalProject),
    ])
      .then(([gid, gs, oid, os]) => {
        setGmailClientId(gid.data?.value ?? "");
        setGmailSecretState(secretState(gs.data));
        setOutlookClientId(oid.data?.value ?? "");
        setOutlookSecretState(secretState(os.data));
        // Protected responses never contain a usable value. Keep these blank
        // so saving without edits produces an explicit preserve operation.
        setGmailClientSecret("");
        setOutlookClientSecret("");
      })
      .catch(() => {})
      .finally(() => setLoadingOauth(false));
  }, [globalProject, globalProjectLoading]);

  // Load mail sync and smart-reply settings.
  useEffect(() => {
    if (!globalProject) {
      if (!globalProjectLoading) setLoadingSync(false);
      return;
    }
    setLoadingSync(true);
    Promise.all([
      api.settings.get("mail_sync_interval_ms", globalProject),
      api.settings.get("mail_offline_window", globalProject),
      api.settings.get("mail_body_window", globalProject),
      api.settings.get("mail_smart_replies_enabled", globalProject),
      api.settings.get("mail_smart_replies_mode", globalProject),
      api.settings.get("mail_smart_replies_prefetch", globalProject),
    ])
      .then(([intervalR, offlineR, bodyR, enabledR, modeR, prefetchR]) => {
        const ms = parseInt(intervalR.data?.value, 10);
        if (!isNaN(ms) && ms >= 0) setMailIntervalMin(ms / 60000);
        const o = parseInt(offlineR.data?.value, 10);
        if (!isNaN(o) && o > 0) setOfflineWindow(o);
        const b = parseInt(bodyR.data?.value, 10);
        if (!isNaN(b) && b > 0) setBodyWindow(b);
        const enabledVal = enabledR.data?.value;
        if (enabledVal === "false") setSmartRepliesEnabled(false);
        else setSmartRepliesEnabled(true);
        setSmartRepliesMode(modeR.data?.value === "manual" ? "manual" : "auto");
        const prefetchVal = prefetchR?.data?.value;
        setSmartRepliesPrefetch(prefetchVal === "true");
      })
      .catch(() => {})
      .finally(() => setLoadingSync(false));
  }, [globalProject, globalProjectLoading]);

  const saveOauth = async () => {
    if (!globalProject || globalProjectLoading) {
      setToast("OAuth credentials are unavailable until the global mail project is resolved.");
      return;
    }
    setSavingOauth(true);
    try {
      await api.settings.set("oauth_gmail_client_id", gmailClientId, globalProject);
      const gmailOperation: OAuthClientSecretOperation = gmailClientSecret.trim()
        ? { action: "replace", value: gmailClientSecret }
        : { action: "preserve" };
      const gmailResult = await api.settings.set("oauth_gmail_client_secret", gmailOperation, globalProject);
      await api.settings.set("oauth_outlook_client_id", outlookClientId, globalProject);
      const outlookOperation: OAuthClientSecretOperation = outlookClientSecret.trim()
        ? { action: "replace", value: outlookClientSecret }
        : { action: "preserve" };
      const outlookResult = await api.settings.set("oauth_outlook_client_secret", outlookOperation, globalProject);
      if (gmailResult.data && "isSet" in gmailResult.data) setGmailSecretState(secretState(gmailResult.data));
      if (outlookResult.data && "isSet" in outlookResult.data) setOutlookSecretState(secretState(outlookResult.data));
      setGmailClientSecret("");
      setOutlookClientSecret("");
      setToast(`OAuth settings saved in global project “${globalProject}” ✓`);
    } catch (err: any) {
      setToast(`Error: ${err.message}`);
    }
    setSavingOauth(false);
  };

  const clearSecret = async (field: SecretField) => {
    if (!globalProject || globalProjectLoading) return;
    const current = field === "gmail" ? gmailSecretState : outlookSecretState;
    if (!current.isSet || clearingSecret) return;
    const label = field === "gmail" ? "Gmail" : "Outlook";
    if (!window.confirm(`Clear the saved ${label} client secret? This cannot be undone.`)) return;

    const key = field === "gmail" ? "oauth_gmail_client_secret" : "oauth_outlook_client_secret";
    setClearingSecret(field);
    try {
      const operation: OAuthClientSecretOperation = { action: "clear" };
      const result = await api.settings.set(key, operation, globalProject);
      const next = result.data && "isSet" in result.data ? secretState(result.data) : EMPTY_SECRET_STATE;
      if (field === "gmail") {
        setGmailSecretState(next);
        setGmailClientSecret("");
      } else {
        setOutlookSecretState(next);
        setOutlookClientSecret("");
      }
      setToast(`${label} client secret cleared from global project “${globalProject}” ✓`);
    } catch (err: any) {
      setToast(`Error: ${err.message}`);
    } finally {
      setClearingSecret(null);
    }
  };

  const saveSetting = async (key: string, value: string, successMsg: string) => {
    if (!globalProject) {
      setToast("Mail settings are unavailable until the global mail project is resolved.");
      return;
    }
    try {
      // Mail settings are consumed by the server's global mail engine.
      await api.settings.set(key, value, globalProject);
      setToast(successMsg);
    } catch (err: any) {
      setToast(`Error: ${err.message}`);
    }
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
    secret,
    onClear,
    clearDisabled,
  }: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    name: string;
    secret: SecretState;
    onClear: () => void;
    clearDisabled: boolean;
  }) {
    return (
      <div className="flex items-center gap-1">
        <input
          type={showPw[name] ? "text" : "password"}
          value={value}
          onChange={(e) => onChange(e.target.value)}
          placeholder={secret.isSet ? "Saved secret — leave blank to preserve" : placeholder}
          autoComplete="new-password"
          className="border border-[var(--color-border)] rounded px-3 py-1.5 text-sm bg-[var(--color-surface)] w-64 text-[var(--color-text-primary)]"
        />
        <button
          type="button"
          onClick={() => togglePw(name)}
          className="text-xs text-[var(--color-text-muted)] hover:text-[var(--color-text-primary)] whitespace-nowrap px-1"
        >
          {showPw[name] ? "Hide" : "Show"}
        </button>
        {secret.isSet && (
          <button
            type="button"
            onClick={onClear}
            disabled={clearDisabled}
            className="text-xs text-[var(--color-error-text)] hover:underline disabled:opacity-50 disabled:cursor-not-allowed whitespace-nowrap px-1"
          >
            {clearDisabled ? "Clearing..." : "Clear"}
          </button>
        )}
      </div>
    );
  }

  return (
    <div>
      <div className="px-6 pt-5 pb-2">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">OAuth Credentials</h3>
        <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
          Google and Microsoft OAuth 2.0 credentials for connecting email accounts. These follow the server&apos;s global mail project, not the selected worktree.
        </p>
        {globalProject && (
          <p className="text-xs text-[var(--color-text-secondary)] mt-2" data-testid="oauth-project-notice">
            Saving to global project: <span className="font-mono">{globalProject}</span> (selected project: <span className="font-mono">{project}</span>)
          </p>
        )}
      </div>

      {globalProjectLoading || loadingOauth ? (
        <div className="px-6 py-4 text-sm text-[var(--color-text-muted)] animate-pulse">Resolving global mail credentials...</div>
      ) : !globalProject ? (
        <div className="px-6 py-4 text-sm text-[var(--color-error-text)]">
          OAuth credentials are unavailable because the server did not return a global mail project. No credentials were changed.
        </div>
      ) : (
        <>
          <SettingRow label="Gmail Client ID" description="Google Cloud OAuth client ID">
            <input
              type="text"
              value={gmailClientId}
              onChange={(e) => setGmailClientId(e.target.value)}
              placeholder="Google Cloud OAuth client ID"
              className="border border-[var(--color-border)] rounded px-3 py-1.5 text-sm bg-[var(--color-surface)] w-64 text-[var(--color-text-primary)]"
            />
          </SettingRow>

          <SettingRow label="Gmail Client Secret" description="Google Cloud OAuth client secret">
            <PwInput
              name="gmailSecret"
              value={gmailClientSecret}
              onChange={setGmailClientSecret}
              placeholder="Google Cloud OAuth client secret"
              secret={gmailSecretState}
              onClear={() => void clearSecret("gmail")}
              clearDisabled={clearingSecret === "gmail" || savingOauth}
            />
            <span className="block text-xs text-[var(--color-text-muted)] mt-1">{secretStatusLabel(gmailSecretState)}</span>
          </SettingRow>

          <SettingRow label="Outlook Client ID" description="Azure AD application client ID">
            <input
              type="text"
              value={outlookClientId}
              onChange={(e) => setOutlookClientId(e.target.value)}
              placeholder="Azure AD application client ID"
              className="border border-[var(--color-border)] rounded px-3 py-1.5 text-sm bg-[var(--color-surface)] w-64 text-[var(--color-text-primary)]"
            />
          </SettingRow>

          <SettingRow label="Outlook Client Secret" description="Azure AD application client secret">
            <PwInput
              name="outlookSecret"
              value={outlookClientSecret}
              onChange={setOutlookClientSecret}
              placeholder="Azure AD application client secret"
              secret={outlookSecretState}
              onClear={() => void clearSecret("outlook")}
              clearDisabled={clearingSecret === "outlook" || savingOauth}
            />
            <span className="block text-xs text-[var(--color-text-muted)] mt-1">{secretStatusLabel(outlookSecretState)}</span>
          </SettingRow>

          <div className="px-6 py-3 border-t border-[var(--color-border)]">
            <button
              onClick={saveOauth}
              disabled={savingOauth || globalProjectLoading || !globalProject}
              className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
            >
              {savingOauth ? "Saving..." : "Save OAuth Credentials"}
            </button>
          </div>
        </>
      )}

      <div className="px-6 pt-5 pb-2">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">Mail Sync</h3>
        <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
          Configure how often the server checks for new emails and how many emails to cache.
        </p>
      </div>

      {loadingSync ? (
        <div className="px-6 py-4 text-sm text-[var(--color-text-muted)] animate-pulse">Loading sync settings...</div>
      ) : (
        <>
          <SettingRow label="Check every" description="Mail sync polling interval">
            <select
              value={String(mailIntervalMin)}
              onChange={(e) => {
                const min = Number(e.target.value);
                setMailIntervalMin(min);
                saveSetting(
                  "mail_sync_interval_ms",
                  String(min * 60000),
                  "Mail sync interval updated ✓",
                );
              }}
              className="border border-[var(--color-border)] rounded px-3 py-1.5 text-sm bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
            >
              <option value="0">Off</option>
              <option value="1">1 minute</option>
              <option value="5">5 minutes</option>
              <option value="15">15 minutes</option>
              <option value="30">30 minutes</option>
            </select>
          </SettingRow>

          <SettingRow label="Offline window" description="Max email headers to sync per folder (default 500)">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={50}
                max={5000}
                value={offlineWindow}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v > 0) {
                    setOfflineWindow(v);
                    saveSetting("mail_offline_window", String(v), "Offline window updated ✓");
                  }
                }}
                className="border border-[var(--color-border)] rounded px-3 py-1.5 text-sm bg-[var(--color-surface)] w-24 text-[var(--color-text-primary)]"
              />
              <span className="text-xs text-[var(--color-text-muted)]">headers</span>
            </div>
          </SettingRow>

          <SettingRow label="Body window" description="Max email bodies to cache per folder (default 200)">
            <div className="flex items-center gap-2">
              <input
                type="number"
                min={10}
                max={2000}
                value={bodyWindow}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  if (!isNaN(v) && v > 0) {
                    setBodyWindow(v);
                    saveSetting("mail_body_window", String(v), "Body window updated ✓");
                  }
                }}
                className="border border-[var(--color-border)] rounded px-3 py-1.5 text-sm bg-[var(--color-surface)] w-24 text-[var(--color-text-primary)]"
              />
              <span className="text-xs text-[var(--color-text-muted)]">bodies</span>
            </div>
          </SettingRow>

          <SettingRow label="Enable Smart Replies" description="Show AI-drafted reply suggestions when reading emails">
            <input
              type="checkbox"
              checked={smartRepliesEnabled}
              onChange={(e) => {
                const checked = e.target.checked;
                setSmartRepliesEnabled(checked);
                saveSetting(
                  "mail_smart_replies_enabled",
                  checked ? "true" : "false",
                  checked ? "Smart replies enabled ✓" : "Smart replies disabled ✓",
                );
              }}
              className="w-4 h-4 cursor-pointer"
            />
          </SettingRow>

          <SettingRow label="Trigger mode" description="How smart replies are triggered">
            <select
              value={smartRepliesMode}
              onChange={(e) => {
                const v = e.target.value;
                setSmartRepliesMode(v);
                saveSetting(
                  "mail_smart_replies_mode",
                  v,
                  v === "auto" ? "Trigger mode set to automatic ✓" : "Trigger mode set to manual ✓",
                );
              }}
              className="border border-[var(--color-border)] rounded px-3 py-1.5 text-sm bg-[var(--color-surface)] hover:bg-[var(--color-surface-hover)] cursor-pointer"
            >
              <option value="auto">Automatic (on email open)</option>
              <option value="manual">Manual (click to generate)</option>
            </select>
          </SettingRow>

          <SettingRow label="Precompute replies" description="Pre-generate smart replies in the background so they load instantly when you open an email">
            <input
              type="checkbox"
              checked={smartRepliesPrefetch}
              onChange={async (e) => {
                const checked = e.target.checked;
                setSmartRepliesPrefetch(checked);
                try {
                  if (!globalProject) {
                    setToast("Mail settings are unavailable until the global mail project is resolved.");
                    return;
                  }
                  await api.settings.set("mail_smart_replies_prefetch", checked ? "true" : "false", globalProject);
                  setToast(`Precompute replies ${checked ? "enabled" : "disabled"} ✓`);
                } catch (err: any) {
                  setToast(`Error: ${err.message}`);
                }
              }}
              className="w-4 h-4 cursor-pointer"
            />
          </SettingRow>
        </>
      )}

      {toast && (
        <div className="fixed bottom-4 right-4 bg-green-600 text-white px-4 py-2 rounded shadow-lg z-50 text-sm">
          {toast}
        </div>
      )}
    </div>
  );
}
