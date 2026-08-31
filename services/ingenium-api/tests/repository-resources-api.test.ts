import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import express from "express";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, projects, resetDbForTest } from "ingenium-core";
import { repositoryRouter } from "../lib/routes/repository.js";
import { errorHandler } from "../lib/middleware/errors.js";
import { closeHttpServer, listenOnLoopback } from "./http-fixtures.js";

const directory = mkdtempSync(join(tmpdir(), "ingenium-repository-resources-api-"));
const projectName = "repository-resources-api";
let server: Server;
let baseUrl: string;
let projectId: string;
const binding = {
  workspaceId: "repository-api-workspace",
  launcherWorktree: "/fixtures/repository-api",
  storageMappingHash: createHash("sha256").update("repository-api-binding").digest("hex"),
};

function stable(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(stable).join(",")}]`;
  if (value !== null && typeof value === "object") {
    const record = value as Record<string, unknown>;
    return `{${Object.keys(record).sort().map((key) => `${JSON.stringify(key)}:${stable(record[key])}`).join(",")}}`;
  }
  return JSON.stringify(value) ?? "null";
}

function entry<T extends Record<string, unknown>>(identity: string, semantic: T): T & { identity: string; sha256: string } {
  return { identity, sha256: createHash("sha256").update(stable(semantic)).digest("hex"), ...semantic };
}

function manifest() {
  const skill = entry("skill:api", {
    path: ".opencode/skills/api-skill/SKILL.md", name: "api-skill",
    skillMd: "---\nname: api-skill\ndescription: \"API\"\n---\n\nBody\n", body: "Body\n", description: "API",
    category: "workflow", tags: ["api"], alwaysApply: false, metadata: { tags: ["api"] }, fileTree: {},
  });
  const agent = entry("agent:api", {
    path: ".opencode/agents/chat/api-agent.md", name: "api-agent", category: "chat",
    frontmatter: "name: api-agent\ndescription: \"API agent\"", body: "Body\n", description: "API agent", mode: "subagent",
    permissions: { read: "allow" }, metadata: { hidden: true }, skills: [], mirrors: [], enabled: true,
  });
  const plugin = entry("plugin:api", {
    path: ".opencode/plugins/api-plugin.ts", name: "api-plugin", source: "export {};\n", fileType: "regular", isSymlink: false, enabled: true, order: 0, options: {},
  });
  return { version: 2, skills: [skill], agents: [agent], plugins: [plugin] };
}

async function request(body: unknown): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}/api/v1/repository/resources/sync?project=${projectName}`, {
    method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  process.env.INGENIUM_HOME = join(directory, "home");
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  resetDbForTest();
  projectId = projects.createProject(projectName).id;
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use((req, _res, next) => {
    (req as any).principal = {
      type: "service",
      id: "repository-sync-principal",
      scopes: ["projects:read", "repository:sync"],
      tokenId: "repository-sync-token",
      organizationId: "repository-sync-organization",
      projectId: req.get("x-test-wrong-project") === "1" ? "wrong-project" : projectId,
      projectIds: [projectId],
      audience: "repository-sync",
      ...binding,
    };
    next();
  });
  app.use("/api/v1/repository", repositoryRouter);
  app.use(errorHandler);
  server = createServer(app);
  baseUrl = await listenOnLoopback(server);
});

afterAll(async () => {
  await closeHttpServer(server);
  resetDbForTest();
  delete process.env.INGENIUM_HOME;
  delete process.env.INGENIUM_CORE_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

describe("repository resources sync API", () => {
  it("denies the legacy split endpoint without mutating repository rows", async () => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH!);
    const before = db.prepare("SELECT COUNT(*) AS count FROM skills WHERE project_id = ?").get(projectId);
    for (const payload of [
      { manifest: manifest(), dryRun: false },
      { manifest: manifest(), dryRun: false, expectedGeneration: 0, claim: { accepted_epoch: 1, fence: 0 } },
    ]) {
      expect(await request(payload)).toEqual({
        status: 409,
        body: {
          error: {
            code: "REPOSITORY_SYNC_ENDPOINT_REQUIRED",
            message: "Use the repository synchronization endpoint",
          },
        },
      });
    }
    expect(db.prepare("SELECT COUNT(*) AS count FROM skills WHERE project_id = ?").get(projectId)).toEqual(before);
  });

  it("atomically applies one principal-bound generation and returns its bounded stale generation", async () => {
    const body = { docsManifest: { files: [] }, resourcesManifest: { version: 2, skills: [], agents: [], plugins: [] }, dryRun: false, expectedGeneration: 0 };
    const response = await fetch(`${baseUrl}/api/v1/repository/sync?project=${projectName}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    const applied = await response.json();
    expect(response.status, JSON.stringify(applied)).toBe(200);
    expect(applied.data).toMatchObject({ dryRun: false, generation: 1, manifestHash: expect.stringMatching(/^[0-9a-f]{64}$/) });

    const stale = await fetch(`${baseUrl}/api/v1/repository/sync?project=${projectName}`, {
      method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body),
    });
    expect(stale.status).toBe(409);
    expect((await stale.json()).error).toMatchObject({ code: "MANIFEST_GENERATION_CONFLICT", currentGeneration: 1 });
  });

  it("rejects a repository-sync principal bound to another project", async () => {
    const response = await fetch(`${baseUrl}/api/v1/repository/sync?project=${projectName}`, {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-test-wrong-project": "1" },
      body: JSON.stringify({ docsManifest: { files: [] }, dryRun: true, expectedGeneration: 0 }),
    });

    expect(response.status).toBe(404);
    expect(await response.json()).toEqual({ error: { code: "NOT_FOUND", message: "Resource not found" } });
  });
});
