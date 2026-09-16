import { isIP } from "node:net";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import { getCanonicalGlobalProject } from "./projects.js";
import * as settings from "./settings.js";
import * as vault from "./vault.js";

export const CLOUDFLARE_TUNNEL_SETTING_KEY = "cloudflare_tunnel_config";
export const CLOUDFLARE_TUNNEL_TOKEN_SETTING_KEY = "cloudflare_tunnel_token";
const TOKEN_ITEM_NAME = "Cloudflare Tunnel Token";
const DELETED_VAULT_POLICY = '{"mode":"deleted"}';

export const CLOUDFLARE_SERVICE_IDS = ["dashboard", "opencode", "cli", "vscode", "api"] as const;
export type CloudflareServiceId = (typeof CLOUDFLARE_SERVICE_IDS)[number];

export const CLOUDFLARE_SERVICE_TARGETS: Readonly<Record<CloudflareServiceId, string>> = Object.freeze({
  dashboard: "authenticated-production-dashboard-gateway",
  opencode: "authenticated-production-opencode-audience-gateway",
  cli: "authenticated-production-cli-audience-gateway",
  vscode: "authenticated-production-vscode-audience-gateway",
  api: "authenticated-https-api-boundary",
});

export interface CloudflareServiceMapping {
  enabled: boolean;
  publicUrl: string;
}

export interface CloudflareTunnelConfig {
  enabled: boolean;
  tunnelName: string;
  services: Record<CloudflareServiceId, CloudflareServiceMapping>;
}

export interface CloudflareTrustedIngressRoute {
  publicUrl: string;
  target: string;
}

export interface CloudflareTrustedIngressInventory {
  tunnelName: string;
  routes: Record<CloudflareServiceId, CloudflareTrustedIngressRoute[]>;
}

export type CloudflareTunnelConfigRead =
  | { status: "ok"; config: CloudflareTunnelConfig }
  | { status: "invalid"; config: CloudflareTunnelConfig; error: string };

export type CloudflareTokenAction = "preserve" | "replace" | "clear";
export type CloudflareTokenResult =
  | { status: "ok"; configured: boolean }
  | { status: "invalid"; configured: boolean }
  | { status: "vault_unavailable"; configured: boolean };

function emptyServices(): Record<CloudflareServiceId, CloudflareServiceMapping> {
  return Object.fromEntries(CLOUDFLARE_SERVICE_IDS.map((service) => [service, { enabled: false, publicUrl: "" }])) as Record<CloudflareServiceId, CloudflareServiceMapping>;
}

export function defaultCloudflareTunnelConfig(): CloudflareTunnelConfig {
  return { enabled: false, tunnelName: "", services: emptyServices() };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return Boolean(value) && typeof value === "object" && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowed: readonly string[]): boolean {
  return Object.keys(value).every((key) => allowed.includes(key)) && allowed.every((key) => Object.hasOwn(value, key));
}

function validatePublicOrigin(value: string): string | null {
  if (value.length > 512) return "publicUrl must be 512 characters or fewer";
  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return "publicUrl must be an exact HTTPS origin";
  }
  const hostname = parsed.hostname;
  const reservedSuffixes = [".localhost", ".local", ".internal", ".test", ".example", ".invalid", ".home.arpa", ".onion"];
  if (parsed.protocol !== "https:" || parsed.username || parsed.password || parsed.port
    || parsed.pathname !== "/" || parsed.search || parsed.hash
    || value !== `https://${hostname}/`
    || isIP(hostname) !== 0 || !hostname.includes(".") || hostname.endsWith(".")
    || hostname === "localhost" || reservedSuffixes.some((suffix) => hostname.endsWith(suffix))
    || !hostname.split(".").every((label) => /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(label))) {
    return "publicUrl must be an exact public HTTPS origin without credentials, ports, paths, query, or fragment";
  }
  return null;
}

function validateTunnelName(value: string): string | null {
  if (!value) return "tunnelName is required";
  return /^(?:[A-Za-z0-9]|[A-Za-z0-9][A-Za-z0-9 ._-]{0,126}[A-Za-z0-9])$/.test(value)
    ? null
    : "tunnelName must be 1-128 letters, numbers, spaces, dots, underscores, or hyphens";
}

export function validateCloudflareTrustedIngressInventory(value: unknown):
  | { ok: true; inventory: CloudflareTrustedIngressInventory }
  | { ok: false; error: string } {
  if (!isRecord(value) || !hasOnlyKeys(value, ["tunnelName", "routes"])
    || typeof value.tunnelName !== "string" || !isRecord(value.routes)) {
    return { ok: false, error: "trusted ingress inventory must contain only tunnelName and routes" };
  }
  const tunnelName = value.tunnelName.trim();
  const tunnelNameError = validateTunnelName(tunnelName);
  if (tunnelNameError) return { ok: false, error: tunnelNameError };
  if (!hasOnlyKeys(value.routes, CLOUDFLARE_SERVICE_IDS)) {
    return { ok: false, error: "trusted ingress routes must contain exactly dashboard, opencode, cli, vscode, and api" };
  }

  const routes: Record<CloudflareServiceId, CloudflareTrustedIngressRoute[]> = {
    dashboard: [], opencode: [], cli: [], vscode: [], api: [],
  };
  const assignedOrigins = new Set<string>();
  for (const service of CLOUDFLARE_SERVICE_IDS) {
    const candidates = value.routes[service];
    if (!Array.isArray(candidates) || candidates.length > 16) {
      return { ok: false, error: `${service} trusted ingress routes must be an array of at most 16 entries` };
    }
    routes[service] = [];
    for (const candidate of candidates) {
      if (!isRecord(candidate) || !hasOnlyKeys(candidate, ["publicUrl", "target"])
        || typeof candidate.publicUrl !== "string" || typeof candidate.target !== "string") {
        return { ok: false, error: `${service} trusted ingress route must contain only publicUrl and target` };
      }
      const publicUrl = candidate.publicUrl.trim();
      const publicUrlError = validatePublicOrigin(publicUrl);
      if (publicUrlError) return { ok: false, error: `${service}.${publicUrlError}` };
      if (candidate.target !== CLOUDFLARE_SERVICE_TARGETS[service]) {
        return { ok: false, error: `${service} trusted ingress route must use its authenticated production target` };
      }
      if (assignedOrigins.has(publicUrl)) {
        return { ok: false, error: "trusted ingress origins must be assigned to only one audience" };
      }
      assignedOrigins.add(publicUrl);
      routes[service].push({ publicUrl, target: candidate.target });
    }
  }
  return { ok: true, inventory: { tunnelName, routes } };
}

export function validateCloudflareTunnelConfig(value: unknown, inventory?: CloudflareTrustedIngressInventory):
  | { ok: true; config: CloudflareTunnelConfig }
  | { ok: false; error: string } {
  if (!isRecord(value) || !hasOnlyKeys(value, ["enabled", "tunnelName", "services"])) {
    return { ok: false, error: "config must contain only enabled, tunnelName, and services" };
  }
  if (typeof value.enabled !== "boolean" || typeof value.tunnelName !== "string" || !isRecord(value.services)) {
    return { ok: false, error: "enabled, tunnelName, and services are required" };
  }
  const tunnelName = value.tunnelName.trim();
  if (tunnelName && validateTunnelName(tunnelName)) return { ok: false, error: validateTunnelName(tunnelName)! };
  if (value.enabled && !tunnelName) return { ok: false, error: "tunnelName is required when the connector is enabled" };
  if (!hasOnlyKeys(value.services, CLOUDFLARE_SERVICE_IDS)) {
    return { ok: false, error: "services must contain exactly dashboard, opencode, cli, vscode, and api" };
  }

  const services = emptyServices();
  const enabledUrls = new Set<string>();
  for (const service of CLOUDFLARE_SERVICE_IDS) {
    const mapping = value.services[service];
    if (!isRecord(mapping) || !hasOnlyKeys(mapping, ["enabled", "publicUrl"])
      || typeof mapping.enabled !== "boolean" || typeof mapping.publicUrl !== "string") {
      return { ok: false, error: `${service} must contain only enabled and publicUrl` };
    }
    const publicUrl = mapping.publicUrl.trim();
    if (publicUrl) {
      const error = validatePublicOrigin(publicUrl);
      if (error) return { ok: false, error: `${service}.${error}` };
    }
    if (mapping.enabled && !publicUrl) return { ok: false, error: `${service}.publicUrl is required when enabled` };
    if (publicUrl && (!inventory || !inventory.routes[service].some((route) => route.publicUrl === publicUrl))) {
      return { ok: false, error: `${service}.publicUrl is not present in the trusted ingress inventory` };
    }
    if (mapping.enabled && enabledUrls.has(publicUrl)) return { ok: false, error: "enabled services must use distinct publicUrl origins" };
    if (mapping.enabled) enabledUrls.add(publicUrl);
    services[service] = { enabled: mapping.enabled, publicUrl };
  }
  if (value.enabled && enabledUrls.size === 0) return { ok: false, error: "at least one service must be enabled" };
  if ((value.enabled || tunnelName || enabledUrls.size > 0) && !inventory) {
    return { ok: false, error: "trusted ingress inventory is unavailable" };
  }
  if (inventory && tunnelName && tunnelName !== inventory.tunnelName) {
    return { ok: false, error: "tunnelName does not match the trusted ingress inventory" };
  }
  return { ok: true, config: { enabled: value.enabled, tunnelName, services } };
}

function canonicalProjectId(): string {
  const project = getCanonicalGlobalProject();
  if (!project) throw new Error("Canonical global project is unavailable");
  return project.id;
}

export function getCloudflareTunnelConfig(inventory?: CloudflareTrustedIngressInventory): CloudflareTunnelConfigRead {
  const raw = settings.getSetting(canonicalProjectId(), CLOUDFLARE_TUNNEL_SETTING_KEY);
  if (!raw) return { status: "ok", config: defaultCloudflareTunnelConfig() };
  try {
    const result = validateCloudflareTunnelConfig(JSON.parse(raw), inventory);
    return result.ok ? { status: "ok", config: result.config } : { status: "invalid", config: defaultCloudflareTunnelConfig(), error: result.error };
  } catch {
    return { status: "invalid", config: defaultCloudflareTunnelConfig(), error: "saved Cloudflare configuration is malformed" };
  }
}

export function saveCloudflareTunnelConfig(
  value: unknown,
  inventory?: CloudflareTrustedIngressInventory,
  token: { action: CloudflareTokenAction; value?: string } = { action: "preserve" },
): CloudflareTunnelConfig {
  const result = validateCloudflareTunnelConfig(value, inventory);
  if (!result.ok) throw new Error(result.error);
  const projectId = canonicalProjectId();
  execTransaction(() => {
    const updated = updateCloudflareTunnelToken(token.action, token.value);
    if (updated.status !== "ok") throw new Error(updated.status === "invalid" ? "CLOUDFLARE_TOKEN_INVALID" : "VAULT_REQUIRED");
    settings.setSetting(projectId, CLOUDFLARE_TUNNEL_SETTING_KEY, JSON.stringify(result.config));
  });
  checkpointAfterWrite();
  return result.config;
}

function tokenItemIds(projectId: string): string[] {
  return (getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data").prepare(
    `SELECT id FROM vault_items
     WHERE project_id = ? AND name = ? AND type = 'api_key'
       AND owner_kind = 'organization' AND owner_user_id IS NULL AND access_policy <> ?
     ORDER BY created_at DESC, id DESC`,
  ).all(projectId, TOKEN_ITEM_NAME, DELETED_VAULT_POLICY) as Array<{ id: string }>).map(({ id }) => id);
}

export function getCloudflareTunnelTokenMetadata(): { configured: boolean; vaultSealed: boolean } {
  return { configured: tokenItemIds(canonicalProjectId()).length > 0, vaultSealed: vault.isSealed() };
}

export function getCloudflareTunnelToken(): string | undefined {
  const projectId = canonicalProjectId();
  const itemId = tokenItemIds(projectId)[0];
  return itemId && !vault.isSealed() ? vault.decryptItem(projectId, itemId) ?? undefined : undefined;
}

export function updateCloudflareTunnelToken(action: CloudflareTokenAction, value?: string): CloudflareTokenResult {
  canonicalProjectId();
  const result = execTransaction(() => mutateCloudflareTunnelToken(action, value));
  if (!getDb().inTransaction) checkpointAfterWrite();
  return result;
}

export function validateCloudflareTunnelTokenOperation(action: CloudflareTokenAction, value?: string): CloudflareTokenResult["status"] {
  if (action === "preserve") return "ok";
  if (vault.isSealed()) return "vault_unavailable";
  if (action === "clear") return "ok";
  if (action !== "replace" || typeof value !== "string" || value.length < 32 || value.length > 4096
    || !/^[A-Za-z0-9._~-]+={0,2}$/.test(value)) return "invalid";
  return "ok";
}

function mutateCloudflareTunnelToken(action: CloudflareTokenAction, value?: string): CloudflareTokenResult {
  const projectId = canonicalProjectId();
  const configured = () => tokenItemIds(projectId).length > 0;
  const status = validateCloudflareTunnelTokenOperation(action, value);
  if (status !== "ok" || action === "preserve") return { status, configured: configured() };

  if (action === "replace") {
    const existing = tokenItemIds(projectId)[0];
    const itemId = existing ?? vault.createItem(projectId, TOKEN_ITEM_NAME, "api_key", value!);
    if (existing) vault.updateItem(projectId, existing, value!);
    if (!itemId || itemId === "Vault is sealed" || vault.decryptItem(projectId, itemId) !== value) {
      throw new Error("VAULT_REQUIRED");
    }
    for (const duplicate of tokenItemIds(projectId).filter((id) => id !== itemId)) vault.deleteItem(projectId, duplicate);
    if (tokenItemIds(projectId).length !== 1) throw new Error("VAULT_REQUIRED");
    return { status: "ok", configured: true };
  }

  if (action === "clear") {
    for (const itemId of tokenItemIds(projectId)) vault.deleteItem(projectId, itemId);
    if (configured()) throw new Error("VAULT_REQUIRED");
    return { status: "ok", configured: false };
  }

  return { status: "invalid", configured: configured() };
}
