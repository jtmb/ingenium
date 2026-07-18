import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import type { AddressInfo } from "node:net";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { docs, projects } from "ingenium-core";
import { ragRouter } from "../lib/routes/rag.js";

const tempDir = mkdtempSync(join(tmpdir(), "ingenium-rag-docs-"));
process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "data.db");

let server: Server;
let baseUrl: string;
const projectName = "rag-docs-integration";

beforeAll(async () => {
  projects.createProject(projectName);
  projects.createProject("global-default", true);
  const space = docs.createSpace("RAG Docs", "rag-docs");
  const page = docs.createPage(space.id, "Indexed Page", "indexed-page", "The lighthouse verification color is amber.");
  if (!page.page) throw new Error("Failed to create Docs test page");
  docs.publishPage(page.page.id, page.page.revision);

  const app = express();
  app.use(express.json());
  app.use("/api/v1/rag", ragRouter);
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
  delete process.env.INGENIUM_CORE_DB_PATH;
  rmSync(tempDir, { recursive: true, force: true });
});

describe("Docs RAG integration", () => {
  it("indexes published Docs pages at publication time", async () => {
    const response = await fetch(`${baseUrl}/api/v1/rag/search?project=${projectName}&q=lighthouse`);
    expect(response.status).toBe(200);
    expect((await response.json()).data[0]).toEqual(expect.objectContaining({ source_title: "Indexed Page", source_path: "docs-page:1" }));
  });

  it("returns the indexed Docs page through hybrid search", async () => {
    const response = await fetch(`${baseUrl}/api/v1/rag/search?project=${projectName}&q=lighthouse`);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data[0]).toEqual(expect.objectContaining({ source_title: "Indexed Page" }));
    expect(body.data[0].score).toBeGreaterThan(0);
  });
});
