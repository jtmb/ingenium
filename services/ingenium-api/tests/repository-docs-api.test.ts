import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createHash } from "node:crypto";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { docs, getDb, projects, resetDbForTest } from "ingenium-core";
import { router as docsRouter } from "../lib/routes/docs.js";

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
  await new Promise<void>((resolve) => {
    server.listen(0, "127.0.0.1", () => {
      baseUrl = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
      resolve();
    });
  });
});

afterAll(async () => {
  await new Promise<void>((resolve) => server.close(() => resolve()));
  resetDbForTest();
  delete process.env.INGENIUM_CORE_DB_PATH;
  delete process.env.INGENIUM_HOME;
  rmSync(directory, { recursive: true, force: true });
});

describe("repository Docs sync API", () => {
  it("provides an idempotent dry-run/apply contract without returning markdown content", async () => {
    const manifest = { files: [file("docs/index.md", "# API Docs\n\nThe indigo lighthouse.")] };
    const preview = await request({ manifest, dryRun: true });
    expect(preview.status).toBe(200);
    expect(preview.body.data).toMatchObject({ dryRun: true, summary: { created: 1, ragCreated: 1 } });
    expect(preview.body.data.space).toEqual({
      action: "created",
      name: projectName,
      slug: `repository-${projectName}`,
    });

    const applied = await request({ manifest, dryRun: false });
    expect(applied.status).toBe(200);
    expect(applied.body.data).toMatchObject({ dryRun: false, summary: { created: 1 } });
    expect(JSON.stringify(applied.body)).not.toContain("The indigo lighthouse");

    const repeated = await request({ manifest, dryRun: true });
    expect(repeated.status).toBe(200);
    expect(repeated.body.data.summary).toMatchObject({ unchanged: 1, created: 0 });
  });

  it("returns a generic validation response for unsafe paths, hash mismatch, and likely secrets", async () => {
    const rawSecret = "token: sk_abcdefghijklmnopqrstuvwxyz123456";
    const invalids = [
      { manifest: { files: [{ ...file("docs/index.md", "# Good"), path: "docs/../secret.md" }] } },
      { manifest: { files: [{ ...file("docs/index.md", "# Good"), sha256: "0".repeat(64) }] } },
      { manifest: { files: [file("docs/secrets.md", rawSecret)] } },
    ];

    for (const payload of invalids) {
      const response = await request(payload);
      expect(response.status).toBe(422);
      expect(response.body).toEqual({
        error: { code: "INVALID_REPOSITORY_DOCS_MANIFEST", message: "Repository documentation manifest is invalid" },
      });
    expect(JSON.stringify(response.body)).not.toContain(rawSecret);
    }
  });

  it("discloses a UUID-space repair on dry-run, applies it, and has zero repeat drift", async () => {
    const repairProject = "repository-docs-api-repair";
    const project = projects.createProject(repairProject);
    const manifest = { files: [file("docs/index.md", "# API repair\n\nThe saffron lighthouse.")] };
    const initial = await request({ manifest }, repairProject);
    expect(initial.status).toBe(200);

    const db = getDb(process.env.INGENIUM_CORE_DB_PATH!);
    const identity = db.prepare(
      `SELECT p.id AS page_id, p.space_id, p.revision, rp.rag_source_id
       FROM docs_repository_pages rp
       INNER JOIN docs_pages p ON p.id = rp.page_id
       WHERE rp.project_id = ?`,
    ).get(project.id) as { page_id: number; space_id: number; revision: number; rag_source_id: string };
    db.prepare("UPDATE docs_spaces SET name = ?, slug = ? WHERE id = ?")
      .run(`Repository Docs ${project.id}`, `repository-${project.id}`, identity.space_id);

    const preview = await request({ manifest, dryRun: true }, repairProject);
    expect(preview.status).toBe(200);
    expect(preview.body.data).toMatchObject({
      dryRun: true,
      summary: { spaceRepaired: 1, updated: 0 },
      space: {
        action: "repaired",
        id: identity.space_id,
        name: repairProject,
        slug: `repository-${repairProject}`,
      },
    });
    expect(db.prepare("SELECT name, slug FROM docs_spaces WHERE id = ?").get(identity.space_id)).toEqual({
      name: `Repository Docs ${project.id}`,
      slug: `repository-${project.id}`,
    });

    const applied = await request({ manifest, dryRun: false }, repairProject);
    expect(applied.status).toBe(200);
    expect(applied.body.data).toMatchObject({
      summary: { spaceRepaired: 1, updated: 0 },
      space: { action: "repaired", id: identity.space_id },
    });
    expect(db.prepare("SELECT name, slug FROM docs_spaces WHERE id = ?").get(identity.space_id)).toEqual({
      name: repairProject,
      slug: `repository-${repairProject}`,
    });
    expect(db.prepare(
      `SELECT p.id AS page_id, p.space_id, p.revision, rp.rag_source_id
       FROM docs_repository_pages rp
       INNER JOIN docs_pages p ON p.id = rp.page_id
       WHERE rp.project_id = ?`,
    ).get(project.id)).toEqual(identity);

    const repeated = await request({ manifest, dryRun: false }, repairProject);
    expect(repeated.status).toBe(200);
    expect(repeated.body.data).toMatchObject({
      summary: { spaceCreated: 0, spaceRepaired: 0, unchanged: 1 },
      space: { action: "unchanged", id: identity.space_id },
    });
  });

  it("returns a conflict instead of overwriting a manual canonical space", async () => {
    const collisionProject = "repository-docs-api-collision";
    projects.createProject(collisionProject);
    const manual = docs.createSpace(collisionProject, `manual-${collisionProject}`);
    const response = await request({
      manifest: { files: [file("docs/index.md", "# Collision\n\nNo overwrite.")] },
    }, collisionProject);

    expect(response).toEqual({
      status: 409,
      body: {
        error: {
          code: "REPOSITORY_DOCS_SPACE_CONFLICT",
          message: "Repository documentation space conflicts with an existing space",
        },
      },
    });
    expect(getDb(process.env.INGENIUM_CORE_DB_PATH!).prepare("SELECT name, slug FROM docs_spaces WHERE id = ?").get(manual.id)).toEqual({
      name: collisionProject,
      slug: `manual-${collisionProject}`,
    });
  });
});
