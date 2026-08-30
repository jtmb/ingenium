import { afterAll, beforeAll, describe, expect, it } from "vitest";
import express from "express";
import { createServer, type Server } from "node:http";
import { existsSync, readdirSync, unlinkSync } from "node:fs";
import { opencodeRouter } from "../lib/routes/opencode.js";
import { closeHttpServer, listenOnLoopback } from "./http-fixtures.js";

const originalPassword = process.env.OPENCODE_SERVER_PASSWORD;
const uploadDirectory = "/tmp/ingenium-chat-uploads";
const uploadedPaths = new Set<string>();
let server: Server;
let baseUrl = "";

async function upload(form: FormData): Promise<Response> {
  return fetch(`${baseUrl}/api/v1/opencode/upload`, { method: "POST", body: form });
}

function uploadFiles(): string[] {
  return readdirSync(uploadDirectory).sort();
}

beforeAll(async () => {
  process.env.OPENCODE_SERVER_PASSWORD = "upload-test-password";
  const app = express();
  app.use("/api/v1/opencode", opencodeRouter);
  server = createServer(app);
  baseUrl = await listenOnLoopback(server);
});

afterAll(async () => {
  await closeHttpServer(server);
  for (const filepath of uploadedPaths) {
    if (existsSync(filepath)) unlinkSync(filepath);
  }
  if (originalPassword === undefined) delete process.env.OPENCODE_SERVER_PASSWORD;
  else process.env.OPENCODE_SERVER_PASSWORD = originalPassword;
});

describe("OpenCode chat uploads", () => {
  it("stores one allowed file under a UUID and sanitized filename", async () => {
    const form = new FormData();
    form.append("file", new Blob(["hello upload"], { type: "text/plain" }), "unsafe name?.txt");

    const response = await upload(form);
    expect(response.status).toBe(200);
    const body = await response.json();
    expect(body.data).toMatchObject({
      filename: "unsafe name?.txt",
      mime: "text/plain",
      size: 12,
    });
    expect(body.data.url).toMatch(/^file:\/\/\/tmp\/ingenium-chat-uploads\/[0-9a-f-]{36}-unsafe_name_\.txt$/);

    const filepath = new URL(body.data.url).pathname;
    uploadedPaths.add(filepath);
    expect(existsSync(filepath)).toBe(true);
  });

  it("maps files over 5 MiB to LIMIT_FILE_SIZE", async () => {
    const filesBefore = uploadFiles();
    const form = new FormData();
    form.append("file", new Blob([new Uint8Array(5 * 1024 * 1024 + 1)], { type: "text/plain" }), "large.txt");

    const response = await upload(form);
    expect(response.status).toBe(413);
    await expect(response.json()).resolves.toEqual({
      error: { code: "LIMIT_FILE_SIZE", message: "File too large" },
    });
    expect(uploadFiles()).toEqual(filesBefore);
  });

  it("maps disallowed MIME types to UPLOAD_REJECTED", async () => {
    const filesBefore = uploadFiles();
    const form = new FormData();
    form.append("file", new Blob(["binary"], { type: "application/octet-stream" }), "payload.bin");

    const response = await upload(form);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: {
        code: "UPLOAD_REJECTED",
        message: "Unsupported file type: application/octet-stream",
      },
    });
    expect(uploadFiles()).toEqual(filesBefore);
  });

  it("maps a missing file to NO_FILE", async () => {
    const form = new FormData();
    form.append("description", "no attachment");

    const response = await upload(form);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "NO_FILE", message: "No file uploaded" },
    });
  });

  it("rejects a second file", async () => {
    const filesBefore = uploadFiles();
    const form = new FormData();
    form.append("file", new Blob(["first"], { type: "text/plain" }), "first.txt");
    form.append("file", new Blob(["second"], { type: "text/plain" }), "second.txt");

    const response = await upload(form);
    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toEqual({
      error: { code: "LIMIT_UNEXPECTED_FILE", message: "Unexpected field" },
    });
    expect(uploadFiles()).toEqual(filesBefore);
  });
});
