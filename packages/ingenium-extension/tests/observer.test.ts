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
  let stderrChunks: string[];
  let originalWrite: typeof process.stderr.write;

  beforeEach(() => {
    stderrChunks = [];
    originalWrite = process.stderr.write;
    process.stderr.write = (chunk: Parameters<typeof process.stderr.write>[0]): boolean => {
      stderrChunks.push(String(chunk));
      return true;
    };
  });

  afterEach(() => {
    process.stderr.write = originalWrite;
    vi.clearAllMocks();
  });

  it("reports rejected logPipelineEvent without exposing its error text", async () => {
    mockLogPipelineEvent.mockRejectedValueOnce(new Error("Bearer secret-token API unreachable"));

    const plugin = await ObserverPlugin({
      worktree: "/tmp/test-rejected-log",
      client: { app: { log: vi.fn() } },
    });

    // This must NOT throw — session startup must survive a rejected log
    await expect(
      plugin.event({ event: { type: "session.created", session: { id: "sess-1" } } }),
    ).resolves.toBeUndefined();

    // Verify stderr received a non-secret error report
    expect(stderrChunks.length).toBeGreaterThan(0);
    const combined = stderrChunks.join("");
    expect(combined).toContain("pipeline_event_rejected");
    expect(combined).toContain("session_created");
    // No secrets in the output
    expect(combined).not.toContain("Bearer");
    expect(combined).not.toContain("secret-token");
    expect(combined).not.toContain("API unreachable");
  });

  it("reports rejected logPipelineEvent without blocking import/synthesis", async () => {
    mockLogPipelineEvent.mockRejectedValueOnce(new Error("timeout"));
    // Make import return some results to verify it still ran
    mockImportObservations.mockResolvedValueOnce({ imported: 3, skipped: 1 });

    const plugin = await ObserverPlugin({
      worktree: "/tmp/test-nonblocking",
      client: { app: { log: vi.fn() } },
    });

    await plugin.event({ event: { type: "session.created", session: { id: "sess-2" } } });

    // importObservationsFromFile still ran (session startup not blocked)
    expect(mockImportObservations).toHaveBeenCalledTimes(1);
    // triggerSynthesis still ran
    expect(mockTriggerSynthesis).toHaveBeenCalledTimes(1);
    // Error was reported to stderr
    expect(stderrChunks.join("")).toContain("pipeline_event_rejected");
  });

  it("does NOT report error when logPipelineEvent succeeds", async () => {
    mockLogPipelineEvent.mockResolvedValueOnce(undefined);
    mockTriggerSynthesis.mockResolvedValueOnce({ triggered: true, message: "ok" });

    const plugin = await ObserverPlugin({
      worktree: "/tmp/test-success",
      client: { app: { log: vi.fn() } },
    });

    await plugin.event({ event: { type: "session.created", session: { id: "sess-3" } } });

    // No error reports on success path
    expect(stderrChunks.length).toBe(0);
  });

  it("preserves no-global-default project behavior (worktree-derived project)", async () => {
    mockLogPipelineEvent.mockRejectedValueOnce(new Error("API unreachable"));

    const plugin = await ObserverPlugin({
      worktree: "/tmp/test-my-project",
      client: { app: { log: vi.fn() } },
    });

    await plugin.event({ event: { type: "session.created", session: { id: "sess-4" } } });

    // logPipelineEvent was called with the worktree-derived project path
    expect(mockLogPipelineEvent).toHaveBeenCalledWith(
      "session_created",
      "plugin",
      "OpenCode session started",
      "/tmp/test-my-project",
      "",
      {},
    );
  });

  it("reports a failed observation import without exposing the underlying error", async () => {
    mockImportObservations.mockRejectedValueOnce(new Error("Bearer secret-token import failure"));
    mockLogPipelineEvent.mockResolvedValueOnce(undefined);
    mockTriggerSynthesis.mockResolvedValueOnce({ triggered: true, message: "ok" });
    const plugin = await ObserverPlugin({ worktree: "/tmp/test-import-failure", client: { app: { log: vi.fn() } } });

    await expect(plugin.event({ event: { type: "session.created" } })).resolves.toBeUndefined();
    const output = stderrChunks.join("");
    expect(output).toContain("observer_operation_failed");
    expect(output).toContain("import_observations");
    expect(output).not.toContain("secret-token");
  });

  it("reports a failed synthesis trigger without blocking the lifecycle hook", async () => {
    mockLogPipelineEvent.mockResolvedValueOnce(undefined);
    mockImportObservations.mockResolvedValueOnce({ imported: 0, skipped: 0 });
    mockTriggerSynthesis.mockResolvedValueOnce({ triggered: false, message: "Bearer secret-token timeout" });
    const plugin = await ObserverPlugin({ worktree: "/tmp/test-synthesis-failure", client: { app: { log: vi.fn() } } });

    await expect(plugin.event({ event: { type: "session.created" } })).resolves.toBeUndefined();
    const output = stderrChunks.join("");
    expect(output).toContain("observer_operation_failed");
    expect(output).toContain("trigger_synthesis");
    expect(output).not.toContain("secret-token");
  });
});
