import type { Server } from "node:http";
import type { AddressInfo } from "node:net";
import type { RequestPrincipal } from "../lib/middleware/auth.js";

export async function listenOnLoopback(server: Server): Promise<string> {
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
}

export async function closeHttpServer(server: Server): Promise<void> {
  await new Promise<void>((resolve) => server.close(() => resolve()));
}

export function compatibilityAuthHeaders(
  token: string,
  headers: Record<string, string> = {},
): Record<string, string> {
  return {
    ...headers,
    Authorization: `Bearer ${token}`,
    "x-ingenium-internal-service": "1",
  };
}

export function runtimeServicePrincipal(projectId: string): RequestPrincipal {
  return {
    type: "service",
    id: "fixture-runtime-service",
    scopes: ["child-mcp:runtime"],
    tokenId: "fixture-runtime-token",
    organizationId: null,
    projectId,
    audience: "runtime",
  };
}
