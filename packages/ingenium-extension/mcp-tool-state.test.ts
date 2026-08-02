import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockEnsureExtensionProject = vi.hoisted(() => vi.fn());

vi.mock("./project-resolver.js", () => ({
  ensureExtensionProject: mockEnsureExtensionProject,
}));

vi.mock("./api-auth.js", () => ({
  apiRequestHeaders: () => new Headers(),
}));

import {
  assertExtensionToolEnabled,
  EXTENSION_TOOL_STATE_ERRORS,
  ExtensionToolStateError,
} from "./mcp-tool-state.js";

function response(body: unknown, status = 200): Response {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response;
}

describe("extension MCP tool state guard", () => {
  beforeEach(() => {
    mockEnsureExtensionProject.mockResolvedValue("extension-project");
  });

  afterEach(() => {
    vi.clearAllMocks();
  });

  it("resolves the current extension project before checking its exact catalog state", async () => {
    const request = vi.fn().mockResolvedValue(response({
      data: { tool_name: "auto_observe_now", enabled: true },
    }));

    await expect(assertExtensionToolEnabled("auto_observe_now", "/worktree", { request }))
      .resolves.toBe("extension-project");

    expect(mockEnsureExtensionProject).toHaveBeenCalledWith(
      "/worktree",
      expect.any(String),
      undefined,
      { request },
    );
    expect(request).toHaveBeenCalledWith(
      expect.stringContaining("/mcp-tools/auto_observe_now/state?project=extension-project"),
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
  });

  it("throws the fixed disabled code without returning API details", async () => {
    const request = vi.fn().mockResolvedValue(response({
      data: { tool_name: "synthesize_observations", enabled: false },
    }));

    await expect(assertExtensionToolEnabled("synthesize_observations", "/worktree", { request }))
      .rejects.toEqual(expect.objectContaining({
        code: EXTENSION_TOOL_STATE_ERRORS.disabled,
        message: EXTENSION_TOOL_STATE_ERRORS.disabled,
      }));
  });

  it.each([
    ["HTTP failure", response({ error: { code: "private-api-detail" } }, 503)],
    ["wrong catalog entry", response({ data: { tool_name: "other_tool", enabled: true } })],
    ["malformed state", response({ data: { tool_name: "auto_observe_now", enabled: "true" } })],
    ["project mismatch", response({ data: { tool_name: "auto_observe_now", enabled: true, project: "other-project" } })],
  ])("fails closed with the fixed unavailable code for %s", async (_label, result) => {
    const request = vi.fn().mockResolvedValue(result);

    await expect(assertExtensionToolEnabled("auto_observe_now", "/worktree", { request }))
      .rejects.toEqual(expect.objectContaining({
        code: EXTENSION_TOOL_STATE_ERRORS.unavailable,
        message: EXTENSION_TOOL_STATE_ERRORS.unavailable,
      }));
  });

  it("uses the safe error type for callers that need to inspect the code", () => {
    const error = new ExtensionToolStateError(EXTENSION_TOOL_STATE_ERRORS.disabled);
    expect(error).toBeInstanceOf(Error);
    expect(error.code).toBe("TOOL_DISABLED");
    expect(error.message).toBe("TOOL_DISABLED");
  });
});
