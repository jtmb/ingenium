import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextFunction, Request, Response } from "express";
import { authorization, projects, securityAudit } from "ingenium-core";
import { assertAuthorizationPolicyCoverage, authorizationMiddleware, policyForRequest } from "../lib/authorization-policy.js";

describe("AUTH-102 canonical API policy", () => {
  it.each([
    ["GET", "/api/v1/tasks", "project", "read"],
    ["POST", "/api/v1/jobs/job/run", "project", "execute"],
    ["GET", "/api/v1/jobs/runs/run-id/logs", "installation", "read"],
    ["GET", "/api/v1/context/conversations", "private", "read"],
    ["GET", "/api/v1/emails/accounts", "private", "read"],
    ["POST", "/api/v1/vault/items/item/reveal", "project", "write"],
    ["POST", "/api/v1/vault/initialize", "installation", "admin"],
    ["PUT", "/api/v1/settings/provider-configs", "installation", "write"],
    ["POST", "/api/v1/opencode/integrations/openai/connect/key", "installation", "execute"],
    ["GET", "/api/v1/backups", "installation", "read"],
    ["GET", "/api/v1/runtimes", "installation", "read"],
    ["POST", "/api/v1/runtimes", "installation", "write"],
    ["GET", "/api/v1/runtimes/browser/status", "private", "read"],
    ["GET", "/api/v1/runtimes/browser/workspaces", "private", "read"],
    ["POST", "/api/v1/runtimes/browser/workspaces/workspace/start", "private", "write"],
    ["POST", "/api/v1/runtimes/browser/launch", "private", "write"],
    ["POST", "/api/v1/runtimes/gateway/exchange", "gateway-private", "execute"],
    ["POST", "/api/v1/runtimes/gateway/validate", "gateway-private", "execute"],
    ["POST", "/api/v1/runtimes/gateway/activity", "gateway-private", "execute"],
    ["POST", "/api/v1/runtimes/activity", "runtime-capability", "write"],
    ["GET", "/api/v1/mcp-tools/ingenium_skill_list/state", "project", "read"],
    ["POST", "/api/v1/synthesis/cross-project", "installation", "execute"],
    ["GET", "/api/v1/docs/spaces", "organization", "read"],
    ["DELETE", "/api/v1/projects/example/purge", "project", "admin"],
    ["GET", "/api/v1/auth/oidc/providers", "public", "read"],
  ] as const)("classifies %s %s", (method, path, target, permission) => {
    expect(policyForRequest({ method, path } as Pick<Request, "method" | "path">)).toMatchObject({ target, permission });
  });

  it("fails closed for a route without an explicit family policy", () => {
    expect(() => assertAuthorizationPolicyCoverage(["GET /api/v1/unregistered"])).toThrow("Missing authorization policy");
    const req = { method: "GET", path: "/api/v1/unregistered" } as Request;
    expect(() => authorizationMiddleware(req, {} as Response, vi.fn() as NextFunction)).toThrowError(expect.objectContaining({ code: "AUTHORIZATION_POLICY_MISSING", statusCode: 403 }));
  });

  it("covers every current REST registration", () => {
    const testDirectory = fileURLToPath(new URL(".", import.meta.url));
    const mountsSource = readFileSync(join(testDirectory, "../scripts/api-server.ts"), "utf8");
    const mounts = new Map([...mountsSource.matchAll(/app\.use\("([^"]+)",\s*(\w+)\)/g)].map((match) => [match[2], match[1]]));
    const routesDirectory = join(testDirectory, "../lib/routes");
    const missing: string[] = [];
    for (const file of readdirSync(routesDirectory).filter((name) => name.endsWith(".ts"))) {
      const source = readFileSync(join(routesDirectory, file), "utf8");
      for (const match of source.matchAll(/(\w+)\.(get|post|put|patch|delete)\(\s*"([^"]+)"/g)) {
        const mount = mounts.get(match[1]);
        if (!mount) continue;
        const path = `${mount}${match[3] === "/" ? "" : match[3]}`;
        if (!policyForRequest({ method: match[2].toUpperCase(), path } as Pick<Request, "method" | "path">)) missing.push(`${match[2].toUpperCase()} ${path}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it("preserves installation compatibility during cutover", () => {
    const req = {
      method: "DELETE",
      path: "/api/v1/backups/123",
      principal: { type: "compatibility", id: "legacy-server-bearer", scopes: ["legacy:*"] },
    } as unknown as Request;
    const next = vi.fn();
    vi.spyOn(securityAudit, "appendSecurityAuditEvent").mockReturnValue("audit-id");
    authorizationMiddleware(req, {} as Response, next);
    expect(next).toHaveBeenCalledOnce();
  });

  it.each(["exchange", "validate", "activity"])("allows the runtime gateway principal on its private %s contract", (operation) => {
    const req = {
      method: "POST",
      path: `/api/v1/runtimes/gateway/${operation}`,
      principal: {
        type: "runtime-service",
        id: "runtime-gateway",
        scopes: ["runtime-gateway:exchange"],
        audience: "runtime-gateway",
        network: "runtime-gateway",
      },
    } as unknown as Request;
    const next = vi.fn();
    vi.spyOn(securityAudit, "appendSecurityAuditEvent").mockReturnValue("audit-id");

    authorizationMiddleware(req, {} as Response, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it.each([
    ["browser user", { type: "user", id: "user-id", scopes: ["user:*"], session: { id: "session-id" } }],
    ["API user token", { type: "user", id: "user-id", scopes: ["runtimes:*"] }],
    ["compatibility installation", { type: "compatibility", id: "legacy-server-bearer", scopes: ["legacy:*"] }],
    ["installation service", { type: "service", id: "service-id", tokenId: "token-id", scopes: ["*"], organizationId: null, projectId: null }],
    ["forged runtime service", { type: "runtime-service", id: "runtime-gateway", scopes: ["runtime-gateway:exchange"], audience: "runtime-gateway", network: "browser-forged" }],
  ])("denies gateway-private routes to a %s principal", (_name, principal) => {
    const req = { method: "POST", path: "/api/v1/runtimes/gateway/validate", principal } as unknown as Request;
    const next = vi.fn();
    vi.spyOn(securityAudit, "appendSecurityAuditEvent").mockReturnValue("audit-id");

    expect(() => authorizationMiddleware(req, {} as Response, next)).toThrowError(expect.objectContaining({
      statusCode: 404,
      code: "NOT_FOUND",
    }));
    expect(next).not.toHaveBeenCalled();
  });

  it("allows only the exact runtime activity capability scope", () => {
    const principal = {
      type: "service",
      id: "service-id",
      tokenId: "credential-id",
      scopes: ["runtime:activity"],
      organizationId: "organization-id",
      projectId: "project-id",
      projectIds: ["project-id"],
      audience: "runtime",
      workspaceId: "workspace-id",
      launcherWorktree: "/workspace",
      storageMappingHash: "a".repeat(64),
    };
    const next = vi.fn();
    vi.spyOn(securityAudit, "appendSecurityAuditEvent").mockReturnValue("audit-id");

    authorizationMiddleware({
      method: "POST",
      path: "/api/v1/runtimes/activity",
      principal,
    } as unknown as Request, {} as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(() => authorizationMiddleware({
      method: "POST",
      path: "/api/v1/runtimes/activity",
      principal: { ...principal, scopes: ["child-mcp:runtime"] },
    } as unknown as Request, {} as Response, vi.fn())).toThrowError(expect.objectContaining({
      code: "NOT_FOUND",
      statusCode: 404,
    }));
  });

  it.each(["mcp", "repository-sync"] as const)("allows %s service credentials to run exact preflight", (audience) => {
    const req = {
      method: "GET",
      path: "/api/v1/auth/preflight",
      principal: {
        type: "service",
        id: "service-id",
        tokenId: "credential-id",
        scopes: ["projects:read"],
        organizationId: "organization-id",
        projectId: "project-id",
        projectIds: ["project-id"],
        audience,
        workspaceId: "workspace-id",
        launcherWorktree: "/workspace",
      },
    } as unknown as Request;
    const next = vi.fn();

    authorizationMiddleware(req, {} as Response, next);

    expect(next).toHaveBeenCalledOnce();
  });

  it("retains the immutable authorized project for post-auth coordination limiting", () => {
    const projectId = "11111111-1111-4111-8111-111111111111";
    vi.spyOn(projects, "getProject").mockReturnValue({
      id: projectId,
      name: "coordination-project",
      organization_id: "22222222-2222-4222-8222-222222222222",
      archived_at: null,
    } as ReturnType<typeof projects.getProject>);
    vi.spyOn(authorization, "requireProjectPermission").mockReturnValue({
      allowed: true,
      visible: true,
      projectId,
      organizationId: "22222222-2222-4222-8222-222222222222",
    });
    vi.spyOn(securityAudit, "appendSecurityAuditEvent").mockReturnValue("audit-id");
    const req = {
      method: "POST",
      path: "/api/v1/coordination/memory/read",
      query: { project: "coordination-project" },
      params: {},
      principal: {
        type: "service",
        id: "service-id",
        tokenId: "credential-id",
        scopes: ["coordination:read"],
        organizationId: "22222222-2222-4222-8222-222222222222",
        projectId,
        projectIds: [projectId],
        audience: "mcp",
        workspaceId: "workspace-id",
        launcherWorktree: "/workspace",
      },
    } as unknown as Request;
    const next = vi.fn();

    authorizationMiddleware(req, {} as Response, next);

    expect(next).toHaveBeenCalledOnce();
    expect(req.authorizedProjectId).toBe(projectId);
  });

});
