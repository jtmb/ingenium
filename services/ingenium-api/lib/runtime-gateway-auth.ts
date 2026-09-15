import { timingSafeEqual } from "node:crypto";
import { lstatSync, readFileSync, realpathSync } from "node:fs";
import type { IncomingHttpHeaders } from "node:http";

const FORGED_GATEWAY_HEADERS = new Set([
  "cookie", "origin", "x-csrf-token", "x-ingenium-audience", "x-ingenium-internal-service",
  "x-ingenium-private-network", "x-ingenium-runtime-gateway", "x-ingenium-ui",
]);

export function loadRuntimeGatewayToken(): string {
  const path = process.env.INGENIUM_RUNTIME_GATEWAY_TOKEN_FILE?.trim();
  if (!path) throw new Error("Runtime gateway authentication is not configured");
  const stat = lstatSync(path);
  const uid = typeof process.getuid === "function" ? process.getuid() : stat.uid;
  if (!stat.isFile() || stat.isSymbolicLink() || stat.uid !== uid || (stat.mode & 0o077) !== 0 || realpathSync(path) !== path) {
    throw new Error("Runtime gateway token file is unsafe");
  }
  const token = readFileSync(path, "utf8").trim();
  if (!/^[A-Za-z0-9_-]{43,128}$/.test(token)) throw new Error("Runtime gateway token is invalid");
  return token;
}

export function runtimeGatewayTokensEqual(provided: string, expected = loadRuntimeGatewayToken()): boolean {
  const left = Buffer.from(provided);
  const right = Buffer.from(expected);
  return left.length === right.length && timingSafeEqual(left, right);
}

export function runtimeGatewayIngressHeaders(headers: IncomingHttpHeaders): IncomingHttpHeaders {
  const result: IncomingHttpHeaders = {};
  for (const [name, value] of Object.entries(headers)) {
    if (!FORGED_GATEWAY_HEADERS.has(name.toLowerCase()) && value !== undefined) result[name] = value;
  }
  result["x-ingenium-audience"] = "runtime-gateway";
  result["x-ingenium-private-network"] = "runtime-gateway";
  return result;
}
