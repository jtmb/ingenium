import { closeSync, constants, fstatSync, openSync, readFileSync } from "node:fs";
import { cloudflareTunnel } from "ingenium-core";

export const CLOUDFLARE_TRUSTED_INGRESS_FILE = "/etc/ingenium/cloudflare-routes.json";

export type CloudflareTrustedIngressRead =
  | { status: "ready"; inventory: cloudflareTunnel.CloudflareTrustedIngressInventory }
  | { status: "missing" | "invalid"; error: string };

const RUNTIME_AUDIENCES = { opencode: "web", cli: "cli", vscode: "vscode" } as const;
export type CloudflareRuntimeAudience = (typeof RUNTIME_AUDIENCES)[keyof typeof RUNTIME_AUDIENCES];

export function cloudflareIngressForHost(
  host: string | undefined,
  ingress = loadCloudflareTrustedIngress(),
): { service: cloudflareTunnel.CloudflareServiceId; origin: string; audience?: CloudflareRuntimeAudience } | undefined {
  if (!host || ingress.status !== "ready") return undefined;
  for (const service of cloudflareTunnel.CLOUDFLARE_SERVICE_IDS) {
    for (const route of ingress.inventory.routes[service]) {
      const url = new URL(route.publicUrl);
      if (url.host !== host.toLowerCase()) continue;
      return {
        service,
        origin: url.origin,
        ...(service in RUNTIME_AUDIENCES ? { audience: RUNTIME_AUDIENCES[service as keyof typeof RUNTIME_AUDIENCES] } : {}),
      };
    }
  }
  return undefined;
}

export function cloudflareLauncherOriginAllowed(origin: string, audience?: CloudflareRuntimeAudience): boolean {
  let url: URL;
  try { url = new URL(origin); } catch { return false; }
  if (url.origin !== origin) return false;
  const route = cloudflareIngressForHost(url.host);
  return route?.origin === origin && (route.service === "dashboard" || (audience !== undefined && route.audience === audience));
}

function configuredPath(environment: NodeJS.ProcessEnv): string {
  return environment.NODE_ENV === "test" && environment.INGENIUM_CLOUDFLARE_ROUTES_FILE
    ? environment.INGENIUM_CLOUDFLARE_ROUTES_FILE
    : CLOUDFLARE_TRUSTED_INGRESS_FILE;
}

export function loadCloudflareTrustedIngress(
  environment: NodeJS.ProcessEnv = process.env,
): CloudflareTrustedIngressRead {
  let descriptor: number | undefined;
  try {
    descriptor = openSync(configuredPath(environment), constants.O_RDONLY | constants.O_NOFOLLOW);
    const metadata = fstatSync(descriptor);
    if (!metadata.isFile() || metadata.size < 2) {
      return { status: "missing", error: "Trusted Cloudflare ingress inventory is not configured" };
    }
    if (metadata.size > 64 * 1024 || (metadata.mode & 0o022) !== 0) {
      return { status: "invalid", error: "Trusted Cloudflare ingress inventory is invalid" };
    }
    const result = cloudflareTunnel.validateCloudflareTrustedIngressInventory(
      JSON.parse(readFileSync(descriptor, "utf8")),
    );
    return result.ok
      ? { status: "ready", inventory: result.inventory }
      : { status: "invalid", error: result.error };
  } catch (error) {
    return (error as NodeJS.ErrnoException).code === "ENOENT"
      ? { status: "missing", error: "Trusted Cloudflare ingress inventory is not configured" }
      : { status: "invalid", error: "Trusted Cloudflare ingress inventory is unreadable" };
  } finally {
    if (descriptor !== undefined) closeSync(descriptor);
  }
}
