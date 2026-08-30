import { beforeEach, describe, expect, it, vi } from "vitest";

const mockPost = vi.hoisted(() => vi.fn());

vi.mock("../lib/client.js", () => ({
  api: { post: mockPost },
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
const claim = {
  worktree_id: "worktree-main", session_id: "session-main", incarnation: 1, expected_revision: 1,
  fence: 1, ownership_token: "A".repeat(32), client_claim_key: "B".repeat(32), accepted_epoch: 1,
};

describe("repository sync MCP tool adapter", () => {
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

    const result = await repositorySync("repository-project", docsManifest, resourcesManifest, 0, claim, false);
    const output = JSON.parse(result.content[0]!.text);

    expect(mockPost.mock.calls).toEqual([
      ["/repository/sync", { docsManifest, resourcesManifest, expectedGeneration: 0, claim, dryRun: false }, { project: "repository-project" }],
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

    const result = await repositorySync("repository-project", docsManifest, resourcesManifest, 0, claim, false);

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

    const result = await repositorySync("repository-project", docsManifest, oversizedResources, 0, claim, false);

    expect(mockPost).not.toHaveBeenCalled();
    expect(result).toMatchObject({ isError: true });
    expect(result.content[0]!.text).toBe(JSON.stringify({
      error: { code: "REPOSITORY_SYNC_FAILED", message: "Repository synchronization failed." },
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
    }, 0, claim, false);

    expect(mockPost).not.toHaveBeenCalled();
    expect(result).toMatchObject({ isError: true });
    expect(result.content[0]!.text).toBe(JSON.stringify({
      error: { code: "REPOSITORY_SYNC_FAILED", message: "Repository synchronization failed." },
    }));
  });
});
