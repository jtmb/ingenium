import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { closeHttpServer, listenOnLoopback } from "./http-fixtures.js";

const download = vi.hoisted(() => ({ read: vi.fn(), wipe: vi.fn() }));
vi.mock("ingenium-core", async (importOriginal) => {
  const core = await importOriginal<typeof import("ingenium-core")>();
  return { ...core, projects: { ...core.projects, getGlobalProject: () => ({ id: "global-default", name: "Global" }) }, backups: { ...core.backups, readVerifiedBackupComponent: download.read, wipeBackupDownloadBuffer: download.wipe } };
});
import { backupsRouter } from "../lib/routes/backups.js";

let server: Server;
let baseUrl: string;
const url = () => `${baseUrl}/api/v1/backups/owned-test/download?project=global-default`;
function fixture() {
  return { bytes: Buffer.alloc(8 * 1024 * 1024, 7), size: 8 * 1024 * 1024, filename: "ingenium.db" };
}
beforeAll(async () => {
  const app = express();
  app.use("/api/v1/backups", backupsRouter);
  server = createServer(app);
  baseUrl = await listenOnLoopback(server);
});
afterEach(() => { vi.clearAllMocks(); });
afterAll(async () => { await closeHttpServer(server); });

describe("verified backup download memory admission", () => {
  it("rejects a concurrent download before allocating and releases after completion", async () => {
    download.read.mockImplementation(fixture);
    download.wipe.mockImplementation((bytes: Buffer) => bytes.fill(0));
    const first = await fetch(url());
    expect(first.status).toBe(200);
    const busy = await fetch(url());
    expect(busy.status).toBe(429);
    expect(busy.headers.get("retry-after")).toBe("1");
    expect((await busy.json()).error.code).toBe("BACKUP_DOWNLOAD_BUSY");
    expect(download.read).toHaveBeenCalledTimes(1);
    expect((await first.arrayBuffer()).byteLength).toBe(8 * 1024 * 1024);
    await vi.waitFor(() => expect(download.wipe).toHaveBeenCalledTimes(1));
    const next = await fetch(url());
    expect(next.status).toBe(200);
    await next.arrayBuffer();
    await vi.waitFor(() => expect(download.wipe).toHaveBeenCalledTimes(2));
    expect(download.read).toHaveBeenCalledTimes(2);
  });

  it("wipes and releases the buffer after the client aborts", async () => {
    download.read.mockImplementation(fixture);
    download.wipe.mockImplementation((bytes: Buffer) => bytes.fill(0));
    const controller = new AbortController();
    const first = await fetch(url(), { signal: controller.signal });
    expect(first.status).toBe(200);
    controller.abort();
    await vi.waitFor(() => expect(download.wipe).toHaveBeenCalledTimes(1));
    const next = await fetch(url());
    expect(next.status).toBe(200);
    await next.arrayBuffer();
    await vi.waitFor(() => expect(download.wipe).toHaveBeenCalledTimes(2));
  });

  it("releases admission when verification fails before a buffer exists", async () => {
    download.read.mockImplementationOnce(() => { throw new Error("verification failed"); }).mockImplementation(fixture);
    download.wipe.mockImplementation((bytes: Buffer) => bytes.fill(0));
    expect((await fetch(url())).status).toBe(404);
    expect(download.wipe).not.toHaveBeenCalled();
    const next = await fetch(url());
    expect(next.status).toBe(200);
    await next.arrayBuffer();
    await vi.waitFor(() => expect(download.wipe).toHaveBeenCalledTimes(1));
  });
});
