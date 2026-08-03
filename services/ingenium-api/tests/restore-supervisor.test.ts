import { afterEach, describe, expect, it, vi } from "vitest";
import { RESTORE_MAINTENANCE_PROGRAM, startRestoreMaintenance } from "../lib/restore-supervisor.js";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("RESTORE-101 supervisor bridge", () => {
  it("starts only the fixed maintenance program", async () => {
    const fetchMock = vi.fn().mockResolvedValue(new Response("<methodResponse/>", { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);

    await startRestoreMaintenance();

    expect(RESTORE_MAINTENANCE_PROGRAM).toBe("restore-maintenance");
    expect(fetchMock).toHaveBeenCalledWith("http://127.0.0.1:9001/RPC2", expect.objectContaining({
      method: "POST",
      body: '<?xml version="1.0"?><methodCall><methodName>supervisor.startProcess</methodName><params><param><value><string>restore-maintenance</string></value></param><param><value><boolean>0</boolean></value></param></params></methodCall>',
    }));
  });

  it("fails closed when supervisor rejects the fixed program", async () => {
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response("<fault>", { status: 500 })));

    await expect(startRestoreMaintenance()).rejects.toThrow("RESTORE_SUPERVISOR_START_FAILED");
  });
});
