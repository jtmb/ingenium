import { afterEach, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { join } from "node:path";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { randomUUID } from "node:crypto";
import { getDb, projects, resetDbForTest } from "ingenium-core";
import { projectsRouter } from "../lib/routes/projects.js";

let tempDir = "";
let server: Server | undefined;
const originalDbPath = process.env.INGENIUM_CORE_DB_PATH;
const originalHome = process.env.INGENIUM_HOME;

afterEach(async () => {
  if (server) await new Promise<void>((resolve) => server!.close(() => resolve()));
  server = undefined;
  resetDbForTest();
  if (tempDir) rmSync(tempDir, { recursive: true, force: true });
  tempDir = "";
  if (originalDbPath === undefined) delete process.env.INGENIUM_CORE_DB_PATH;
  else process.env.INGENIUM_CORE_DB_PATH = originalDbPath;
  if (originalHome === undefined) delete process.env.INGENIUM_HOME;
  else process.env.INGENIUM_HOME = originalHome;
});

describe("project purge route", () => {
  it("returns a typed conflict instead of a 500 for referenced projects", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "ingenium-project-route-"));
    process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "data.db");
    process.env.INGENIUM_HOME = join(tempDir, "home");
    const project = projects.createProject("referenced-project");
    const now = new Date().toISOString();
    getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      "INSERT INTO tasks (id, project_id, title, created_at, updated_at) VALUES (?, ?, ?, ?, ?)",
    ).run(randomUUID(), project.id, "child", now, now);

    const app = express();
    app.use(express.json());
    app.use("/projects", projectsRouter);
    server = createServer(app);
    const baseUrl = await new Promise<string>((resolve) => {
      server!.listen(0, "127.0.0.1", () => {
        resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`);
      });
    });

    const response = await fetch(`${baseUrl}/projects/referenced-project/purge`, { method: "DELETE" });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "PROJECT_HAS_CHILDREN",
        message: "Project has referenced data and cannot be permanently deleted",
        details: { child_tables: ["tasks"] },
      },
    });
  });
});

describe("project route validation", () => {
  async function startRouter(): Promise<string> {
    const app = express();
    app.use(express.json());
    app.use("/projects", projectsRouter);
    server = createServer(app);
    return await new Promise<string>((resolve) => {
      server!.listen(0, "127.0.0.1", () => resolve(`http://127.0.0.1:${(server!.address() as AddressInfo).port}`));
    });
  }

  it.each(["", " ", "a/b", ".", "..", "bad\u0000name"])("returns 422 for invalid project names on create: %j", async (name) => {
    const baseUrl = await startRouter();
    const response = await fetch(`${baseUrl}/projects`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name }) });
    expect(response.status).toBe(422);
    await expect(response.json()).resolves.toMatchObject({ error: { code: "VALIDATION_ERROR" } });
  });

  it("returns 422 when either project name in a rename is invalid", async () => {
    const baseUrl = await startRouter();
    const response = await fetch(`${baseUrl}/projects/good-name`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "../bad" }) });
    expect(response.status).toBe(422);
  });

  it("returns 422 for encoded invalid purge names", async () => {
    const baseUrl = await startRouter();
    const response = await fetch(`${baseUrl}/projects/%20/purge`, { method: "DELETE" });
    expect(response.status).toBe(422);
  });

  it("returns 409 when duplicate create requests target the same project", async () => {
    tempDir = mkdtempSync(join(tmpdir(), "ingenium-project-route-"));
    process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "data.db");
    process.env.INGENIUM_HOME = join(tempDir, "home");
    const baseUrl = await startRouter();
    const request = () => fetch(`${baseUrl}/projects`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: "duplicate" }) });
    const [first, second] = await Promise.all([request(), request()]);
    expect([first.status, second.status].sort()).toEqual([201, 409]);
  });
});
