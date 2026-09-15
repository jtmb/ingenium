import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";

// ── Module mocks (hoisted before imports) ──────────────────────────
const mockLogPipelineEvent = vi.hoisted(() => vi.fn());
const mockImportObservations = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ imported: 0, skipped: 0 }),
);
const mockTriggerSynthesis = vi.hoisted(() =>
  vi.fn().mockResolvedValue({ triggered: false, message: "" }),
);

vi.mock("../observer-core.js", () => ({
  logPipelineEvent: mockLogPipelineEvent,
  importObservationsFromFile: mockImportObservations,
  triggerSynthesis: mockTriggerSynthesis,
}));

// ── Subject under test ────────────────────────────────────────────
import { ObserverPlugin } from "../observer.js";

describe("ObserverPlugin — session.created error reporting", () => {
  let stdout: ReturnType<typeof vi.spyOn>;
  let stderr: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    stdout = vi.spyOn(process.stdout, "write").mockImplementation(() => true);
    stderr = vi.spyOn(process.stderr, "write").mockImplementation(() => true);
    mockLogPipelineEvent.mockReset().mockResolvedValue(undefined);
    mockImportObservations.mockReset().mockResolvedValue({ imported: 0, skipped: 0 });
    mockTriggerSynthesis.mockReset().mockResolvedValue({ triggered: false, message: "" });
  });

  afterEach(() => {
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
    vi.restoreAllMocks();
    vi.clearAllMocks();
  });

  it("reports rejected logPipelineEvent without exposing its error text", async () => {
    mockLogPipelineEvent.mockRejectedValueOnce(new Error("Bearer secret-token API unreachable"));
    const log = vi.fn();

    const plugin = await ObserverPlugin({
      worktree: "/tmp/test-rejected-log",
      client: { app: { log } },
    });

    // This must NOT throw — session startup must survive a rejected log
    await expect(
      plugin.event({ event: { type: "session.created", session: { id: "sess-1" } } }),
    ).resolves.toBeUndefined();

    const logged = JSON.stringify(log.mock.calls);
    expect(logged).toContain("pipeline_event_rejected: request_failed");
    expect(logged).not.toContain("Bearer");
    expect(logged).not.toContain("secret-token");
    expect(logged).not.toContain("API unreachable");
  });

  it("reports rejected logPipelineEvent without blocking import/synthesis", async () => {
    mockLogPipelineEvent.mockRejectedValueOnce(new Error("timeout"));
    // Make import return some results to verify it still ran
    mockImportObservations.mockResolvedValueOnce({ imported: 3, skipped: 1 });
    const log = vi.fn();

    const plugin = await ObserverPlugin({
      worktree: "/tmp/test-nonblocking",
      client: { app: { log } },
    });

    await plugin.event({ event: { type: "session.created", session: { id: "sess-2" } } });

    // importObservationsFromFile still ran (session startup not blocked)
    expect(mockImportObservations).toHaveBeenCalledTimes(1);
    // triggerSynthesis still ran
    expect(mockTriggerSynthesis).toHaveBeenCalledTimes(1);
    // Errors are reported through the OpenCode app logger, never stdio.
    expect(JSON.stringify(log.mock.calls)).toContain("pipeline_event_rejected: request_failed");
  });

  it("does NOT report error when logPipelineEvent succeeds", async () => {
    mockLogPipelineEvent.mockResolvedValueOnce(undefined);
    mockTriggerSynthesis.mockResolvedValueOnce({ triggered: true, message: "ok" });

    const plugin = await ObserverPlugin({
      worktree: "/tmp/test-success",
      client: { app: { log: vi.fn() } },
    });

    await plugin.event({ event: { type: "session.created", session: { id: "sess-3" } } });

    // No process output on success either.
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });

  it("preserves no-global-default project behavior (worktree-derived project)", async () => {
    mockLogPipelineEvent.mockRejectedValueOnce(new Error("API unreachable"));

    const plugin = await ObserverPlugin({
      worktree: "/tmp/test-my-project",
      client: { app: { log: vi.fn() } },
    });

    await plugin.event({ event: { type: "session.created", session: { id: "sess-4" } } });

    // logPipelineEvent was called with the worktree-derived project path
    expect(mockLogPipelineEvent.mock.calls[0]?.slice(0, 6)).toEqual([
      "session_created",
      "plugin",
      "OpenCode session started",
      "/tmp/test-my-project",
      "",
      {},
    ]);
  });

  it("reports a failed observation import without exposing the underlying error", async () => {
    mockImportObservations.mockRejectedValueOnce(new Error("Bearer secret-token import failure"));
    mockLogPipelineEvent.mockResolvedValueOnce(undefined);
    mockTriggerSynthesis.mockResolvedValueOnce({ triggered: true, message: "ok" });
    const log = vi.fn();
    const plugin = await ObserverPlugin({ worktree: "/tmp/test-import-failure", client: { app: { log } } });

    await expect(plugin.event({ event: { type: "session.created" } })).resolves.toBeUndefined();
    expect(JSON.stringify(log.mock.calls)).toContain("import_observations: request_failed");
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });

  it("reports a failed synthesis trigger without blocking the lifecycle hook", async () => {
    mockLogPipelineEvent.mockResolvedValueOnce(undefined);
    mockImportObservations.mockResolvedValueOnce({ imported: 0, skipped: 0 });
    mockTriggerSynthesis.mockResolvedValueOnce({ triggered: false, message: "Bearer secret-token timeout" });
    const log = vi.fn();
    const plugin = await ObserverPlugin({ worktree: "/tmp/test-synthesis-failure", client: { app: { log } } });

    await expect(plugin.event({ event: { type: "session.created" } })).resolves.toBeUndefined();
    expect(JSON.stringify(log.mock.calls)).toContain("trigger_synthesis: request_failed");
    expect(stdout).not.toHaveBeenCalled();
    expect(stderr).not.toHaveBeenCalled();
  });

  it.each([
    ["authentication", "Bearer secret-token 401"],
    ["not_found", "private API path 404"],
    ["locked", "resource lease 423"],
    ["timeout", "Bearer secret-token request timed out"],
  ] as const)("reports the safe %s synthesis failure category without diagnostic text", async (failure, unsafeMessage) => {
    mockLogPipelineEvent.mockResolvedValueOnce(undefined);
    mockImportObservations.mockResolvedValueOnce({ imported: 0, skipped: 0 });
    mockTriggerSynthesis.mockResolvedValueOnce({ triggered: false, message: unsafeMessage, failure });
    const log = vi.fn();
    const plugin = await ObserverPlugin({ worktree: "/tmp/test-safe-observer-failure", client: { app: { log } } });

    await expect(plugin.event({ event: { type: "session.created" } })).resolves.toBeUndefined();

    const output = JSON.stringify(log.mock.calls);
    expect(output).toContain(`trigger_synthesis: ${failure}`);
    expect(output).not.toContain("secret-token");
    expect(output).not.toContain("private API path");
    expect(output).not.toContain("resource lease");
  });

  it("keeps API-down lifecycle reporting non-fatal when the OpenCode logger rejects", async () => {
    mockLogPipelineEvent.mockRejectedValueOnce(new Error("Bearer secret-token http://private.example/stack"));
    mockTriggerSynthesis.mockResolvedValueOnce({ triggered: false, message: "API down", failure: "request_failed" });
    const log = vi.fn().mockRejectedValue(new Error("logger rejected secret-token"));
    const plugin = await ObserverPlugin({ worktree: "/tmp/test-logger-failure", client: { app: { log } } });

    await expect(plugin.event({ event: { type: "session.created" } })).resolves.toBeUndefined();
    await Promise.resolve();

    expect(log).toHaveBeenCalled();
    expect(JSON.stringify(log.mock.calls)).not.toContain("secret-token");
    expect(JSON.stringify(log.mock.calls)).not.toContain("private.example");
  });
});
