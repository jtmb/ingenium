import { readFileSync } from "node:fs";
import { runInNewContext } from "node:vm";
import { expect, it } from "vitest";
import { z } from "zod";

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
