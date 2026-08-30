import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockEnsureMcpProject = vi.hoisted(() => vi.fn());
const mockBinding = vi.hoisted(() => ({
  apiUrl: "http://api.test/api/v1",
  project: "extension-project",
  workspaceId: "workspace",
  launcherWorktree: "/worktree",
  audience: "mcp" as "mcp" | "runtime",
  credentialFile: "/private/.ingenium-learning-credential",
  purpose: "learning" as "learning" | "runtime",
}));

vi.mock("./mcp-client.js", () => ({
  ensureMcpProject: mockEnsureMcpProject,
}));

vi.mock("./project-resolver.js", () => ({
  resolveExtensionProject: () => "extension-project",
}));

vi.mock("./extension-binding.js", () => ({
  resolveExtensionBinding: () => mockBinding,
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
    mockEnsureMcpProject.mockResolvedValue("extension-project");
  });

  afterEach(() => {
    mockBinding.audience = "mcp";
    mockBinding.purpose = "learning";
    vi.clearAllMocks();
  });

  it("resolves the current extension project before checking its exact catalog state", async () => {
    const request = vi.fn().mockResolvedValue(response({
      data: { tool_name: "auto_observe_now", enabled: true },
    }));

    await expect(assertExtensionToolEnabled("auto_observe_now", "/worktree", { request }))
      .resolves.toBe("extension-project");

    expect(mockEnsureMcpProject).toHaveBeenCalledWith("/worktree", "learning");
    expect(request).toHaveBeenCalledWith(
      expect.stringContaining("/mcp-tools/auto_observe_now/state?project=extension-project"),
      expect.objectContaining({ headers: expect.any(Headers) }),
    );
  });

  it("uses the runtime purpose selected by the binding resolver", async () => {
    mockBinding.audience = "runtime";
    mockBinding.purpose = "runtime";
    const request = vi.fn().mockResolvedValue(response({
      data: { tool_name: "auto_observe_now", enabled: true },
    }));

    await expect(assertExtensionToolEnabled("auto_observe_now", "/worktree", { request }))
      .resolves.toBe("extension-project");

    expect(mockEnsureMcpProject).toHaveBeenCalledWith("/worktree", "runtime");
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
    ["insufficient credential scope", response({ error: { code: "FORBIDDEN" } }, 403)],
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
