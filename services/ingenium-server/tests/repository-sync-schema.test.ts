import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { z } from "zod";
import { REPOSITORY_MAX_DOC_FILE_BYTES } from "../lib/tools/repository.js";

it("bounds document characters while accepting the retained roadmap in the strict MCP schema", () => {
  const source = readFileSync(new URL("../scripts/mcp-server.ts", import.meta.url), "utf8");
  const start = source.indexOf("const repositoryDocEntryParam =");
  const end = source.indexOf("const repositoryResourcesManifestParam =", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  const schema = runInNewContext(`${source.slice(start, end)}\nrepositoryDocsManifestParam`, {
    z, REPOSITORY_MAX_DOC_FILE_BYTES,
  }) as z.ZodType;
  const entry = { path: "docs/reference/ROADMAP.md", sha256: "a".repeat(64), content: "", fileType: "regular", isSymlink: false };
  for (const content of ["x".repeat(805_779 - 802) + "é".repeat(802), "x".repeat(1024 * 1024)]) {
    expect(schema.safeParse({ files: [{ ...entry, content }] }).success).toBe(true);
  }
  expect(schema.safeParse({ files: [{ ...entry, content: "x".repeat(1024 * 1024 + 1) }] }).success).toBe(false);
  expect(schema.safeParse({ files: Array.from({ length: 256 }, () => entry) }).success).toBe(true);
  expect(schema.safeParse({ files: Array.from({ length: 257 }, () => entry) }).success).toBe(false);
  for (const invalid of [{ path: "" }, { path: "x".repeat(513) }, { content: 1 }, { fileType: "directory" }, { isSymlink: true }, { extra: true }]) {
    expect(schema.safeParse({ files: [{ ...entry, ...invalid }] }).success).toBe(false);
  }
});

it("bounds commands individually and together with existing resources in the strict MCP schema", () => {
  const source = readFileSync(new URL("../scripts/mcp-server.ts", import.meta.url), "utf8");
  const start = source.indexOf("const repositoryResourcesManifestParam =");
  const end = source.indexOf("const jobVaultItemIdsParam", start);
  expect(start).toBeGreaterThan(-1);
  expect(end).toBeGreaterThan(start);
  // Evaluate only this declaration, without starting the MCP server on import.
  const schema = runInNewContext(`${source.slice(start, end)}\nrepositoryResourcesManifestParam`, { z }) as z.ZodType;
  const legacy = { version: 2, skills: [], agents: [], plugins: [] };
  const full = { ...legacy, commands: Array.from({ length: 512 }, () => ({})) };
  expect(schema.safeParse(legacy).success).toBe(true);
  expect(schema.safeParse(full).success).toBe(true);
  expect(schema.safeParse({ ...full, commands: [...full.commands, {}] }).success).toBe(false);
  for (const kind of ["skills", "agents", "plugins"]) {
    expect(schema.safeParse({ ...full, [kind]: [{}] }).success).toBe(false);
  }
  expect(schema.safeParse({ ...legacy, commands: "invalid" }).success).toBe(false);
  expect(schema.safeParse({ ...legacy, config: {} }).success).toBe(false);
});
