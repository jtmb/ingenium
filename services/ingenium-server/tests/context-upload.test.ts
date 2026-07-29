import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, linkSync, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const mockApi = {
  postOctetStream: vi.fn(),
};

vi.mock("../lib/client.js", () => ({ api: mockApi }));

const {
  CONTEXT_UPLOAD_MAX_FILE_BYTES,
  ContextUploadFileError,
  prepareContextUploadSnapshot,
  uploadContextFile,
} = await import("../lib/tools/context-upload.js");

const project = "context-upload-project";
const session = "export-session-001";
const existingConversationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";

let fixtureRoot = "";
let worktree = "";
let uploadDirectory = "";
let previousWorktree: string | undefined;

function fixturePath(name: string): string {
  return join(uploadDirectory, name);
}

function writeUpload(name: string, content: string | Uint8Array, mode = 0o600): string {
  const path = fixturePath(name);
  writeFileSync(path, content, { mode });
  chmodSync(path, mode);
  return path;
}

function snapshotBody(bytes: Uint8Array): Record<string, unknown> {
  return JSON.parse(Buffer.from(bytes).toString("utf8")) as Record<string, unknown>;
}

function resultBody(result: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

beforeEach(() => {
  fixtureRoot = mkdtempSync(join(tmpdir(), "ingenium-context-upload-"));
  worktree = join(fixtureRoot, project);
  uploadDirectory = join(worktree, ".ingenium", "context-uploads");
  mkdirSync(uploadDirectory, { recursive: true, mode: 0o700 });
  for (const directory of [worktree, join(worktree, ".ingenium"), uploadDirectory]) {
    chmodSync(directory, 0o700);
  }
  previousWorktree = process.env.INGENIUM_WORKTREE;
  process.env.INGENIUM_WORKTREE = worktree;
  mockApi.postOctetStream.mockReset();
  mockApi.postOctetStream.mockResolvedValue({
    ok: true,
    status: 201,
    data: {
      snapshotHash: "a".repeat(64),
      appended: 2,
      revision: 2,
      created: true,
      adopted: false,
      idempotent: false,
      conversation: { id: existingConversationId, revision: 2, message_count: 2 },
    },
  });
});

afterEach(() => {
  if (previousWorktree === undefined) delete process.env.INGENIUM_WORKTREE;
  else process.env.INGENIUM_WORKTREE = previousWorktree;
  if (fixtureRoot) rmSync(fixtureRoot, { recursive: true, force: true });
  fixtureRoot = "";
  worktree = "";
  uploadDirectory = "";
  vi.clearAllMocks();
});

describe("context file upload", () => {
  it("filters 1,000+ OpenCode export messages to ordered visible user/complete-assistant text and posts one snapshot", async () => {
    const messages: unknown[] = [];
    for (let index = 0; index < 500; index += 1) {
      messages.push({
        info: { id: `user-${index}`, role: "user" },
        parts: [
          { type: "text", text: `user ${index}` },
          { type: "file", text: "must not import file data" },
        ],
      });
      messages.push({
        info: { id: `assistant-${index}`, role: "assistant", time: { completed: index + 1 } },
        parts: [
          { type: "reasoning", text: "must not import reasoning" },
          { type: "tool", text: "must not import tool data" },
          { type: "text", text: `assistant ${index}` },
          { type: "text", text: "ignored output", ignored: true },
        ],
      });
    }
    messages.push({
      info: { id: "incomplete", role: "assistant" },
      parts: [{ type: "text", text: "must not import incomplete assistant" }],
    });
    messages.push({
      info: { id: "synthetic", role: "user", synthetic: true },
      parts: [{ type: "text", text: "must not import synthetic output" }],
    });
    const input = writeUpload("opencode-export.json", JSON.stringify({ info: { id: "session" }, messages }));

    const result = await uploadContextFile(project, session, input, { tags: ["export", "export"], priority: 7 }, project);

    expect(mockApi.postOctetStream).toHaveBeenCalledTimes(1);
    expect(mockApi.postOctetStream.mock.calls[0]?.[0]).toBe("/context/conversations/import");
    expect(mockApi.postOctetStream.mock.calls[0]?.[2]).toEqual({ project });
    const body = snapshotBody(mockApi.postOctetStream.mock.calls[0]?.[1] as Uint8Array);
    expect(body.sourceKey).toBe("context-upload-file:export-session-001");
    expect(body.sourceSessionId).toBe(session);
    expect(body.tags).toEqual(["export"]);
    expect(body.priority).toBe(7);
    expect(body.entries).toHaveLength(1_000);
    const entries = body.entries as Array<{ role: string; content: string }>;
    expect(entries[0]).toMatchObject({ role: "user", content: "user 0" });
    expect(entries[1]).toMatchObject({ role: "assistant", content: "assistant 0" });
    expect(JSON.stringify(entries)).not.toContain("reasoning");
    expect(JSON.stringify(entries)).not.toContain("tool data");
    expect(JSON.stringify(entries)).not.toContain("incomplete assistant");
    expect(JSON.stringify(entries)).not.toContain("synthetic output");

    const resultData = resultBody(result);
    expect(resultData).toMatchObject({
      sourceKey: "context-upload-file:export-session-001",
      sourceSessionId: session,
      entryCount: 1_000,
      conversation: { id: existingConversationId, revision: 2 },
    });
    expect(resultData.snapshotHash).toBe(body.snapshotHash);
    expect(JSON.stringify(resultData)).not.toContain("user 0");
    expect(JSON.stringify(resultData)).not.toContain(input);
  });

  it("accepts Thread-like JSONL entries and uses deterministic Context snapshot fields", () => {
    const input = writeUpload("thread.jsonl", [
      JSON.stringify({ id: "thread-user", role: "user", content: "A Thread user message" }),
      JSON.stringify({ id: "thread-assistant", author: { role: "assistant" }, message: { text: "A Thread assistant response" } }),
    ].join("\n"));

    const first = prepareContextUploadSnapshot(project, session, input, {});
    const second = prepareContextUploadSnapshot(project, session, input, {});
    const body = snapshotBody(first.bytes);

    expect(first.format).toBe("jsonl");
    expect(first.snapshotHash).toBe(second.snapshotHash);
    expect(first.sourceKey).toBe("context-upload-file:export-session-001");
    expect(body.existingConversationId).toBeUndefined();
    expect(body.entries).toMatchObject([
      { role: "user", content: "A Thread user message" },
      { role: "assistant", content: "A Thread assistant response" },
    ]);
  });

  it("includes an explicitly targeted existing conversation in the single snapshot", () => {
    const input = writeUpload("conversation.md", "# Imported\n\nUse this conversation.");
    const snapshot = prepareContextUploadSnapshot(project, session, input, { conversationId: existingConversationId });
    const body = snapshotBody(snapshot.bytes);

    expect(body.existingConversationId).toBe(existingConversationId);
    expect(body.snapshotHash).toBe(snapshot.snapshotHash);
  });

  it.each([
    ["malformed.json", "{not json", "CONTEXT_UPLOAD_PARSE_FAILED"],
    ["empty.jsonl", "\n\n", "CONTEXT_UPLOAD_PARSE_FAILED"],
  ])("rejects malformed input without making an API call", (name, content, code) => {
    const input = writeUpload(name, content);

    expect(() => prepareContextUploadSnapshot(project, session, input)).toThrow(ContextUploadFileError);
    try {
      prepareContextUploadSnapshot(project, session, input);
    } catch (error) {
      expect((error as ContextUploadFileError).code).toBe(code);
    }
    expect(mockApi.postOctetStream).not.toHaveBeenCalled();
  });

  it("rejects oversized, traversal, insecure-mode, symlink, and hardlink inputs before upload", () => {
    const oversized = writeUpload("oversized.txt", Buffer.alloc(CONTEXT_UPLOAD_MAX_FILE_BYTES + 1, "x"));
    const safe = writeUpload("safe.txt", "safe content");
    const traversal = `${uploadDirectory}/../safe.txt`;
    const insecure = writeUpload("insecure.txt", "insecure", 0o644);
    const symlink = fixturePath("link.txt");
    symlinkSync(safe, symlink);
    const hardlink = fixturePath("hardlink.txt");
    linkSync(safe, hardlink);

    for (const input of [oversized, traversal, insecure, symlink, hardlink]) {
      expect(() => prepareContextUploadSnapshot(project, session, input)).toThrow(ContextUploadFileError);
    }
    expect(mockApi.postOctetStream).not.toHaveBeenCalled();
  });

  it("fails closed when the launcher binding differs and sanitizes API metadata", async () => {
    const input = writeUpload("safe.md", "Only this text is importable.");
    const mismatch = await uploadContextFile(project, session, input, {}, "other-project");
    expect(resultBody(mismatch)).toEqual({ error: { code: "PROJECT_IDENTITY_REQUIRED" } });
    expect(mockApi.postOctetStream).not.toHaveBeenCalled();

    mockApi.postOctetStream.mockResolvedValueOnce({
      ok: true,
      status: 201,
      data: {
        appended: 1,
        conversation: { id: existingConversationId, revision: 1, content: "secret response text" },
        content: "secret response text",
        internalPath: "/not/returned",
      },
    });
    const result = await uploadContextFile(project, session, input, {}, project);
    const output = JSON.stringify(resultBody(result));
    expect(output).toContain(existingConversationId);
    expect(output).not.toContain("secret response text");
    expect(output).not.toContain("/not/returned");
    expect(output).not.toContain(input);
  });
});
