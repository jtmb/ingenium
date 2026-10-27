import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const core = vi.hoisted(() => ({ projects: { getGlobalProject: vi.fn() },
  settings: { getSetting: vi.fn() }, synthesis: { getSynthesisStatus: vi.fn() } }));
vi.mock("ingenium-core", () => core);
const originalInterval = process.env.SYNTHESIS_INTERVAL_MS;
beforeEach(() => {
  vi.resetModules(); vi.clearAllMocks(); delete process.env.SYNTHESIS_INTERVAL_MS;
  core.projects.getGlobalProject.mockReturnValue({ id: "canonical-global-id", name: "renamed-global" });
  core.settings.getSetting.mockReturnValue(undefined);
  core.synthesis.getSynthesisStatus.mockReturnValue({ total_observations: 9, pending_count: 0, processed_count: 9,
    trait_count: 10, last_synthesis_at: "2000-01-01T00:00:00.000Z", incompleteBatch: null });
});
afterEach(() => { if (originalInterval === undefined) delete process.env.SYNTHESIS_INTERVAL_MS; else process.env.SYNTHESIS_INTERVAL_MS = originalInterval; });

describe("synthesis activity and scheduler cadence", () => {
  it("uses the active global UUID even when its name differs from the legacy default", async () => {
    core.settings.getSetting.mockReturnValue("600000");
    const { getSynthesisHealthSnapshot } = await import("../lib/application-health.js");
    const result = getSynthesisHealthSnapshot();
    expect(core.synthesis.getSynthesisStatus).toHaveBeenCalledWith("canonical-global-id");
    expect(core.settings.getSetting).toHaveBeenCalledWith("canonical-global-id", "synthesis_interval_ms");
    expect(result).toMatchObject({ intervalMs: 600000, application: { state: "idle", required: false }, nextEstimate: null });
    expect(result.stats?.totalObservations).toBe(9);
  });
  it("reports disabled automatic checks while preserving actual selected-project statistics", async () => {
    core.settings.getSetting.mockReturnValue("0");
    const { getSynthesisHealthSnapshot } = await import("../lib/application-health.js");
    const result = getSynthesisHealthSnapshot("selected-id");
    expect(core.synthesis.getSynthesisStatus).toHaveBeenCalledWith("selected-id");
    expect(result).toMatchObject({ intervalMs: 0, application: { state: "disabled", required: false }, stats: { processedCount: 9 } });
  });
  it("keeps the configured scheduler environment fallback and safely bounds an invalid default", async () => {
    process.env.SYNTHESIS_INTERVAL_MS = "120000";
    let module = await import("../lib/synthesis-cadence.js");
    expect(module.getSynthesisInterval()).toBe(120000);
    vi.resetModules(); process.env.SYNTHESIS_INTERVAL_MS = "not-a-number";
    module = await import("../lib/synthesis-cadence.js");
    expect(module.getSynthesisInterval()).toBe(900000);
  });
  it("does not report a stuck scheduler from an old processing timestamp when new work is pending", async () => {
    core.synthesis.getSynthesisStatus.mockReturnValue({ total_observations: 12, pending_count: 3,
      processed_count: 9, trait_count: 10, last_synthesis_at: "2000-01-01T00:00:00.000Z" });
    const { getSynthesisHealthSnapshot } = await import("../lib/application-health.js");
    const result = getSynthesisHealthSnapshot("selected-id");
    expect(result).toMatchObject({ application: { state: "unknown", required: false }, nextEstimate: null,
      stats: { pendingCount: 3, processedCount: 9 } });
    expect(result.application.detail).toContain("scheduler heartbeat unavailable");
    expect(result.application.detail).not.toContain("stuck");
  });
  it("reports unavailable activity without leaking internal errors", async () => {
    core.synthesis.getSynthesisStatus.mockImplementation(() => { throw new Error("private-path-and-secret-canary"); });
    const { getSynthesisHealthSnapshot } = await import("../lib/application-health.js");
    const result = getSynthesisHealthSnapshot("selected-id");
    expect(result).toMatchObject({ stats: null, application: { state: "error", required: true } });
    expect(JSON.stringify(result)).not.toContain("private-path-and-secret-canary");
  });
});
