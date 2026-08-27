import { Request, Response, NextFunction } from "express";
import { AppError } from "./errors.js";
import { apiTokensEqual, loadApiToken } from "./api-token.js";
import { authentication, mcpCredentials, securityTokens } from "ingenium-core";
import { loadRuntimeGatewayToken, runtimeGatewayTokensEqual } from "../runtime-gateway-auth.js";

export type RequestPrincipal =
  | { type: "compatibility"; id: "legacy-server-bearer"; scopes: readonly ["legacy:*"] }
  | { type: "user"; id: string; scopes: readonly string[]; session?: authentication.AuthSession; tokenId?: string; organizationId?: string | null; projectId?: string | null }
  | { type: "service"; id: string; scopes: readonly string[]; tokenId: string; organizationId: string | null; projectId: string | null; projectIds?: readonly string[]; audience?: mcpCredentials.McpCredentialAudience; workspaceId?: string; launcherWorktree?: string; storageMappingHash?: string }
  | { type: "runtime-service"; id: "runtime-gateway"; scopes: readonly ["runtime-gateway:exchange"]; audience: "runtime-gateway"; network: "runtime-gateway" };

export interface AttestedCoordinationIdentity {
  credentialId: string;
  workspaceId: string;
  storageMappingHash: string;
}

export const RUNTIME_GATEWAY_AUDIENCE = "runtime-gateway";
export const RUNTIME_GATEWAY_NETWORK_HEADER = "x-ingenium-private-network";
export const RUNTIME_GATEWAY_NETWORK_VALUE = "runtime-gateway";

export function isRuntimeGatewayPrivateRequest(req: Pick<Request, "method" | "path">): boolean {
  return req.method === "POST" && /^\/api\/v1\/runtimes\/gateway\/(exchange|validate|activity)$/.test(req.path);
}

declare global {
  namespace Express {
    interface Request {
      principal?: RequestPrincipal;
      attestedCoordinationIdentity?: Readonly<AttestedCoordinationIdentity>;
    }
  }
}

/**
 * The sole unauthenticated API route is the OAuth provider redirect. It must
 * remain an exact GET match: query parameters carry the provider state, while
 * all management endpoints (including health) require a Bearer token.
 */
export function isPublicOAuthCallbackRequest(req: Request): boolean {
  return req.method === "GET" && req.path === "/auth/callback";
}

const PUBLIC_LOCAL_AUTH = new Set([
  "GET /api/v1/auth/csrf",
  "POST /api/v1/auth/login",
  "POST /api/v1/auth/mfa/challenge",
  "POST /api/v1/auth/password/forgot",
  "POST /api/v1/auth/password/reset",
  "POST /api/v1/auth/email/verify",
  "GET /api/v1/auth/invitations/preview",
  "GET /api/v1/auth/oidc/providers",
  "POST /api/v1/auth/oidc/start",
  "GET /api/v1/auth/oidc/callback",
]);

export function isPublicLocalAuthRequest(req: Request): boolean {
  return PUBLIC_LOCAL_AUTH.has(`${req.method} ${req.path}`);
}

export function isPublicHealthRequest(req: Request): boolean {
  return req.method === "GET" && req.path === "/api/v1/health";
}

function cookieValue(req: Request, name: string): string | undefined {
  const header = req.headers.cookie;
  if (!header) return undefined;
  for (const part of header.split(";")) {
    const [key, ...value] = part.trim().split("=");
    if (key === name) return decodeURIComponent(value.join("="));
  }
  return undefined;
}

/**
 * Token-based authentication for every API management request.
 *
 * INGENIUM_API_TOKEN is mandatory in normal operation. A missing server token
 * is a deployment error, never a development-mode bypass. The OAuth callback
 * is the narrowly scoped exception because an OAuth provider cannot attach the
 * local API credential to its browser redirect.
 *
 * Placement in the middleware chain matters: auth sits AFTER rate limiting so
 * brute-force attempts are throttled before the constant-time comparison runs.
 * 401 vs 403 distinguishes "missing/invalid header" from "wrong token provided".
 *
 * 🔴 Token loading and comparison are centralized in api-token.ts so runtime-file
 * and inline configuration have the same strength and timing-safe guarantees.
 */
export function authMiddleware(req: Request, _res: Response, next: NextFunction): void {
  if (isPublicOAuthCallbackRequest(req) || isPublicLocalAuthRequest(req) || isPublicHealthRequest(req)) {
    next();
    return;
  }

  const authHeader = req.headers.authorization;
  if (req.path.startsWith("/api/v1/runtimes/gateway/")) {
    if (!isRuntimeGatewayPrivateRequest(req)
      || req.get("x-ingenium-audience") !== RUNTIME_GATEWAY_AUDIENCE
      || req.get(RUNTIME_GATEWAY_NETWORK_HEADER) !== RUNTIME_GATEWAY_NETWORK_VALUE
      || req.headers.cookie !== undefined
      || req.get("origin") !== undefined) {
      throw new AppError("Resource not found", "NOT_FOUND", 404);
    }
    let gatewayToken: string;
    try {
      gatewayToken = loadRuntimeGatewayToken();
    } catch {
      throw new AppError("Runtime gateway authentication is not configured", "API_AUTH_NOT_CONFIGURED", 503);
    }
    if (!authHeader?.startsWith("Bearer ") || !runtimeGatewayTokensEqual(authHeader.slice(7), gatewayToken)) {
      throw new AppError("Resource not found", "NOT_FOUND", 404);
    }
    req.principal = {
      type: "runtime-service",
      id: "runtime-gateway",
      scopes: ["runtime-gateway:exchange"],
      audience: RUNTIME_GATEWAY_AUDIENCE,
      network: RUNTIME_GATEWAY_NETWORK_VALUE,
    };
    next();
    return;
  }

  const sessionToken = cookieValue(req, authentication.SESSION_COOKIE_NAME);
  if (!authHeader && sessionToken) {
    const session = authentication.resolveSession(sessionToken, new Date(), true);
    if (!session) throw new AppError("Authentication is required", "UNAUTHORIZED", 401);
    req.principal = { type: "user", id: session.user_id, scopes: ["user:*"], session };
    next();
    return;
  }

  if (isInternalInstallationRequest(req)) {
    let installationToken: string;
    try {
      installationToken = loadApiToken();
    } catch {
      throw new AppError("API authentication is not configured", "API_AUTH_NOT_CONFIGURED", 503);
    }
    if (!authHeader?.startsWith("Bearer ") || !apiTokensEqual(authHeader.slice(7), installationToken)) {
      throw new AppError("Invalid authorization token", "INVALID_TOKEN", 401);
    }
    req.principal = { type: "compatibility", id: "legacy-server-bearer", scopes: ["legacy:*"] };
    next();
    return;
  }

  if (authHeader?.startsWith("Bearer ing_") && req.get("x-ingenium-audience")) {
    const audience = req.get("x-ingenium-audience");
    if (audience !== "mcp" && audience !== "runtime" && audience !== "repository-sync") {
      throw new AppError("Invalid bearer token", "INVALID_TOKEN", 401);
    }
    if (req.get("x-ingenium-storage-mapping-hash") !== undefined) {
      throw new AppError("Resource not found", "NOT_FOUND", 404);
    }
    const resolved = mcpCredentials.resolveMcpCredential(authHeader.slice(7), audience);
    if (!resolved) throw new AppError("Invalid bearer token", "INVALID_TOKEN", 401);
    const launcherWorktree = audience === "runtime" ? "/workspace" : resolved.launcherWorktree;
    if (req.get("x-ingenium-workspace") !== resolved.workspaceId || req.get("x-ingenium-launcher-worktree") !== launcherWorktree) {
      throw new AppError("Resource not found", "NOT_FOUND", 404);
    }
    req.principal = {
      type: "service",
      id: resolved.servicePrincipalId,
      scopes: resolved.scopes,
      tokenId: resolved.id,
      organizationId: resolved.organizationId,
      projectId: resolved.projectId,
      projectIds: resolved.projectIds,
      audience: resolved.audience,
      workspaceId: resolved.workspaceId,
      launcherWorktree,
      storageMappingHash: resolved.storageMappingHash,
    };
    if (audience === "mcp" || audience === "runtime") {
      req.attestedCoordinationIdentity = Object.freeze({
        credentialId: resolved.id,
        workspaceId: resolved.workspaceId,
        storageMappingHash: resolved.storageMappingHash,
      });
    }
    next();
    return;
  }
  if (authHeader?.startsWith("Bearer ing_")) {
    const resolved = securityTokens.resolveScopedApiToken(authHeader.slice(7));
    if (!resolved) throw new AppError("Invalid bearer token", "INVALID_TOKEN", 401);
    req.principal = resolved.userId
      ? { type: "user", id: resolved.userId, scopes: resolved.scopes, tokenId: resolved.id, organizationId: resolved.organizationId, projectId: resolved.projectId }
      : { type: "service", id: resolved.servicePrincipalId!, scopes: resolved.scopes, tokenId: resolved.id, organizationId: resolved.organizationId, projectId: resolved.projectId };
    next();
    return;
  }
  let token: string;
  try {
    token = loadApiToken();
  } catch {
    throw new AppError("API authentication is not configured", "API_AUTH_NOT_CONFIGURED", 503);
  }

  if (!authHeader || !authHeader.startsWith("Bearer ")) {
    throw new AppError("Missing or invalid authorization header", "UNAUTHORIZED", 401);
  }

  const provided = authHeader.slice(7);
  if (!apiTokensEqual(provided, token)) throw new AppError("Invalid authorization token", "INVALID_TOKEN", 401);

  throw new AppError("Invalid authorization token", "INVALID_TOKEN", 401);
}

function isInternalInstallationRequest(req: Request): boolean {
  return req.get("x-ingenium-internal-service") === "1";
}
