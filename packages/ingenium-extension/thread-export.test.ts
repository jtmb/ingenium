import { afterEach, describe, expect, it } from "vitest";
import { chmodSync, existsSync, lstatSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  ThreadExportError,
  cleanupThreadExport,
  convertOpenCodeExport,
  exportOpenCodeSessionToThread,
} from "./thread-export.js";
import { parseThreadExportArgs } from "./scripts/thread-export.js";

const temporaryDirectories: string[] = [];
const originalPath = process.env.PATH;

function temporaryDirectory(prefix: string): string {
  const directory = mkdtempSync(join(tmpdir(), prefix));
  temporaryDirectories.push(directory);
  return directory;
}

function worktree(): string {
  const directory = temporaryDirectory("ingenium-thread-export-worktree-");
  writeFileSync(join(directory, ".git"), "gitdir: /nonexistent\n", "utf8");
  return directory;
}

function exportEnvelope(sessionId = "session_123"): Record<string, unknown> {
  return {
    info: { id: sessionId },
    messages: [{
      info: { id: "user-1", role: "user" },
      parts: [{ type: "text", text: "hello" }],
    }],
  };
}

function expectFailure(action: () => unknown | Promise<unknown>, failure: string): Promise<void> {
  return expect(Promise.resolve().then(action)).rejects.toMatchObject({ failure });
}

afterEach(() => {
  if (originalPath === undefined) delete process.env.PATH;
  else process.env.PATH = originalPath;
  for (const directory of temporaryDirectories.splice(0)) {
    rmSync(directory, { recursive: true, force: true });
  }
});

describe("OpenCode Thread export adapter", () => {
  it("keeps chronological visible user and completed-assistant text while excluding non-visible parts", () => {
    const entries = convertOpenCodeExport("session_123", {
      info: { id: "session_123" },
      messages: [
        {
          info: { id: "user-1", role: "user" },
          parts: [
            { type: "text", text: "first user text" },
            { type: "reasoning", text: "private reasoning" },
            { type: "text", text: "ignored user text", ignored: true },
          ],
        },
        {
          info: { id: "assistant-incomplete", role: "assistant", time: { created: 1 } },
          parts: [{ type: "text", text: "incomplete assistant text" }],
        },
        {
          info: { id: "assistant-1", role: "assistant", time: { completed: 2 } },
          parts: [
            { type: "text", text: "first assistant text" },
            { type: "tool", tool: "must-not-export" },
            { type: "file", url: "file:///must-not-export" },
            { type: "text", text: "synthetic assistant text", synthetic: true },
            { type: "text", text: "second assistant text" },
          ],
        },
        {
          info: { id: "tool-1", role: "tool" },
          parts: [{ type: "text", text: "tool-result" }],
        },
      ],
    });

    expect(entries.map(({ role, content }) => ({ role, content }))).toEqual([
      { role: "user", content: "first user text" },
      { role: "assistant", content: "first assistant text\n\nsecond assistant text" },
    ]);
    expect(entries[1]!.metadata).toMatchObject({ source: "opencode-export", sourceMessageIndex: 2, visiblePartCount: 2 });
    expect(JSON.stringify(entries)).not.toContain("assistant-1");
    expect(JSON.stringify(entries)).not.toContain("private reasoning");
    expect(JSON.stringify(entries)).not.toContain("tool-result");
  });

  it("rejects malformed exports and mismatched source sessions without creating an artifact", async () => {
    const directory = worktree();
    await expectFailure(
      () => exportOpenCodeSessionToThread({
        sessionId: "session_123",
        worktree: directory,
        runner: async () => "{not-json",
      }),
      "malformed_export",
    );
    await expectFailure(
      () => exportOpenCodeSessionToThread({
        sessionId: "session_123",
        worktree: directory,
        runner: async () => JSON.stringify({ ...exportEnvelope("different-session") }),
      }),
      "malformed_export",
    );
    expect(existsSync(join(directory, ".ingenium", "thread-exports"))).toBe(false);
  });

  it("rejects traversal session IDs and noncanonical worktrees before it can invoke a command", async () => {
    const directory = worktree();
    let called = false;
    const runner = async () => {
      called = true;
      return JSON.stringify(exportEnvelope());
    };

    await expectFailure(
      () => exportOpenCodeSessionToThread({ sessionId: "../session", worktree: directory, runner }),
      "invalid_input",
    );
    await expectFailure(
      () => exportOpenCodeSessionToThread({ sessionId: "session_123", worktree: `${directory}/.`, runner }),
      "worktree_invalid",
    );
    expect(called).toBe(false);
  });

  it("passes an explicit session to the runner with shell execution disabled", async () => {
    const directory = worktree();
    let invocation: { sessionId: string; worktree: string; shell: boolean } | undefined;
    await exportOpenCodeSessionToThread({
      sessionId: "session_123",
      worktree: directory,
      runner: async (sessionId, canonicalWorktree, options) => {
        invocation = { sessionId, worktree: canonicalWorktree, shell: options.shell };
        return JSON.stringify(exportEnvelope(sessionId));
      },
    });

    expect(invocation).toEqual({ sessionId: "session_123", worktree: directory, shell: false });
  });

  it("kills a local shell-free opencode export that exceeds its bounded timeout", async () => {
    const directory = worktree();
    const bin = temporaryDirectory("ingenium-thread-export-bin-");
    const executable = join(bin, "opencode");
    writeFileSync(executable, "#!/usr/bin/env node\nsetInterval(() => {}, 1000);\n", "utf8");
    chmodSync(executable, 0o755);
    process.env.PATH = `${bin}:${originalPath ?? ""}`;

    await expectFailure(
      () => exportOpenCodeSessionToThread({ sessionId: "session_123", worktree: directory, timeoutMs: 100 }),
      "timeout",
    );
  });

  it("enforces source-byte and message-count limits before writing a JSONL file", async () => {
    const directory = worktree();
    await expectFailure(
      () => exportOpenCodeSessionToThread({
        sessionId: "session_123",
        worktree: directory,
        maxSourceBytes: 128,
        runner: async () => JSON.stringify({
          info: { id: "session_123" },
          messages: [{ info: { id: "large", role: "user" }, parts: [{ type: "text", text: "x".repeat(1024) }] }],
        }),
      }),
      "output_too_large",
    );
    await expectFailure(
      () => exportOpenCodeSessionToThread({
        sessionId: "session_123",
        worktree: directory,
        maxMessages: 1,
        runner: async () => JSON.stringify({ ...exportEnvelope(), messages: [
          { info: { id: "one", role: "user" }, parts: [{ type: "text", text: "one" }] },
          { info: { id: "two", role: "user" }, parts: [{ type: "text", text: "two" }] },
        ] }),
      }),
      "bounds",
    );
  });

  it("atomically writes mode-0600 export and receipt artifacts and cleans both only after upload success", async () => {
    const directory = worktree();
    const receipt = await exportOpenCodeSessionToThread({
      sessionId: "session_123",
      worktree: directory,
      runner: async () => JSON.stringify(exportEnvelope()),
    });
    const stat = lstatSync(receipt.path);
    const receiptStat = lstatSync(receipt.receiptPath);
    expect(stat.isFile()).toBe(true);
    expect(stat.mode & 0o777).toBe(0o600);
    expect(receiptStat.isFile()).toBe(true);
    expect(receiptStat.mode & 0o777).toBe(0o600);
    expect(receipt).toMatchObject({
      messageCount: 1,
      metadata: { source: "opencode-export", sourceSessionSha256: expect.stringMatching(/^[a-f0-9]{64}$/) },
    });
    expect(JSON.parse(readFileSync(receipt.receiptPath, "utf8"))).toEqual({
      schemaVersion: 1,
      exportFile: receipt.path.split("/").at(-1),
      sourceSessionSha256: receipt.metadata.sourceSessionSha256,
      byteLength: receipt.byteLength,
      sha256: receipt.sha256,
    });
    expect(JSON.stringify(receipt)).not.toContain("hello");

    await expectFailure(
      () => cleanupThreadExport({ worktree: directory, receipt, uploadSucceeded: false }),
      "cleanup_denied",
    );
    expect(existsSync(receipt.path)).toBe(true);
    expect(existsSync(receipt.receiptPath)).toBe(true);

    const unrelated = join(directory, "unrelated.jsonl");
    writeFileSync(unrelated, "do-not-delete", { mode: 0o600 });
    await expectFailure(
      () => cleanupThreadExport({
        worktree: directory,
        receipt: { path: unrelated, receiptPath: receipt.receiptPath, sha256: receipt.sha256 },
        uploadSucceeded: true,
      }),
      "cleanup_denied",
    );
    expect(existsSync(unrelated)).toBe(true);

    await expectFailure(
      () => cleanupThreadExport({
        worktree: directory,
        receipt: { path: receipt.path, receiptPath: receipt.receiptPath, sha256: "0".repeat(64) },
        uploadSucceeded: true,
      }),
      "cleanup_denied",
    );
    expect(existsSync(receipt.path)).toBe(true);

    writeFileSync(receipt.receiptPath, JSON.stringify({
      schemaVersion: 1,
      exportFile: receipt.path.split("/").at(-1),
      sourceSessionSha256: receipt.metadata.sourceSessionSha256,
      byteLength: receipt.byteLength,
      sha256: "0".repeat(64),
    }), { mode: 0o600 });
    await expectFailure(
      () => cleanupThreadExport({ worktree: directory, receipt, uploadSucceeded: true }),
      "cleanup_denied",
    );
    expect(existsSync(receipt.path)).toBe(true);
    expect(existsSync(receipt.receiptPath)).toBe(true);

    writeFileSync(receipt.receiptPath, JSON.stringify({
      schemaVersion: 1,
      exportFile: receipt.path.split("/").at(-1),
      sourceSessionSha256: receipt.metadata.sourceSessionSha256,
      byteLength: receipt.byteLength,
      sha256: receipt.sha256,
    }), { mode: 0o600 });

    cleanupThreadExport({ worktree: directory, receipt, uploadSucceeded: true });
    expect(existsSync(receipt.path)).toBe(false);
    expect(existsSync(receipt.receiptPath)).toBe(false);
  });

  it("requires explicit success confirmation for the cleanup command", () => {
    expect(() => parseThreadExportArgs([
      "--cleanup", "/tmp/thread-export.jsonl",
      "--sha256", "a".repeat(64),
      "--worktree", "/tmp/worktree",
    ])).toThrow(/upload-succeeded/);
    expect(parseThreadExportArgs([
      "--cleanup", "/tmp/thread-export.jsonl",
      "--receipt", "/tmp/thread-export.jsonl.receipt.json",
      "--sha256", "a".repeat(64),
      "--worktree", "/tmp/worktree",
      "--upload-succeeded",
    ])).toMatchObject({ mode: "cleanup", receiptPath: "/tmp/thread-export.jsonl.receipt.json", uploadSucceeded: true });
  });
});
