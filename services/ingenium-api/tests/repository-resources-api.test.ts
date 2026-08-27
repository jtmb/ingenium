import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import express from "express";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { coordination, getDb, projects, resetDbForTest } from "ingenium-core";
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
    (req as any).principal = { kind: "service", ...binding };
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
  it("denies unclaimed and stale legacy callers without mutating repository rows", async () => {
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
            code: "REPOSITORY_SYNC_COORDINATION_REQUIRED",
            message: "Use the coordinated repository synchronization endpoint",
          },
        },
      });
    }
    expect(db.prepare("SELECT COUNT(*) AS count FROM skills WHERE project_id = ?").get(projectId)).toEqual(before);
  });

  it("atomically applies one claimed generation and rejects its stale replay", async () => {
    const worktreeId = coordination.coordinationWorktreeId(binding.workspaceId, binding.storageMappingHash);
    const ownershipToken = "A".repeat(32);
    const registered = coordination.registerCoordinationSession(projectId, {
      worktreeId, sessionId: "repository-sync-session", incarnation: 1, ownershipToken,
      ttlMs: 300_000, idempotencyKey: "repository-sync-register",
    });
    const clientClaimKey = "B".repeat(32);
    const claimed = coordination.claimCoordinationBatch(projectId, {
      worktreeId, sessionId: "repository-sync-session", incarnation: 1,
      expectedRevision: registered.revision, fence: registered.fence, ownershipToken,
      idempotencyKey: "repository-sync-claim", clientClaimKey, operation: "repository",
      claims: [{ claim: { kind: "reserved", name: "@repository" } }],
    });
    const claim = {
      worktree_id: worktreeId,
      session_id: "repository-sync-session",
      incarnation: 1,
      expected_revision: claimed.session.revision,
      fence: claimed.session.fence,
      ownership_token: ownershipToken,
      client_claim_key: clientClaimKey,
      accepted_epoch: claimed.acceptedEpoch,
    };
    const body = { docsManifest: { files: [] }, resourcesManifest: { version: 2, skills: [], agents: [], plugins: [] }, dryRun: false, expectedGeneration: 0, claim };
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
    expect((await stale.json()).error.code).toBe("MANIFEST_GENERATION_CONFLICT");
  });
});
