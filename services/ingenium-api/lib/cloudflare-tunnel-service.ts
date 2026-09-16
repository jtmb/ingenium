import { cloudflareTunnel, safeEndpointFetch } from "ingenium-core";
import { randomUUID } from "node:crypto";
import { closeSync, constants, fchmodSync, fsyncSync, lstatSync, openSync, renameSync, unlinkSync, writeSync } from "node:fs";
import {
  getCloudflareConnectorStatus,
  startCloudflareConnector,
  stopCloudflareConnector,
  type CloudflareConnectorStatus,
} from "./cloudflare-connector.js";
import { loadCloudflareTrustedIngress } from "./cloudflare-trusted-ingress.js";

export type CloudflareAuthReadiness = "ready" | "missing" | "vault_sealed";
export type CloudflareRouteHealth = "disabled" | "blocked" | "unavailable" | "unknown" | "reachable";

export interface CloudflareTunnelStatus {
  desired: { enabled: boolean; configuration: "valid" | "invalid" };
  inventory: { status: "ready" | "missing" | "invalid"; error: string | null };
  config: cloudflareTunnel.CloudflareTunnelConfig;
  token: { configured: boolean; readiness: CloudflareAuthReadiness };
  connector: CloudflareConnectorStatus;
  routes: Array<{
    service: cloudflareTunnel.CloudflareServiceId;
    enabled: boolean;
    publicUrl: string;
    target: string;
    availableOrigins: string[];
    health: CloudflareRouteHealth;
  }>;
}

const CLOUDFLARE_CREDENTIAL_HANDOFF_FILE = "/run/ingenium-secrets/api/cloudflare-tunnel.handoff";

function credentialHandoffPath(): string {
  return process.env.NODE_ENV === "test" && process.env.INGENIUM_CLOUDFLARE_CREDENTIAL_HANDOFF_FILE
    ? process.env.INGENIUM_CLOUDFLARE_CREDENTIAL_HANDOFF_FILE
    : CLOUDFLARE_CREDENTIAL_HANDOFF_FILE;
}

function removeCredentialHandoff(path = credentialHandoffPath()): void {
  try {
    const metadata = lstatSync(path);
    if (!metadata.isFile() || metadata.isSymbolicLink()
      || (typeof process.getuid === "function" && metadata.uid !== process.getuid())) {
      throw new Error("Cloudflare credential handoff path is unsafe");
    }
    unlinkSync(path);
  } catch (error) {
    if ((error as NodeJS.ErrnoException).code !== "ENOENT") throw error;
  }
}

function materializeCredentialHandoff(value: string): void {
  const path = credentialHandoffPath();
  const temporary = `${path}.${randomUUID()}`;
  let descriptor: number | undefined;
  try {
    descriptor = openSync(temporary, constants.O_CREAT | constants.O_EXCL | constants.O_WRONLY | constants.O_NOFOLLOW, 0o600);
    writeSync(descriptor, `${value}\n`, undefined, "utf8");
    fchmodSync(descriptor, 0o600);
    fsyncSync(descriptor);
    closeSync(descriptor);
    descriptor = undefined;
    removeCredentialHandoff(path);
    renameSync(temporary, path);
  } catch (error) {
    if (descriptor !== undefined) closeSync(descriptor);
    removeCredentialHandoff(temporary);
    throw error;
  }
}

function authReadiness(configured: boolean, vaultSealed: boolean): CloudflareAuthReadiness {
  if (!configured) return "missing";
  return vaultSealed ? "vault_sealed" : "ready";
}

async function routeHealth(
  enabled: boolean,
  configEnabled: boolean,
  readiness: CloudflareAuthReadiness,
  connector: CloudflareConnectorStatus,
  publicUrl: string,
): Promise<CloudflareRouteHealth> {
  if (!enabled) return "disabled";
  if (!configEnabled || readiness !== "ready") return "blocked";
  if (connector.state !== "running") return "unavailable";
  try {
    const response = await safeEndpointFetch(publicUrl, {
      method: "HEAD",
      credentials: "omit",
      redirect: "error",
    }, {
      allowPrivateNetwork: false,
      allowedProtocols: ["https:"],
      allowedPorts: [443],
      rejectIpLiterals: true,
      requireDnsHostname: true,
      rejectFragments: true,
      rejectTrailingDot: true,
      maxRedirects: 0,
      // HEAD can advertise the document's Content-Length despite having no body.
      maxResponseBodyBytes: 1_048_576,
      timeoutMs: 3_000,
    });
    // An auth challenge proves reachability, not an authenticated backend session.
    return response.ok || response.status === 401 || response.status === 403 ? "reachable" : "unavailable";
  } catch {
    return "unavailable";
  }
}

export async function getCloudflareTunnelStatus(): Promise<CloudflareTunnelStatus> {
  const inventory = loadCloudflareTrustedIngress();
  const stored = cloudflareTunnel.getCloudflareTunnelConfig(inventory.status === "ready" ? inventory.inventory : undefined);
  const tokenMetadata = cloudflareTunnel.getCloudflareTunnelTokenMetadata();
  const connector = await getCloudflareConnectorStatus();
  const readiness = authReadiness(tokenMetadata.configured, tokenMetadata.vaultSealed);
  const config = inventory.status === "ready" && !stored.config.tunnelName
    ? { ...stored.config, tunnelName: inventory.inventory.tunnelName }
    : stored.config;
  return {
    desired: {
      enabled: stored.config.enabled,
      configuration: stored.status === "ok" && inventory.status === "ready" ? "valid" : "invalid",
    },
    inventory: { status: inventory.status, error: inventory.status === "ready" ? null : inventory.error },
    config,
    token: { configured: tokenMetadata.configured, readiness },
    connector,
    routes: await Promise.all(cloudflareTunnel.CLOUDFLARE_SERVICE_IDS.map(async (service) => ({
      service,
      ...config.services[service],
      target: cloudflareTunnel.CLOUDFLARE_SERVICE_TARGETS[service],
      availableOrigins: inventory.status === "ready"
        ? inventory.inventory.routes[service].map(({ publicUrl }) => publicUrl)
        : [],
      health: stored.status === "invalid" || inventory.status !== "ready"
        ? "blocked" as const
        : await routeHealth(config.services[service].enabled, config.enabled, readiness, connector, config.services[service].publicUrl),
    }))),
  };
}

export async function connectCloudflareTunnel(): Promise<CloudflareTunnelStatus> {
  const before = await getCloudflareTunnelStatus();
  if (before.desired.configuration !== "valid") throw new Error("CLOUDFLARE_CONFIG_INVALID");
  if (!before.desired.enabled) throw new Error("CLOUDFLARE_CONFIG_DISABLED");
  if (before.inventory.status !== "ready") throw new Error("CLOUDFLARE_ROUTES_UNAVAILABLE");
  if (before.token.readiness !== "ready") throw new Error("CLOUDFLARE_AUTH_NOT_READY");
  const credential = cloudflareTunnel.getCloudflareTunnelToken();
  if (!credential) throw new Error("CLOUDFLARE_AUTH_NOT_READY");
  materializeCredentialHandoff(credential);
  try {
    await startCloudflareConnector();
  } finally {
    removeCredentialHandoff();
  }
  return getCloudflareTunnelStatus();
}

export async function disconnectCloudflareTunnel(): Promise<CloudflareTunnelStatus> {
  try {
    await stopCloudflareConnector();
  } finally {
    removeCredentialHandoff();
  }
  return getCloudflareTunnelStatus();
}

export function validateCloudflareTunnelConfig(value: unknown) {
  const inventory = loadCloudflareTrustedIngress();
  if (inventory.status !== "ready") return { ok: false as const, error: inventory.error };
  return cloudflareTunnel.validateCloudflareTunnelConfig(value, inventory.inventory);
}

export async function saveCloudflareTunnelConfig(
  value: unknown,
  token: { action: cloudflareTunnel.CloudflareTokenAction; value?: string } = { action: "preserve" },
): Promise<cloudflareTunnel.CloudflareTunnelConfig> {
  const inventory = loadCloudflareTrustedIngress();
  if (inventory.status !== "ready") throw new Error("CLOUDFLARE_ROUTES_UNAVAILABLE");
  const validation = cloudflareTunnel.validateCloudflareTunnelConfig(value, inventory.inventory);
  if (!validation.ok) throw new Error("CLOUDFLARE_CONFIG_INVALID");
  const tokenStatus = cloudflareTunnel.validateCloudflareTunnelTokenOperation(token.action, token.value);
  if (tokenStatus !== "ok") throw new Error(tokenStatus === "invalid" ? "CLOUDFLARE_TOKEN_INVALID" : "VAULT_REQUIRED");
  // Runtime failures must happen before the atomic settings/vault commit.
  if (!validation.config.enabled) {
    const connector = await getCloudflareConnectorStatus();
    if (connector.state === "running" || connector.state === "starting") await stopCloudflareConnector();
    removeCredentialHandoff();
  }
  return cloudflareTunnel.saveCloudflareTunnelConfig(validation.config, inventory.inventory, token);
}
