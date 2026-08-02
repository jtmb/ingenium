import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mockEnsureExtensionProject = vi.hoisted(() => vi.fn());
const mockFetch = vi.hoisted(() => vi.fn());

vi.mock("../project-resolver.js", () => ({
  ensureExtensionProject: mockEnsureExtensionProject,
}));

vi.mock("../api-auth.js", () => ({
  apiRequestHeaders: () => new Headers(),
}));

import { classifyObserverFailure, classifyObserverHttpFailure, logPipelineEvent } from "../observer-core.js";

describe("observer API diagnostics", () => {
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockEnsureExtensionProject.mockReset().mockResolvedValue("extension-project");
    mockFetch.mockReset();
    vi.stubGlobal("fetch", mockFetch);
  });

  afterEach(() => {
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it.each([
    [401, "authentication"],
    [403, "authentication"],
    [404, "not_found"],
    [423, "locked"],
    [500, "request_failed"],
  ] as const)("maps HTTP %i to the stable %s category", (status, expected) => {
    expect(classifyObserverHttpFailure(status)).toBe(expected);
  });

  it("classifies timeout-shaped transport failures without preserving error text", () => {
    const error = new Error("Bearer secret-token timed out") as Error & { name: string };
    error.name = "TimeoutError";

    expect(classifyObserverFailure(error)).toBe("timeout");
  });

  it.each([
    ["API-down", () => mockFetch.mockRejectedValue(new Error("Bearer secret-token http://private.example/stack")), "request_failed"],
    ["authentication", () => mockFetch.mockResolvedValue({ ok: false, status: 401 } as Response), "authentication"],
    ["timeout", () => {
      const error = new Error("Bearer secret-token http://private.example/timeout");
      error.name = "TimeoutError";
      mockFetch.mockRejectedValue(error);
    }, "timeout"],
  ] as const)("reports only the stable %s failure through the lifecycle callback", async (_case, failRequest, failure) => {
    failRequest();
    const report = vi.fn();

    await expect(logPipelineEvent("session_created", "plugin", "started", "/worktree", "", {}, undefined, report))
      .resolves.toBeUndefined();

    expect(report).toHaveBeenCalledWith("pipeline_event_rejected", failure);
    expect(JSON.stringify(report.mock.calls)).not.toContain("secret-token");
    expect(JSON.stringify(report.mock.calls)).not.toContain("private.example");
  });

  it("swallows a rejected lifecycle reporter without a recursive diagnostic", async () => {
    mockFetch.mockRejectedValue(new Error("Bearer secret-token http://private.example/stack"));
    const report = vi.fn(() => { throw new Error("logger rejected"); });

    await expect(logPipelineEvent("session_created", "plugin", "started", "/worktree", "", {}, undefined, report))
      .resolves.toBeUndefined();
    expect(report).toHaveBeenCalledOnce();
  });
});
