import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const api = {
  post: vi.fn(),
  patch: vi.fn(),
};

vi.mock("../lib/client.js", () => ({ api }));

const jobTools = await import("../lib/tools/jobs.js");
const serverSource = readFileSync(fileURLToPath(new URL("../scripts/mcp-server.ts", import.meta.url)), "utf8");
const catalogSource = readFileSync(fileURLToPath(new URL("../../../packages/ingenium-core/lib/tools/mcp-tool-catalog.ts", import.meta.url)), "utf8");

describe("VAULT-100 MCP job forwarding", () => {
  beforeEach(() => vi.clearAllMocks());

  it("forwards optional vault_item_ids, including explicit empty revocation lists", async () => {
    api.post.mockResolvedValue({ data: { data: { vault_references: [] } } });

    await jobTools.jobCreate("project", "job", undefined, "agent", "prompt", undefined, undefined, undefined, []);

    expect(api.post).toHaveBeenCalledWith(
      "/jobs",
      { name: "job", agent: "agent", prompt_template: "prompt", vault_item_ids: [] },
      { project: "project" },
    );
  });

  it("forwards generic job_update fields without resolving vault item metadata", async () => {
    api.patch.mockResolvedValue({ data: { data: { vault_references: [{ item_id: "id" }] } } });

    await jobTools.jobUpdate("project", "job-id", { vault_item_ids: [] });

    expect(api.patch).toHaveBeenCalledWith("/jobs/job-id", { vault_item_ids: [] }, { project: "project" });
  });

  it("keeps the existing two job tools while exposing strict UUID-list schema and parity documentation", () => {
    expect(serverSource).toMatch(/const jobVaultItemIdsParam = z\.array\(z\.string\(\)\.uuid\(\)\)\.max\(16\)/);
    expect(serverSource).toMatch(/"job_create"[\s\S]*?vault_item_ids: jobVaultItemIdsParam\.optional\(\)/);
    expect(serverSource).toMatch(/"job_update"[\s\S]*?fields: jobUpdateFieldsParam/);
    expect(serverSource.match(/server\.registerTool\(\s*"job_create"/g)).toHaveLength(1);
    expect(serverSource.match(/server\.registerTool\(\s*"job_update"/g)).toHaveLength(1);
    expect(catalogSource).toContain("metadata-only vault_item_ids authorization");
    expect(catalogSource).toContain("Omit vault_item_ids to preserve references; [] revokes all.");
  });
});
