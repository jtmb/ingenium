import { afterEach, describe, expect, it } from "vitest";
import { mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { resolveSafeDownloadPath, streamDownloadResponse } from "../lib/safe-download.js";

let temporaryDirectory = "";
let externalDirectory = "";

afterEach(() => {
  if (temporaryDirectory) rmSync(temporaryDirectory, { recursive: true, force: true });
  if (externalDirectory) rmSync(externalDirectory, { recursive: true, force: true });
  temporaryDirectory = "";
  externalDirectory = "";
});

describe("safe downloads", () => {
  it("allows only workspace and home destinations", () => {
    expect(resolveSafeDownloadPath("/workspace/project/download.db")).toBe("/workspace/project/download.db");
    expect(resolveSafeDownloadPath(`${process.env.HOME ?? "/home/appuser"}/download.db`))
      .toBe(`${process.env.HOME ?? "/home/appuser"}/download.db`);
    expect(() => resolveSafeDownloadPath("/workspace-escape/download.db")).toThrow(/must be within/);
    expect(() => resolveSafeDownloadPath("/tmp/download.db")).toThrow(/must be within/);
  });

  it("streams the response body and reports its stored metadata", async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "ingenium-safe-download-"));
    const options = { allowedRoots: [temporaryDirectory] };
    const destination = resolveSafeDownloadPath(join(temporaryDirectory, "nested", "download.bin"), options);
    const result = await streamDownloadResponse(new Response("download body", {
      headers: { "content-type": "application/octet-stream" },
    }), destination, options);

    expect(readFileSync(destination, "utf8")).toBe("download body");
    expect(result).toEqual({ mimeType: "application/octet-stream", size: 13 });
  });

  it("rejects a symlinked ancestor without changing its target", async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "ingenium-safe-download-"));
    externalDirectory = mkdtempSync(join(tmpdir(), "ingenium-safe-download-target-"));
    const target = join(externalDirectory, "file");
    const destination = join(temporaryDirectory, "link", "file");
    const options = { allowedRoots: [temporaryDirectory] };
    writeFileSync(target, "unchanged");
    symlinkSync(externalDirectory, join(temporaryDirectory, "link"));

    expect(() => resolveSafeDownloadPath(destination, options)).toThrow(/symbolic link/);
    await expect(streamDownloadResponse(new Response("download body"), destination, options))
      .rejects.toThrow(/symbolic link/);
    expect(readFileSync(target, "utf8")).toBe("unchanged");
  });

  it("rejects a symlinked destination without changing its target", async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "ingenium-safe-download-"));
    externalDirectory = mkdtempSync(join(tmpdir(), "ingenium-safe-download-target-"));
    const target = join(externalDirectory, "file");
    const destination = join(temporaryDirectory, "download.bin");
    const options = { allowedRoots: [temporaryDirectory] };
    writeFileSync(target, "unchanged");
    const validatedDestination = resolveSafeDownloadPath(destination, options);
    symlinkSync(target, destination);

    expect(() => resolveSafeDownloadPath(destination, options)).toThrow(/symbolic link/);
    await expect(streamDownloadResponse(new Response("download body"), validatedDestination, options))
      .rejects.toThrow(/symbolic link/);
    expect(readFileSync(target, "utf8")).toBe("unchanged");
  });

  it("rejects an existing non-regular destination", async () => {
    temporaryDirectory = mkdtempSync(join(tmpdir(), "ingenium-safe-download-"));
    const destination = join(temporaryDirectory, "directory");
    const options = { allowedRoots: [temporaryDirectory] };
    mkdirSync(destination);

    expect(() => resolveSafeDownloadPath(destination, options)).toThrow(/not a regular file/);
    await expect(streamDownloadResponse(new Response("download body"), destination, options))
      .rejects.toThrow(/not a regular file/);
  });
});
