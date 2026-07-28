import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { projects, resetDbForTest } from "ingenium-core";
import { repositoryRouter } from "../lib/routes/repository.js";

const directory = mkdtempSync(join(tmpdir(), "ingenium-repository-resources-api-"));
const projectName = "repository-resources-api";
let server: Server;
let baseUrl: string;

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
  projects.createProject(projectName);
  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/v1/repository", repositoryRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => server.listen(0, "127.0.0.1", () => {
    baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    resolve();
  }));
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  resetDbForTest();
  delete process.env.INGENIUM_HOME;
  delete process.env.INGENIUM_CORE_DB_PATH;
  rmSync(directory, { recursive: true, force: true });
});

describe("repository resources sync API", () => {
  it("provides deterministic dry-run/apply summaries without returning source payloads", async () => {
    const preview = await request({ manifest: manifest(), dryRun: true });
    expect(preview.status).toBe(200);
    expect(preview.body.data).toMatchObject({ dryRun: true, summary: { skill: { created: 1 }, agent: { created: 1 }, plugin: { created: 1 } } });

    const applied = await request({ manifest: manifest(), dryRun: false });
    expect(applied.status).toBe(200);
    expect(applied.body.data).toMatchObject({ dryRun: false, summary: { skill: { created: 1 }, agent: { created: 1 }, plugin: { created: 1 } } });
    expect(JSON.stringify(applied.body)).not.toContain("export {};");

    const repeated = await request({ manifest: manifest(), dryRun: true });
    expect(repeated.body.data.summary).toMatchObject({ skill: { unchanged: 1 }, agent: { unchanged: 1 }, plugin: { unchanged: 1 } });
  });

  it("rejects malformed and broker manifests with a generic response", async () => {
    const invalid = await request({ manifest: { version: 2, skills: [], agents: [], plugins: [], commands: [] } });
    expect(invalid).toEqual({
      status: 422,
      body: { error: { code: "INVALID_REPOSITORY_RESOURCES_MANIFEST", message: "Repository resource manifest is invalid" } },
    });

    const protectedManifest = manifest();
    protectedManifest.agents[0]!.name = "ingenium-llm-broker";
    const protectedResponse = await request({ manifest: protectedManifest });
    expect(protectedResponse.status).toBe(422);
    expect(protectedResponse.body.error.code).toBe("INVALID_REPOSITORY_RESOURCES_MANIFEST");
  });

  it("rejects unsafe plugin sources and secret-like option keys with the generic contract", async () => {
    const unsafeSource = manifest();
    unsafeSource.plugins[0]!.path = ".env/plugin.ts";
    const unsafeSourceResponse = await request({ manifest: unsafeSource });
    expect(unsafeSourceResponse).toEqual({
      status: 422,
      body: { error: { code: "INVALID_REPOSITORY_RESOURCES_MANIFEST", message: "Repository resource manifest is invalid" } },
    });

    const secretOptionsManifest = manifest();
    secretOptionsManifest.plugins[0] = entry("plugin:api", {
      path: ".opencode/plugins/api-plugin.ts", name: "api-plugin", source: "export {};\n", fileType: "regular", isSymlink: false,
      enabled: true, order: 0, options: { apiKey: "do-not-persist" },
    });
    const secretOptionsResponse = await request({ manifest: secretOptionsManifest });
    expect(secretOptionsResponse).toEqual({
      status: 422,
      body: { error: { code: "INVALID_REPOSITORY_RESOURCES_MANIFEST", message: "Repository resource manifest is invalid" } },
    });
  });
});
