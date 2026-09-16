import { beforeEach, describe, expect, it, vi } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const mockApi = {
  del: vi.fn(),
  get: vi.fn(),
  post: vi.fn(),
  patch: vi.fn(),
};

vi.mock("../lib/client.js", () => ({ api: mockApi }));

const projectTools = await import("../lib/tools/projects.js");

function responseBody(result: { content: Array<{ text: string }> }): unknown {
  return JSON.parse(result.content[0]!.text);
}

describe("project lifecycle MCP adapters", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it("forwards global initialization and ownership changes", async () => {
    const response = { name: "external-project", is_global: true };
    mockApi.post.mockResolvedValue({ status: 200, data: response });
    mockApi.patch.mockResolvedValue({ status: 200, data: response });

    const initialized = await projectTools.projectInit("external-project", true);
    expect(mockApi.post).toHaveBeenCalledWith("/projects", {
      name: "external-project",
      is_global: true,
    });
    expect(responseBody(initialized)).toEqual(response);

    const changed = await projectTools.projectSetGlobal(
      "external-project",
      "external-project",
      true,
    );
    expect(mockApi.patch).toHaveBeenCalledWith(
      "/projects/external-project/global",
      { is_global: true },
      { project: "external-project" },
    );
    expect(responseBody(changed)).toEqual(response);
  });

  it("encodes archive and restore project path segments without weakening project names", async () => {
    const name = "project ? # % name";
    mockApi.del.mockResolvedValue({ status: 204, data: null });
    mockApi.post.mockResolvedValue({ ok: true, data: { restored: true } });

    const deleted = await projectTools.projectDelete(name);
    const restored = await projectTools.projectRestore("caller-project", name);

    expect(mockApi.del).toHaveBeenCalledWith(`/projects/${encodeURIComponent(name)}`);
    expect(responseBody(deleted)).toEqual({ deleted: true });
    expect(mockApi.post).toHaveBeenCalledWith(
      `/projects/${encodeURIComponent(name)}/restore`,
      {},
      { project: "caller-project" },
    );
    expect(responseBody(restored)).toEqual({ restored: true });
  });

  it("uses a finite bounded retention schema before forwarding purge requests", () => {
    const serverSource = readFileSync(fileURLToPath(new URL("../scripts/mcp-server.ts", import.meta.url)), "utf8");
    expect(serverSource).toMatch(/const projectRetentionDaysParam = z\.number\(\)\.finite\(\)\.int\(\)\.min\(0\)\.max\(3_650\)/);
    expect(serverSource).toMatch(/"project_purge"[\s\S]*?retentionDays: projectRetentionDaysParam\.optional\(\)/);
  });
});
