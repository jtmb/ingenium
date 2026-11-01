export const OPENCODE_WEB_GATEWAY_URL = "http://opencode.localhost:3000/";
export const OPENCODE_CLI_GATEWAY_URL = "http://cli.localhost:3000/";

/** LAN compatibility roots remain separate browser origins and require their own host-only login. */
export function compatibilityGatewayUrl(audience: "web" | "cli"): string {
  if (audience !== "web" && audience !== "cli") throw new Error("Runtime audience is unavailable");
  const domain = (process.env.NEXT_PUBLIC_RUNTIME_ROOT_DOMAIN || "").trim().toLowerCase();
  if (typeof window !== "undefined" && window.location.protocol === "https:"
    && domain && /^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])$/.test(domain)
    && !domain.includes("..") && window.location.hostname === domain) {
    const host = audience === "web" ? "opencode" : "cli";
    return `https://${host}.${domain}/`;
  }
  return audience === "web" ? OPENCODE_WEB_GATEWAY_URL : OPENCODE_CLI_GATEWAY_URL;
}
