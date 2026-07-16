"use client";
import { useState, useEffect } from "react";
import { api } from "../../../../lib/api";
import { useProject } from "../../../../lib/ProjectContext";
import SettingRow from "../SettingRow";

export default function MailPanel() {
  const project = useProject();

  // OAuth state
  const [gmailClientId, setGmailClientId] = useState("");
  const [gmailClientSecret, setGmailClientSecret] = useState("");
  const [outlookClientId, setOutlookClientId] = useState("");
  const [outlookClientSecret, setOutlookClientSecret] = useState("");
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

  // Toast
  const [toast, setToast] = useState("");
  useEffect(() => {
    if (!toast) return;
    const t = setTimeout(() => setToast(""), 3000);
    return () => clearTimeout(t);
  }, [toast]);

  // Load OAuth settings
  useEffect(() => {
    Promise.all([
      api.settings.get("oauth_gmail_client_id", project),
      api.settings.get("oauth_gmail_client_secret", project),
      api.settings.get("oauth_outlook_client_id", project),
      api.settings.get("oauth_outlook_client_secret", project),
    ])
      .then(([gid, gs, oid, os]) => {
        if (gid.data?.value) setGmailClientId(gid.data.value);
        if (gs.data?.value) setGmailClientSecret(gs.data.value);
        if (oid.data?.value) setOutlookClientId(oid.data.value);
        if (os.data?.value) setOutlookClientSecret(os.data.value);
      })
      .catch(() => {})
      .finally(() => setLoadingOauth(false));
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Load mail sync interval — smart-reply settings read from global project
  // (sync engine + API route always resolve to global-default)
  useEffect(() => {
    Promise.all([
      api.settings.get("mail_sync_interval_ms", project),
      api.settings.get("mail_offline_window", project),
      api.settings.get("mail_body_window", project),
      api.settings.get("mail_smart_replies_enabled", "global-default"),
      api.settings.get("mail_smart_replies_mode", "global-default"),
      api.settings.get("mail_smart_replies_prefetch", "global-default"),
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
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const saveOauth = async () => {
    setSavingOauth(true);
    try {
      await api.settings.set("oauth_gmail_client_id", gmailClientId, project);
      await api.settings.set("oauth_gmail_client_secret", gmailClientSecret, project);
      await api.settings.set("oauth_outlook_client_id", outlookClientId, project);
      await api.settings.set("oauth_outlook_client_secret", outlookClientSecret, project);
      setToast("OAuth settings saved ✓");
    } catch (err: any) {
      setToast(`Error: ${err.message}`);
    }
    setSavingOauth(false);
  };

  const saveSetting = async (key: string, value: string, successMsg: string, useGlobal = false) => {
    try {
      const targetProject = useGlobal ? "global-default" : project;
      await api.settings.set(key, value, targetProject);
      setToast(successMsg);
    } catch (err: any) {
      setToast(`Error: ${err.message}`);
    }
  };

  /** Reusable password input with show/hide toggle */
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
          className="border border-[var(--color-border)] rounded px-3 py-1.5 text-sm bg-[var(--color-surface)] w-64 text-[var(--color-text-primary)]"
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
      {/* Section: OAuth Credentials */}
      <div className="px-6 pt-5 pb-2">
        <h3 className="text-sm font-semibold text-[var(--color-text-primary)]">OAuth Credentials</h3>
        <p className="text-xs text-[var(--color-text-muted)] mt-0.5">
          Google and Microsoft OAuth 2.0 credentials for connecting email accounts.
        </p>
      </div>

      {loadingOauth ? (
        <div className="px-6 py-4 text-sm text-[var(--color-text-muted)] animate-pulse">Loading credentials...</div>
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
            />
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
            />
          </SettingRow>

          <div className="px-6 py-3 border-t border-[var(--color-border)]">
            <button
              onClick={saveOauth}
              disabled={savingOauth}
              className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm hover:bg-blue-700 disabled:opacity-50 cursor-pointer"
            >
              {savingOauth ? "Saving..." : "Save OAuth Credentials"}
            </button>
          </div>
        </>
      )}

      {/* Section: Mail Sync */}
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
                true, // global-default (API route reads from global project)
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
                true, // global-default (API route reads from global project)
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
                  await api.settings.set("mail_smart_replies_prefetch", checked ? "true" : "false", "global-default");
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

      {/* Toast */}
      {toast && (
        <div className="fixed bottom-4 right-4 bg-green-600 text-white px-4 py-2 rounded shadow-lg z-50 text-sm">
          {toast}
        </div>
      )}
    </div>
  );
}
