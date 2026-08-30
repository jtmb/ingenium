import { mkdtempSync, rmSync } from "node:fs";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { RESTORE_HANDOFF_SOCKET, RESTORE_MAINTENANCE_PROGRAM, startRestoreMaintenance } from "../lib/restore-supervisor.js";

const roots: string[] = [];

afterEach(() => {
  for (const root of roots.splice(0)) rmSync(root, { recursive: true, force: true });
});

async function handoff(response: "ok" | "error"): Promise<{ socket: string; request: Promise<string>; close: () => Promise<void> }> {
  const root = mkdtempSync(join(tmpdir(), "ingenium-restore-handoff-"));
  roots.push(root);
  const socket = join(root, "request.sock");
  let resolveRequest!: (value: string) => void;
  const request = new Promise<string>((resolve) => { resolveRequest = resolve; });
  const server = createServer((connection) => {
    let received = "";
    connection.setEncoding("utf8");
    connection.on("data", (chunk) => { received += chunk; });
    connection.on("end", () => {
      resolveRequest(received);
      connection.end(response);
    });
  });
  await new Promise<void>((resolve) => server.listen(socket, resolve));
  return { socket, request, close: () => new Promise((resolve) => server.close(() => resolve())) };
}

describe("RESTORE-101 supervisor bridge", () => {
  it("starts only the fixed maintenance program", async () => {
    const server = await handoff("ok");

    await startRestoreMaintenance(server.socket);

    expect(RESTORE_MAINTENANCE_PROGRAM).toBe("restore-maintenance");
    expect(RESTORE_HANDOFF_SOCKET).toBe("/run/ingenium-restore-handoff/request.sock");
    await expect(server.request).resolves.toBe("1");
    await server.close();
  });

  it("fails closed when supervisor rejects the fixed program", async () => {
    const server = await handoff("error");

    await expect(startRestoreMaintenance(server.socket)).rejects.toThrow("RESTORE_SUPERVISOR_START_FAILED");
    await server.close();
  });
});
