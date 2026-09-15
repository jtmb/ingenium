"use client";

import { useEffect, useState } from "react";
import Select from "../../Select";
import {
  api,
  type CloudflareServiceId,
  type CloudflareTunnelConfig,
  type CloudflareTunnelStatus,
  type CloudflareTokenOperation,
} from "../../../../lib/api";

const SERVICES: Array<{ id: CloudflareServiceId; label: string }> = [
  { id: "dashboard", label: "Dashboard" },
  { id: "opencode", label: "OpenCode" },
  { id: "cli", label: "CLI" },
  { id: "vscode", label: "VS Code" },
  { id: "api", label: "API" },
];

function statusLabel(value: string): string {
  return value.replaceAll("_", " ").replace(/^./, (character) => character.toUpperCase());
}

export default function CloudflarePanel() {
  const [status, setStatus] = useState<CloudflareTunnelStatus | null>(null);
  const [config, setConfig] = useState<CloudflareTunnelConfig | null>(null);
  const [token, setToken] = useState("");
  const [busy, setBusy] = useState<string | null>(null);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    let cancelled = false;
    api.cloudflare.get()
      .then(({ data }) => {
        if (cancelled) return;
        setStatus(data);
        setConfig(data.config);
      })
      .catch((reason: unknown) => {
        if (!cancelled) setError(reason instanceof Error ? reason.message : "Cloudflare settings could not be loaded");
      });
    return () => { cancelled = true; };
  }, []);

  const run = async (label: string, operation: () => Promise<{ data: CloudflareTunnelStatus }>) => {
    setBusy(label);
    setError("");
    setMessage("");
    try {
      const result = await operation();
      setStatus(result.data);
      setConfig(result.data.config);
      setToken("");
      setMessage(`${label} completed. Connector: ${statusLabel(result.data.connector.state)}.`);
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : `${label} failed`);
    } finally {
      setBusy(null);
    }
  };

  const updateService = (service: CloudflareServiceId, update: Partial<CloudflareTunnelConfig["services"][CloudflareServiceId]>) => {
    setConfig((current) => current ? {
      ...current,
      services: { ...current.services, [service]: { ...current.services[service], ...update } },
    } : current);
  };

  const save = () => {
    if (!config) return;
    const tokenOperation: CloudflareTokenOperation = token
      ? { action: "replace", value: token }
      : { action: "preserve" };
    void run("Save", () => api.cloudflare.update(config, tokenOperation));
  };

  const clearToken = () => {
    if (!config || !window.confirm("Clear the saved Cloudflare tunnel token?")) return;
    void run("Clear token", () => api.cloudflare.update(config, { action: "clear" }));
  };

  if (!config || !status) {
    return error
      ? <div role="alert" className="px-6 py-5 text-sm text-[var(--color-error-text)]">{error}</div>
      : <div role="status" className="px-6 py-5 text-sm text-[var(--color-text-muted)]">Loading Cloudflare settings...</div>;
  }

  return (
    <div className="space-y-5 px-6 py-5">
      <div>
        <h3 className="text-base font-semibold text-[var(--color-text-primary)]">Cloudflare Tunnel</h3>
        <p className="mt-1 text-sm text-[var(--color-text-muted)]">
          Configure an existing named tunnel. DNS and tunnel creation remain in Cloudflare; external MCP remains local stdio through the authenticated HTTPS API.
        </p>
      </div>

      <div className="grid gap-3 sm:grid-cols-4" aria-label="Cloudflare status">
        <div className="rounded border border-[var(--color-border)] p-3">
          <div className="text-xs text-[var(--color-text-muted)]">Desired</div>
          <div className="font-medium text-[var(--color-text-primary)]">{status.desired.enabled ? "Enabled" : "Disabled"}</div>
        </div>
        <div className="rounded border border-[var(--color-border)] p-3">
          <div className="text-xs text-[var(--color-text-muted)]">Connector</div>
          <div className="font-medium text-[var(--color-text-primary)]">{statusLabel(status.connector.state)}</div>
        </div>
        <div className="rounded border border-[var(--color-border)] p-3">
          <div className="text-xs text-[var(--color-text-muted)]">Authentication</div>
          <div className="font-medium text-[var(--color-text-primary)]">{status.token.configured ? `Configured (${statusLabel(status.token.readiness)})` : "Not configured"}</div>
        </div>
        <div className="rounded border border-[var(--color-border)] p-3">
          <div className="text-xs text-[var(--color-text-muted)]">Route inventory</div>
          <div className="font-medium text-[var(--color-text-primary)]">{statusLabel(status.inventory.status)}</div>
        </div>
      </div>

      <label className="flex items-center gap-2 text-sm text-[var(--color-text-primary)]">
        <input
          type="checkbox"
          checked={config.enabled}
          onChange={(event) => setConfig({ ...config, enabled: event.target.checked })}
        />
        Enable desired connector configuration
      </label>

      <label className="block text-sm text-[var(--color-text-primary)]" htmlFor="cloudflare-tunnel-name">
        Existing tunnel name
        <input
          id="cloudflare-tunnel-name"
          value={config.tunnelName}
          readOnly
          maxLength={128}
          className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
        />
      </label>

      <fieldset className="space-y-3">
        <legend className="text-sm font-semibold text-[var(--color-text-primary)]">Public service mappings</legend>
        <p className="text-xs text-[var(--color-text-muted)]">
          Each service is gated separately. OpenCode, CLI, and VS Code target authenticated production audience gateways; local compatibility upstreams are rejected.
        </p>
        {SERVICES.map(({ id, label }) => {
          const route = status.routes.find((candidate) => candidate.service === id);
          return (
            <div key={id} className="rounded border border-[var(--color-border)] p-3">
              <div className="flex flex-wrap items-center gap-3">
                <label className="flex min-w-28 items-center gap-2 text-sm font-medium text-[var(--color-text-primary)]">
                  <input
                    type="checkbox"
                    checked={config.services[id].enabled}
                    onChange={(event) => updateService(id, { enabled: event.target.checked })}
                  />
                  {label}
                </label>
                <label className="min-w-56 flex-1 text-xs text-[var(--color-text-muted)]" htmlFor={`cloudflare-${id}-url`}>
                  Public HTTPS origin
                  <Select
                    id={`cloudflare-${id}-url`}
                    value={config.services[id].publicUrl}
                    onChange={(event) => updateService(id, { publicUrl: event.target.value })}
                    disabled={status.inventory.status !== "ready"}
                    wrapperClassName="mt-1"
                    className="w-full text-sm"
                  >
                    <option value="">Not selected</option>
                    {(route?.availableOrigins ?? []).map((origin) => <option key={origin} value={origin}>{origin}</option>)}
                  </Select>
                </label>
              </div>
              <p className="mt-2 text-xs text-[var(--color-text-muted)]">
                Route health: {statusLabel(route?.health ?? "unknown")}
              </p>
            </div>
          );
        })}
      </fieldset>

      <div>
        <label className="block text-sm text-[var(--color-text-primary)]" htmlFor="cloudflare-token">
          Tunnel token (write only)
          <input
            id="cloudflare-token"
            type="password"
            autoComplete="new-password"
            value={token}
            onChange={(event) => setToken(event.target.value)}
            placeholder={status.token.configured ? "Saved token — leave blank to preserve" : "Paste tunnel token"}
            className="mt-1 w-full rounded border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2"
          />
        </label>
        {status.token.configured && (
          <button type="button" onClick={clearToken} disabled={Boolean(busy)} className="mt-2 text-xs text-[var(--color-error-text)] hover:underline disabled:opacity-50">
            Clear saved token
          </button>
        )}
      </div>

      {error && <p role="alert" className="text-sm text-[var(--color-error-text)]">{error}</p>}
      {status.inventory.error && <p role="alert" className="text-sm text-[var(--color-error-text)]">{status.inventory.error}</p>}
      {message && <p role="status" className="text-sm text-[var(--color-success-text)]">{message}</p>}

      <div className="flex flex-wrap gap-2">
        <button type="button" onClick={save} disabled={Boolean(busy)} className="rounded bg-[var(--color-accent)] px-4 py-2 text-sm text-white disabled:opacity-50">
          {busy === "Save" ? "Saving..." : "Save"}
        </button>
        <button type="button" onClick={() => void run("Validate", api.cloudflare.validate)} disabled={Boolean(busy)} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm hover:bg-[var(--color-surface-hover)] disabled:opacity-50">
          Validate
        </button>
        <button type="button" onClick={() => void run("Connect", api.cloudflare.connect)} disabled={Boolean(busy) || status.inventory.status !== "ready"} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm hover:bg-[var(--color-surface-hover)] disabled:opacity-50">
          Connect
        </button>
        <button type="button" onClick={() => void run("Disconnect", api.cloudflare.disconnect)} disabled={Boolean(busy)} className="rounded border border-[var(--color-border)] px-4 py-2 text-sm hover:bg-[var(--color-surface-hover)] disabled:opacity-50">
          Disconnect
        </button>
      </div>
    </div>
  );
}
