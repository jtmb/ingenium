import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync, readFileSync, lstatSync, writeFileSync, symlinkSync, unlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import express from "express";
import { beforeAll, afterAll, beforeEach, describe, it, expect } from "vitest";
import * as core from "ingenium-core";
import { migrationRouter, parseMigrationInput } from "../lib/routes/migration.js";
import { errorHandler } from "../lib/middleware/errors.js";
let root: string, server: Server, base: string;
let principals: Record<string, Express.Request["principal"]>;
const input = (revision = 0, origin = "https://prd.example.com", confirmed: string[] = []) => ({ expectedRevision: revision, target: { platform: "kubernetes", origin }, confirmed });
beforeAll(async () => {
  root = mkdtempSync(join(tmpdir(), "ingenium-prd-migration-"));
  process.env.INGENIUM_CORE_DB_PATH = join(root, "data"); process.env.NODE_ENV = "test";
  core.projects.createProject("global-default", true);
  const admin = core.identity.createUser("migration-admin@example.test", "Migration Admin");
  const other = core.identity.createUser("migration-other@example.test", "Other");
  core.getDb().prepare("INSERT INTO installation_admins (user_id, created_at) VALUES (?, ?)").run(admin.id, new Date().toISOString());
  principals = {
    admin: { type: "user", id: admin.id, scopes: ["user:*"], session: core.authentication.createSession(admin.id, new Date(), "migration", true).session },
    stale: { type: "user", id: admin.id, scopes: ["user:*"], session: core.authentication.createSession(admin.id).session },
    other: { type: "user", id: other.id, scopes: ["user:*"], session: core.authentication.createSession(other.id).session },
    bearer: { type: "compatibility", id: "legacy-server-bearer", scopes: ["legacy:*"] },
  };
  const app = express(); app.use(express.json()); app.use((req, _res, next) => { req.principal = principals[String(req.headers["x-test-principal"])]; next(); });
  app.use("/api/v1/services/migration", migrationRouter); app.use(errorHandler);
  server = createServer(app); await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as AddressInfo).port}/api/v1/services/migration`;
});
beforeEach(() => { try { unlinkSync(join(root, "prd-migration-plan.json")); } catch {} });
afterAll(async () => { await new Promise<void>((resolve) => server.close(() => resolve())); core.resetDbForTest(); rmSync(root, { recursive: true, force: true }); delete process.env.INGENIUM_CORE_DB_PATH; });
async function call(method = "GET", body?: unknown, principal = "admin") {
  return fetch(base, { method, headers: { "Content-Type": "application/json", "x-test-principal": principal }, body: body === undefined ? undefined : JSON.stringify(body) });
}
describe("whole-installation PRD preparation", () => {
  it.each(["other", "bearer", "missing"])("refuses %s access", async (principal) => { expect((await call("GET", undefined, principal)).status).toBe(403); });
  it("requires recent administrator verification for writes", async () => { expect((await call("PUT", input(), "stale")).status).toBe(403); });
  it("persists a revisioned plan, clears attestations on target changes and rejects lost updates", async () => {
    expect((await call("PUT", input(0, "https://prd.example.com", ["storage"]))).status).toBe(200);
    let data = (await (await call()).json()).data;
    expect(data.plan.confirmed).toEqual([]); expect(data.plan.revision).toBe(1);
    expect(lstatSync(join(root, "prd-migration-plan.json")).mode & 0o777).toBe(0o600);
    expect((await call("PUT", input(1, "https://prd.example.com", ["storage", "models"]))).status).toBe(200);
    expect((await call("PUT", input(1))).status).toBe(409);
    expect((await call("PUT", input(2, "https://new.example.com", ["storage"]))).status).toBe(200);
    data = (await (await call()).json()).data;
    expect(data.plan.confirmed).toEqual([]); expect(data.inventory.automaticTransferSupported).toBe(false); expect(data.inventory.cutoverPerformed).toBe(false);
    expect(data.inventory.requiredTransfers.map((item: { id: string }) => item.id)).toEqual(["ingenium-data", "opencode-config", "opencode-data", "workspace", "bootstrap", "optional"]);
    expect(data.inventory.backup).toBeNull();
  });
  it.each(["http://prd.example.com", "https://user:secret@prd.example.com", "https://prd.example.com/path", "https://prd.example.com/?token=secret", "https://localhost"])("rejects unsafe target %s", async (origin) => { expect((await call("PUT", input(0, origin))).status).toBe(422); });
  it("rejects commands, unknown confirmation IDs and extra keys", () => {
    expect(parseMigrationInput({ ...input(), command: "ssh remote" })).toBeNull();
    expect(parseMigrationInput(input(0, "https://prd.example.com", ["cutover"]))).toBeNull();
    expect(parseMigrationInput(input(0, "https://prd.example.com", ["storage", "storage"]))).toBeNull();
  });
  it("fails closed on a symlink without altering its target", async () => {
    const target = join(root, "protected"); writeFileSync(target, "preserve me", { mode: 0o600 }); symlinkSync(target, join(root, "prd-migration-plan.json"));
    expect((await call()).status).toBe(409); expect((await call("PUT", input())).status).toBe(409);
    expect(readFileSync(target, "utf8")).toBe("preserve me");
  });
});
