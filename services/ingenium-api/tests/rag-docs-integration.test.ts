import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { docs, projects } from "ingenium-core";
import { authorizationMiddleware } from "../lib/authorization-policy.js";
import { errorHandler } from "../lib/middleware/errors.js";
import { router as docsRouter } from "../lib/routes/docs.js";
import { ragRouter } from "../lib/routes/rag.js";
import { closeHttpServer, listenOnLoopback } from "./http-fixtures.js";

const tempDir = mkdtempSync(join(tmpdir(), "ingenium-rag-docs-"));
process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "data.db");

let server: Server;
let baseUrl: string;
const projectName = "rag-docs-integration";
const otherProjectName = "rag-docs-other";
let pageId: number;

beforeAll(async () => {
  const project = projects.createProject(projectName);
  projects.createProject(otherProjectName);
  projects.createProject("global-default", true);
  const space = docs.createSpace("RAG Docs", "rag-docs");
  const page = docs.createPage(space.id, "Indexed Page", "indexed-page", "The lighthouse verification color is amber.");
  if (!page.page) throw new Error("Failed to create Docs test page");
  pageId = page.page.id;
  docs.publishPage(page.page.id, page.page.revision);

  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => {
    const principal = req.get("x-test-principal");
    req.principal = principal
      ? {
          type: "service",
          id: principal,
          tokenId: `${principal}-token`,
          scopes: principal === "scout"
            ? ["projects:read", "documentation:read", "rag:read"]
            : ["projects:read", "rag:read"],
          organizationId: project.organization_id,
          projectId: project.id,
          projectIds: [project.id],
          audience: "mcp",
        }
      : { type: "compatibility", id: "legacy-server-bearer", scopes: ["legacy:*"] };
    next();
  });
  app.use(authorizationMiddleware);
  app.use("/api/v1/rag", ragRouter);
  app.use("/api/v1/docs", docsRouter);
  app.use(errorHandler);
  server = createServer(app);
  baseUrl = await listenOnLoopback(server);
});

afterAll(async () => {
  await closeHttpServer(server);
  delete process.env.INGENIUM_CORE_DB_PATH;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Docs RAG integration", () => {
  it("indexes published Docs pages at publication time", async () => {
    const response = await fetch(`${baseUrl}/api/v1/rag/search?project=${projectName}&q=lighthouse`);
    expect(response.status).toBe(200);
    expect((await response.json()).data[0]).toEqual(expect.objectContaining({ source_title: "Indexed Page", source_path: "docs-page:1" }));
  });

  it("returns the indexed Docs page through full-text search", async () => {
    const response = await fetch(`${baseUrl}/api/v1/rag/search?project=${projectName}&q=lighthouse`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0]).toEqual(expect.objectContaining({ source_title: "Indexed Page" }));
    expect(body.data[0].score).toBeGreaterThan(0);
  });

  it("allows the project-bound scout to search and retrieve Docs pages", async () => {
    const headers = { "X-Test-Principal": "scout" };
    const semantic = await fetch(`${baseUrl}/api/v1/rag/search?project=${projectName}&q=lighthouse`, { headers });
    const search = await fetch(`${baseUrl}/api/v1/docs/search?project=${projectName}&q=lighthouse`, { headers });
    const page = await fetch(`${baseUrl}/api/v1/docs/pages/${pageId}?project=${projectName}`, { headers });

    expect(semantic.status).toBe(200);
    expect(search.status).toBe(200);
    expect(page.status).toBe(200);
    expect((await page.json()).data.id).toBe(pageId);
  });

  it.each(["global-default", otherProjectName])("hides Docs reads for ungranted project %s", async (project) => {
    const response = await fetch(`${baseUrl}/api/v1/docs/search?project=${project}&q=lighthouse`, {
      headers: { "X-Test-Principal": "scout" },
    });

    expect(response.status).toBe(404);
    expect((await response.json()).error.code).toBe("NOT_FOUND");
  });

  it("does not extend Docs mutation or unrelated-principal access", async () => {
    const mutation = await fetch(`${baseUrl}/api/v1/docs/pages/${pageId}?project=${projectName}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", "X-Test-Principal": "scout" },
      body: JSON.stringify({ title: "Denied" }),
    });
    const unrelated = await fetch(`${baseUrl}/api/v1/docs/search?project=${projectName}&q=lighthouse`, {
      headers: { "X-Test-Principal": "unrelated" },
    });

    expect(mutation.status).toBe(403);
    expect((await mutation.json()).error.code).toBe("FORBIDDEN");
    expect(unrelated.status).toBe(403);
    expect((await unrelated.json()).error.code).toBe("FORBIDDEN");
  });
});
