import { describe, expect, it, vi } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import type { NextFunction, Request, Response } from "express";
import { securityAudit } from "ingenium-core";
import { assertAuthorizationPolicyCoverage, authorizationMiddleware, policyForRequest } from "../lib/authorization-policy.js";

describe("AUTH-102 canonical API policy", () => {
  it.each([
    ["GET", "/api/v1/tasks", "project", "read"],
    ["POST", "/api/v1/jobs/job/run", "project", "execute"],
    ["GET", "/api/v1/jobs/runs/run-id/logs", "installation", "read"],
    ["GET", "/api/v1/context/conversations", "project", "read"],
    ["GET", "/api/v1/emails/accounts", "project", "read"],
    ["POST", "/api/v1/vault/items/item/reveal", "project", "write"],
    ["PUT", "/api/v1/settings/provider-configs", "installation", "write"],
    ["POST", "/api/v1/opencode/integrations/openai/connect/key", "installation", "execute"],
    ["GET", "/api/v1/backups", "installation", "read"],
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

});
