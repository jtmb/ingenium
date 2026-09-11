import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPost = vi.hoisted(() => vi.fn());

vi.mock("../lib/client.js", () => ({
  api: { settled: { post: mockPost } },
}));

import {
  REPOSITORY_MAX_RESOURCE_FILE_BYTES,
  REPOSITORY_MAX_RESOURCE_TOTAL_BYTES,
  repositorySync,
} from "../lib/tools/repository.js";

const docsManifest = {
  files: [{ path: "docs/index.md", sha256: "a".repeat(64), content: "# Docs\n", fileType: "regular", isSymlink: false }],
};
const resourcesManifest = { version: 2, skills: [], agents: [], plugins: [] };
describe("repository sync MCP tool adapter", () => {
  it.each(["retained corpus", "exact byte limits"])("accepts documents at %s", async (size) => {
    const roadmap = "x".repeat(805_779 - 802) + "é".repeat(802);
    expect(roadmap.length).toBe(805_779);
    expect(Buffer.byteLength(roadmap)).toBe(806_581);
    const contents = size === "retained corpus"
      ? [roadmap, "x".repeat(600_000), "x".repeat(1_873_484 - 806_581 - 600_000)]
      : Array.from({ length: 3 }, () => "é".repeat(512 * 1024));
    expect(contents.reduce((total, content) => total + Buffer.byteLength(content), 0))
      .toBe(size === "retained corpus" ? 1_873_484 : 3 * 1024 * 1024);
    const manifest = { files: contents.map((content, index) => ({
      ...docsManifest.files[0], path: `docs/${index}.md`, content,
    })) };
    mockPost.mockResolvedValueOnce({ ok: true, data: {
      dryRun: true, generation: 0, manifestHash: "a".repeat(64), docs: { summary: {} },
    } });

    const result = await repositorySync("ingenium", manifest, undefined, 0, true);

    expect(result).not.toHaveProperty("isError");
    expect(mockPost).toHaveBeenCalledWith("/repository/sync", {
      docsManifest: manifest, resourcesManifest: undefined, expectedGeneration: 0, dryRun: true,
    }, { project: "ingenium" });
  });

  it.each([
    ["file byte", ["é".repeat(512 * 1024) + "x"]],
    ["file character", ["x".repeat(1024 * 1024 + 1)]],
    ["aggregate byte", [...Array.from({ length: 3 }, () => "é".repeat(512 * 1024)), "x"]],
  ])("rejects documents one %s over the limit before forwarding", async (_label, contents) => {
    const manifest = { files: contents.map((content, index) => ({
      ...docsManifest.files[0], path: `docs/${index}.md`, content,
    })) };

    const result = await repositorySync("ingenium", manifest, undefined, 0, true);

    expect(mockPost).not.toHaveBeenCalled();
    expect(result).toMatchObject({ isError: true });
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      error: { code: "INVALID_REPOSITORY_SYNC", message: "Repository synchronization request is invalid." },
    });
  });

  it("forwards command resources and returns only bounded command counters", async () => {
    const resources = { ...resourcesManifest, commands: [{ source: "Run checks" }] };
    mockPost.mockResolvedValueOnce({ ok: true, data: {
      dryRun: true, generation: 0, manifestHash: "a".repeat(64), docs: { summary: {} },
      resources: { summary: { command: { created: 1, unchanged: 2, source: "must-not-return" } } },
    } });
    const result = await repositorySync("repository-project", docsManifest, resources, 0, true);
    expect(mockPost).toHaveBeenCalledWith("/repository/sync", { docsManifest, resourcesManifest: resources, expectedGeneration: 0, dryRun: true }, { project: "repository-project" });
    expect(JSON.parse(result.content[0]!.text).resources.summary.command).toMatchObject({ created: 1, unchanged: 2 });
    expect(result.content[0]!.text).not.toContain("must-not-return");
  });

  it.each([
    "not-an-array",
    Array.from({ length: 513 }, () => ({ source: "Run" })),
    [{ source: "x".repeat(REPOSITORY_MAX_RESOURCE_FILE_BYTES + 1) }],
    Array.from({ length: 7 }, () => ({ source: "x".repeat(240 * 1024) })),
  ])("rejects malformed or oversized command aggregates before forwarding", async (commands) => {
    const result = await repositorySync("repository-project", docsManifest, { ...resourcesManifest, commands }, 0, true);
    expect(mockPost).not.toHaveBeenCalled();
    expect(result).toMatchObject({ isError: true });
  });

  it("does not manufacture command readback when the API omits it", async () => {
    mockPost.mockResolvedValueOnce({ ok: true, data: {
      dryRun: false, generation: 1, manifestHash: "a".repeat(64), docs: { summary: {} }, resources: { summary: {} },
    } });
    expect(await repositorySync("repository-project", docsManifest, { ...resourcesManifest, commands: [] }, 0, false)).toMatchObject({ isError: true });
  });

  beforeEach(() => {
    mockPost.mockReset();
  });

  it("proxies docs then resources with the bound project and returns summaries only", async () => {
    mockPost.mockResolvedValueOnce({
      ok: true,
      data: { dryRun: false, generation: 1, manifestHash: "a".repeat(64),
        docs: { summary: { created: 1, unchanged: 0, source: "must-not-return" } },
        resources: { summary: {
          skill: { created: 1 }, agent: { unchanged: 2 }, plugin: { removed: 1 },
        } } },
    });

    const result = await repositorySync("repository-project", docsManifest, resourcesManifest, 0, false);
    const output = JSON.parse(result.content[0]!.text);

    expect(mockPost.mock.calls).toEqual([
      ["/repository/sync", { docsManifest, resourcesManifest, expectedGeneration: 0, dryRun: false }, { project: "repository-project" }],
    ]);
    expect(output).toMatchObject({
      project: "repository-project",
      dryRun: false,
      docs: { summary: { created: 1 } },
      resources: { summary: { skill: { created: 1 }, agent: { unchanged: 2 }, plugin: { removed: 1 } } },
    });
    expect(JSON.stringify(output)).not.toContain("must-not-return");
  });

  it("stops after a failed docs sync and never exposes transport details", async () => {
    mockPost.mockRejectedValueOnce(new Error("Bearer secret-token"));

    const result = await repositorySync("repository-project", docsManifest, resourcesManifest, 0, false);

    expect(mockPost).toHaveBeenCalledTimes(1);
    expect(result).toMatchObject({ isError: true });
    expect(result.content[0]!.text).toBe(JSON.stringify({
      error: { code: "REPOSITORY_SYNC_FAILED", message: "Repository synchronization failed." },
    }));
  });

  it("rejects an oversized direct-MCP aggregate before forwarding source to the API", async () => {
    const oversizedResources = {
      version: 2,
      skills: Array.from({ length: 6 }, (_, index) => ({
        source: "x".repeat(Math.floor(REPOSITORY_MAX_RESOURCE_TOTAL_BYTES / 6)),
        index,
      })),
      agents: [],
      plugins: [],
    };

    const result = await repositorySync("repository-project", docsManifest, oversizedResources, 0, false);

    expect(mockPost).not.toHaveBeenCalled();
    expect(result).toMatchObject({ isError: true });
    expect(result.content[0]!.text).toBe(JSON.stringify({
      error: { code: "INVALID_REPOSITORY_SYNC", message: "Repository synchronization request is invalid." },
    }));
    expect(result.content[0]!.text).not.toContain("x".repeat(64));
  });

  it.each([
    ["resource content", { source: "x".repeat(REPOSITORY_MAX_RESOURCE_FILE_BYTES + 1) }],
    ["file-tree path", { fileTree: { ["x".repeat(513)]: "content" } }],
  ])("rejects an oversized direct-MCP %s before API forwarding", async (_label, entry) => {
    const result = await repositorySync("repository-project", docsManifest, {
      version: 2,
      skills: [entry],
      agents: [],
      plugins: [],
    }, 0, false);

    expect(mockPost).not.toHaveBeenCalled();
    expect(result).toMatchObject({ isError: true });
    expect(result.content[0]!.text).toBe(JSON.stringify({
      error: { code: "INVALID_REPOSITORY_SYNC", message: "Repository synchronization request is invalid." },
    }));
  });

  it("returns only the bounded generation on an API generation conflict", async () => {
    mockPost.mockResolvedValueOnce({
      ok: false,
      status: 409,
      payload: { error: { code: "MANIFEST_GENERATION_CONFLICT", message: "hidden", currentGeneration: 7, extra: "hidden" } },
    });

    const result = await repositorySync("repository-project", docsManifest, resourcesManifest, 3, false);

    expect(result).toMatchObject({ isError: true });
    expect(JSON.parse(result.content[0]!.text)).toEqual({
      error: {
        code: "MANIFEST_GENERATION_CONFLICT",
        message: "Repository manifest generation changed.",
        currentGeneration: 7,
      },
    });
  });
});
