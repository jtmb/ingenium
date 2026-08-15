import type { RequestPrincipal } from "../lib/middleware/auth.js";

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
