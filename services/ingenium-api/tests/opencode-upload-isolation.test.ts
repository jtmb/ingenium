import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

// A regression must fail before touching the historical shared upload directory.
vi.mock("node:fs", async (importOriginal) => {
  const fs = await importOriginal<typeof import("node:fs")>();
  return {
    ...fs,
    mkdirSync: (...args: Parameters<typeof fs.mkdirSync>) => {
      if (String(args[0]) === "/tmp/ingenium-chat-uploads") throw new Error("Shared upload directory accessed");
      return fs.mkdirSync(...args);
    },
  };
});

let directory: string;
let uploads: string;
let server: Server | undefined;
let base: string;

beforeAll(async () => {
  directory = mkdtempSync(join(tmpdir(), "ingenium-upload-isolation-"));
  uploads = join(directory, "ingenium-chat-uploads");
  mkdirSync(uploads);
  writeFileSync(join(uploads, "expired.txt"), "expired synthetic upload");
  utimesSync(join(uploads, "expired.txt"), new Date(0), new Date(0));
  writeFileSync(join(uploads, "recent.txt"), "recent synthetic upload");
  writeFileSync(join(directory, "unrelated.txt"), "retain this file");
  for (const key of ["TMPDIR", "TMP", "TEMP"]) vi.stubEnv(key, directory);
  vi.stubEnv("OPENCODE_SERVER_PASSWORD", "synthetic-upload-password");
  vi.stubEnv("OPENCODE_SERVER_PASSWORD_FILE", "");
  const { opencodeRouter } = await import("../lib/routes/opencode.js");
  const app = express();
  app.use(opencodeRouter);
  server = createServer(app);
  await new Promise<void>((resolve) => server!.listen(0, "127.0.0.1", resolve));
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});

afterAll(async () => {
  if (server) await new Promise<void>((resolve, reject) => server!.close((error) => error ? reject(error) : resolve()));
  vi.unstubAllEnvs();
  if (directory) rmSync(directory, { recursive: true, force: true });
});

describe("chat upload runtime isolation", () => {
  it("expires only old uploads inside the configured temporary root", () => {
    expect(existsSync(join(uploads, "expired.txt"))).toBe(false);
    expect(readFileSync(join(uploads, "recent.txt"), "utf8")).toBe("recent synthetic upload");
    expect(readFileSync(join(directory, "unrelated.txt"), "utf8")).toBe("retain this file");
  });

  it("returns a file URL for the actual upload in that root", async () => {
    const form = new FormData();
    form.append("file", new Blob(["synthetic upload"], { type: "text/plain" }), "notes #1.txt");
    const response = await fetch(`${base}/upload`, { method: "POST", body: form });
    expect(response.status).toBe(200);
    const { data } = await response.json() as { data: { url: string; filename: string } };
    const file = fileURLToPath(data.url);
    expect(dirname(file)).toBe(uploads);
    expect(readFileSync(file, "utf8")).toBe("synthetic upload");
    expect(data.filename).toBe("notes #1.txt");
  });

  it("removes a rejected upload without deleting accepted files", async () => {
    const before = readdirSync(uploads).sort();
    const form = new FormData();
    form.append("file", new Blob(["synthetic rejected file"], { type: "application/octet-stream" }), "payload.bin");
    const response = await fetch(`${base}/upload`, { method: "POST", body: form });
    expect(response.status).toBe(400);
    expect(await response.json()).toMatchObject({ error: { code: "UPLOAD_REJECTED" } });
    expect(readdirSync(uploads).sort()).toEqual(before);
  });
});
