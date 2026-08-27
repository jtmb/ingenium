import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import express from "express";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { getDb, projects, resetDbForTest } from "ingenium-core";
import { router as docsRouter } from "../lib/routes/docs.js";
import { closeHttpServer, listenOnLoopback } from "./http-fixtures.js";

const directory = mkdtempSync(join(tmpdir(), "ingenium-repository-docs-api-"));
const projectName = "repository-docs-api";
let server: Server;
let baseUrl: string;

function file(path: string, content: string) {
  return {
    path,
    content,
    sha256: createHash("sha256").update(content).digest("hex"),
    fileType: "regular" as const,
    isSymlink: false as const,
  };
}

async function request(body: unknown, project = projectName): Promise<{ status: number; body: any }> {
  const response = await fetch(`${baseUrl}/api/v1/docs/repository/sync?project=${encodeURIComponent(project)}`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  });
  return { status: response.status, body: await response.json() };
}

beforeAll(async () => {
  process.env.INGENIUM_HOME = join(directory, "ingenium-home");
  process.env.INGENIUM_CORE_DB_PATH = join(directory, "data.db");
  resetDbForTest();
  projects.createProject(projectName);

  const app = express();
  app.use(express.json({ limit: "2mb" }));
  app.use("/api/v1/docs", docsRouter);
  server = createServer(app);
  baseUrl = await listenOnLoopback(server);
});

afterAll(async () => {
  await closeHttpServer(server);
  resetDbForTest();
  delete process.env.INGENIUM_CORE_DB_PATH;
  delete process.env.INGENIUM_HOME;
  rmSync(directory, { recursive: true, force: true });
});

describe("repository Docs sync API", () => {
  it("denies unclaimed and stale legacy callers without mutating documentation rows", async () => {
    const manifest = { files: [file("docs/index.md", "# API Docs\n\nThe indigo lighthouse.")] };
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH!);
    const before = db.prepare("SELECT COUNT(*) AS count FROM docs_repository_pages").get() as { count: number };
    for (const payload of [
      { manifest, dryRun: false },
      { manifest, dryRun: false, expectedGeneration: 0, claim: { accepted_epoch: 1, fence: 0 } },
    ]) {
      const response = await request(payload);
      expect(response).toEqual({
        status: 409,
        body: {
          error: {
            code: "REPOSITORY_SYNC_COORDINATION_REQUIRED",
            message: "Use the coordinated repository synchronization endpoint",
          },
        },
      });
    }
    expect(db.prepare("SELECT COUNT(*) AS count FROM docs_repository_pages").get()).toEqual(before);
  });
});
