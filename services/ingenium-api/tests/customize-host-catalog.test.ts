import express from "express";
import type { Server } from "node:http";
import { mkdtempSync, realpathSync, writeFileSync, readdirSync, lstatSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative, isAbsolute } from "node:path";
import { beforeAll, afterAll, describe, expect, it, vi } from "vitest";
import { authentication, identity, organizations, projects, skills, getDb, resetDbForTest } from "ingenium-core";
import { authMiddleware } from "../lib/middleware/auth.js";
import { authorizationMiddleware } from "../lib/authorization-policy.js";
import { csrfMiddleware } from "../lib/middleware/csrf.js";
import { errorHandler } from "../lib/middleware/errors.js";
import { createHostedCustomizeRouter } from "../lib/routes/customize.js";

let directory = "", parent = "", origin = "", cookie = "", outsiderCookie = "";
let project: ReturnType<typeof projects.createProject>, system: ReturnType<typeof projects.createProject>;
let server: Server;
beforeAll(async () => {
  parent = realpathSync(tmpdir()); directory = mkdtempSync(join(parent, "veyra-hosted-catalog-"));
  vi.stubEnv("INGENIUM_HOME", directory); vi.stubEnv("INGENIUM_GLOBAL_CONFIG_PATH", join(directory, "global"));
  vi.stubEnv("INGENIUM_CORE_DB_PATH", join(directory, "data")); vi.stubEnv("INGENIUM_API_TOKEN", "f".repeat(64));
  const key = join(directory, "fixture-key"); writeFileSync(key, Buffer.alloc(32, 21).toString("base64url"), { mode: 0o600 });
  vi.stubEnv("INGENIUM_AUTH_ENCRYPTION_KEY_FILE", key); resetDbForTest();
  project = projects.createProject("catalog-host-fixture");
  system = projects.ensureGlobalProject();
  if (!system) throw new Error("Real installation resource namespace absent");
  const owner = identity.createUser("catalog-owner@example.test", "Catalog owner");
  const outsider = identity.createUser("catalog-outsider@example.test", "Catalog outsider");
  organizations.addOrganizationMember(project.organization_id, owner.id, "admin");
  if (system.organization_id !== project.organization_id) organizations.addOrganizationMember(system.organization_id, owner.id, "admin");
  cookie = authentication.SESSION_COOKIE_NAME + "=" + authentication.createSession(owner.id).token;
  outsiderCookie = authentication.SESSION_COOKIE_NAME + "=" + authentication.createSession(outsider.id).token;
  skills.createSkill(project.id, "catalog-disabled", "Fixture disabled skill", "Fixture source"); skills.disableSkill(project.id, "catalog-disabled");
  skills.createSkill(system.id, "catalog-system", "Fixture System skill", "System fixture source");
  const app = express(); app.use(express.json()); app.use(authMiddleware); app.use(csrfMiddleware); app.use(authorizationMiddleware);
  app.use("/api/v1/customize", createHostedCustomizeRouter()); app.use(errorHandler);
  server = await new Promise<Server>(resolve => { const listening = app.listen(0, "127.0.0.1", () => resolve(listening)); });
  origin = "http://127.0.0.1:" + (server.address() as { port: number }).port;
});
afterAll(async () => {
  if (server) { server.closeAllConnections(); await new Promise<void>(resolve => server.close(() => resolve())); }
  resetDbForTest(); vi.unstubAllEnvs();
  if (!directory) return;
  const inside = relative(parent, realpathSync(directory));
  if (!inside.startsWith("veyra-hosted-catalog-") || isAbsolute(inside) || inside.startsWith("..")) throw new Error("Fixture cleanup containment failed");
  const measure = (target: string): number => { const stat = lstatSync(target); if (stat.isSymbolicLink() || (!stat.isFile() && !stat.isDirectory()) || stat.isFile() && stat.nlink !== 1) throw new Error("Fixture preservation failed"); return stat.blocks * 512 + (stat.isDirectory() ? readdirSync(target).reduce((sum, item) => sum + measure(join(target, item)), 0) : 0); };
  const bytes = measure(directory); rmSync(directory, { recursive: true });
  console.log(JSON.stringify({ cleanup: "removed-owned-catalog-fixture", path: directory, allocatedBytes: bytes, regeneration: "customize-host-catalog.test.ts", databaseClosed: true, httpServerClosed: true }));
});
const get = (projectName: string, visibility = "project", credential = cookie) => fetch(origin + "/api/v1/customize?" + new URLSearchParams({ project: projectName, kind: "skill", visibility }), { headers: credential ? { Cookie: credential } : {} });

describe("hosted catalog authentication and installed membership", () => {
  it("returns disabled membership without changing active skill selection or exposing source content", async () => {
    expect(skills.listSkills(project.id).some(row => row.name === "catalog-disabled")).toBe(false);
    const response = await get(project.name); expect(response.status).toBe(200);
    const body = await response.json(); expect(body.scope.projectId).toBe(project.id);
    expect(body.data).toContainEqual(expect.objectContaining({ name: "catalog-disabled", installed: true, enabled: false }));
    expect(JSON.stringify(body)).not.toContain("Fixture source");
    expect(skills.listSkills(project.id).some(row => row.name === "catalog-disabled")).toBe(false);
  });
  it("allows System only in its actual authorized installation namespace", async () => {
    expect((await get(project.name, "system")).status).toBe(403);
    const response = await get(system.name, "system"); expect(response.status).toBe(200);
    expect((await response.json()).data).toContainEqual(expect.objectContaining({ name: "catalog-system", installed: true, visibility: "system" }));
  });
  it("denies unauthenticated and unrelated users with real session and project checks", async () => {
    expect((await get(project.name, "project", "")).status).toBe(401);
    expect((await get(project.name, "project", outsiderCookie)).status).toBe(404);
  });
  it("exposes no writable catalog route and keeps the resource revision unchanged", async () => {
    const before = skills.getSkill(project.id, "catalog-disabled")!.revision;
    const response = await fetch(origin + "/api/v1/customize?" + new URLSearchParams({ project: project.name }), { method: "POST", headers: { Cookie: cookie, "Content-Type": "application/json" }, body: JSON.stringify({ kind: "skill", action: "activate" }) });
    expect(response.ok).toBe(false); expect(skills.getSkill(project.id, "catalog-disabled")!.revision).toBe(before);
    expect(getDb().pragma("foreign_key_check")).toEqual([]);
  });
});