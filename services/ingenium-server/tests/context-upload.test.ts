import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  chmodSync,
  closeSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  rmSync,
  statSync,
  symlinkSync,
  truncateSync,
  writeFileSync,
  writeSync,
} from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { performance } from "node:perf_hooks";

const mockApi = {
  postOctetStream: vi.fn(),
};

vi.mock("../lib/client.js", () => ({ api: { settled: mockApi } }));

const {
  CONTEXT_UPLOAD_MAX_FILE_BYTES,
  CONTEXT_UPLOAD_MAX_OPENCODE_EXPORT_BYTES,
  CONTEXT_UPLOAD_TIMING_MAX_STAGE_MS,
  CONTEXT_UPLOAD_TIMING_MAX_TOTAL_MS,
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

function writeOversizedUpload(name: string, limit: number): string {
  const path = writeUpload(name, "x");
  truncateSync(path, limit + 1);
  return path;
}

function writeGeneratedLargeOpenCodeExport(name: string): string {
  const path = fixturePath(name);
  const descriptor = openSync(path, "w", 0o600);
  const ignoredPayload = "large non-visible payload ".padEnd(36 * 1024, "x");
  let first = true;
  const writeMessage = (message: unknown) => {
    writeSync(descriptor, `${first ? "" : ","}${JSON.stringify(message)}`);
    first = false;
  };

  try {
    writeSync(descriptor, '{"info":{"id":"large-export"},"messages":[');
    for (let index = 0; index < 500; index += 1) {
      writeMessage({
        info: { id: `large-user-${index}`, role: "user" },
        parts: [
          { type: "text", text: `visible user ${index}` },
          { type: "file", content: `file payload ${index}` },
        ],
      });
      writeMessage({
        info: { id: `large-assistant-${index}`, role: "assistant", time: { completed: index + 1 } },
        parts: [
          { type: "text", text: `visible assistant ${index}` },
          { type: "reasoning", text: ignoredPayload },
          { type: "tool", input: ignoredPayload },
          { type: "patch", patch: ignoredPayload },
          { type: "step-start", name: "step" },
          { type: "step-finish", status: "completed" },
          { type: "compaction", content: "compaction state" },
          { type: "agent", name: "subagent" },
        ],
      });
    }
    for (let index = 0; index < 2; index += 1) {
      writeMessage({
        info: { id: `large-incomplete-${index}`, role: "assistant" },
        parts: [
          { type: "text", text: `must not import incomplete assistant ${index}` },
          { type: "reasoning", reasoningEncryptedContent: ignoredPayload },
        ],
      });
    }
    writeSync(descriptor, "]}");
  } finally {
    closeSync(descriptor);
  }
  chmodSync(path, 0o600);
  return path;
}

function snapshotBody(bytes: Uint8Array): Record<string, unknown> {
  return JSON.parse(Buffer.from(bytes).toString("utf8")) as Record<string, unknown>;
}

function resultBody(result: { content: Array<{ text: string }> }): Record<string, unknown> {
  return JSON.parse(result.content[0]!.text) as Record<string, unknown>;
}

function timingBody(result: Record<string, unknown>): Record<string, unknown> {
  const metadata = result.metadata as Record<string, unknown>;
  return metadata.timing as Record<string, unknown>;
}

function expectBoundedTiming(timing: Record<string, unknown>): void {
  const stages = [
    "pathOpenStatReadMs",
    "parseFilterSnapshotPreparationMs",
    "apiRequestMs",
  ] as const;
  expect(timing.totalMs).toEqual(expect.any(Number));
  for (const [key, duration] of Object.entries(timing)) {
    expect(duration).toEqual(expect.any(Number));
    expect(Number.isInteger(duration)).toBe(true);
    expect(duration as number).toBeGreaterThanOrEqual(0);
    expect(duration as number).toBeLessThanOrEqual(
      key === "totalMs" ? CONTEXT_UPLOAD_TIMING_MAX_TOTAL_MS : CONTEXT_UPLOAD_TIMING_MAX_STAGE_MS,
    );
  }
  expect(timing.totalMs as number).toBeGreaterThanOrEqual(
    stages.reduce((total, stage) => total + (timing[stage] as number), 0),
  );
}

const markerAliases = ["hidden", "synthetic", "ignored", "ignore"] as const;
const markerValues: ReadonlyArray<{ label: string; value: unknown; visible: boolean }> = [
  { label: "missing", value: undefined, visible: true },
  { label: "false", value: false, visible: true },
  { label: "zero", value: 0, visible: true },
  { label: "string false", value: "false", visible: true },
  { label: "string zero", value: "0", visible: true },
  { label: "true", value: true, visible: false },
  { label: "one", value: 1, visible: false },
  { label: "string true", value: "true", visible: false },
  { label: "string one", value: "1", visible: false },
  { label: "null", value: null, visible: false },
  { label: "unexpected string", value: "visible", visible: false },
  { label: "object", value: { unexpected: true }, visible: false },
];
const markerTargets = ["envelope", "info", "part", "record", "message", "author"] as const;
type MarkerAlias = typeof markerAliases[number];
type MarkerTarget = typeof markerTargets[number];

function applyMarker(record: Record<string, unknown>, alias: MarkerAlias, value: unknown): void {
  if (value !== undefined) record[alias] = value;
}

function markerFixture(target: MarkerTarget, alias: MarkerAlias, value: unknown): unknown {
  if (target === "envelope" || target === "info" || target === "part") {
    const candidateEnvelope: Record<string, unknown> = {
      info: { id: "candidate-opencode", role: "user" },
      parts: [{ type: "text", text: "candidate visible" }],
    };
    const candidateInfo = candidateEnvelope.info as Record<string, unknown>;
    const candidatePart = (candidateEnvelope.parts as Array<Record<string, unknown>>)[0]!;
    applyMarker(
      target === "envelope" ? candidateEnvelope : target === "info" ? candidateInfo : candidatePart,
      alias,
      value,
    );
    return {
      info: { id: "marker-opencode-session" },
      messages: [
        { info: { id: "baseline-opencode", role: "user" }, parts: [{ type: "text", text: "baseline visible" }] },
        candidateEnvelope,
      ],
    };
  }

  const candidate: Record<string, unknown> = {
    id: "candidate-simple",
    role: "user",
    content: "candidate visible",
  };
  if (target === "message") {
    delete candidate.content;
    candidate.message = { text: "candidate visible" };
    applyMarker(candidate.message as Record<string, unknown>, alias, value);
  } else if (target === "author") {
    delete candidate.role;
    delete candidate.content;
    candidate.author = { role: "user" };
    candidate.message = { text: "candidate visible" };
    applyMarker(candidate.author as Record<string, unknown>, alias, value);
  } else {
    applyMarker(candidate, alias, value);
  }
  return {
    entries: [
      { id: "baseline-simple", role: "user", content: "baseline visible" },
      candidate,
    ],
  };
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

  it("imports a generated 52+ MiB OpenCode export as one bounded visible snapshot", async () => {
    const input = writeGeneratedLargeOpenCodeExport("large-opencode-export.json");
    const rawBytes = statSync(input).size;
    const heapBeforeImport = process.memoryUsage().heapUsed;
    const startedAt = performance.now();

    const result = await uploadContextFile(project, session, input, {}, project);
    const elapsedMs = performance.now() - startedAt;

    expect(rawBytes).toBeGreaterThanOrEqual(52 * 1024 * 1024);
    expect(rawBytes).toBeLessThanOrEqual(CONTEXT_UPLOAD_MAX_OPENCODE_EXPORT_BYTES);
    expect(elapsedMs).toBeLessThan(20_000);
    expect(process.memoryUsage().heapUsed - heapBeforeImport)
      .toBeLessThan(CONTEXT_UPLOAD_MAX_OPENCODE_EXPORT_BYTES * 8);
    expect(mockApi.postOctetStream).toHaveBeenCalledTimes(1);

    const body = snapshotBody(mockApi.postOctetStream.mock.calls[0]?.[1] as Uint8Array);
    const entries = body.entries as Array<{ role: string; content: string }>;
    const snapshot = JSON.stringify(body);
    expect(entries).toHaveLength(1_000);
    expect(entries[0]).toMatchObject({ role: "user", content: "visible user 0" });
    expect(entries[1]).toMatchObject({ role: "assistant", content: "visible assistant 0" });
    expect(snapshot).not.toContain("large non-visible payload");
    expect(snapshot).not.toContain("must not import incomplete assistant");
    expect(Buffer.byteLength(snapshot)).toBeLessThanOrEqual(CONTEXT_UPLOAD_MAX_FILE_BYTES);
    expect(resultBody(result)).toMatchObject({ entryCount: 1_000, format: "opencode" });
  }, 30_000);

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

  it.each(markerAliases.flatMap((alias) => markerValues.flatMap((marker) => (
    markerTargets.map((target) => ({ alias, target, ...marker }))
  ))))(
    "fails closed for $target $alias marker with $label value",
    ({ alias, target, value, visible }) => {
      const input = writeUpload(
        `marker-${target}-${alias}.json`,
        JSON.stringify(markerFixture(target, alias, value)),
      );

      const body = snapshotBody(prepareContextUploadSnapshot(project, session, input).bytes);
      const contents = (body.entries as Array<{ content: string }>).map((entry) => entry.content);
      expect(contents).toEqual(visible
        ? ["baseline visible", "candidate visible"]
        : ["baseline visible"]);
    },
  );

  it("includes an explicitly targeted existing conversation in the single snapshot", () => {
    const input = writeUpload("conversation.md", "# Imported\n\nUse this conversation.");
    const snapshot = prepareContextUploadSnapshot(project, session, input, { conversationId: existingConversationId });
    const body = snapshotBody(snapshot.bytes);

    expect(body.existingConversationId).toBe(existingConversationId);
    expect(body.snapshotHash).toBe(snapshot.snapshotHash);
  });

  it("returns bounded metadata-only timings for initial and replay responses", async () => {
    const input = writeUpload("timed.md", "Only visible timing fixture text.");
    mockApi.postOctetStream
      .mockResolvedValueOnce({
        ok: true,
        status: 201,
        data: {
          appended: 1,
          revision: 1,
          created: true,
          adopted: false,
          idempotent: false,
          timing: {
            bodyReadMs: 3.9,
            coreImportMs: 7,
            path: input,
            content: "must not be returned",
            sourceSessionId: session,
            token: "must-not-be-returned",
            jsonValidationMs: -1,
          },
          coreTiming: {
            validationMs: 5,
            transactionMs: 9,
            path: input,
            sessionId: session,
          },
        },
      })
      .mockResolvedValueOnce({
        ok: true,
        status: 200,
        data: {
          appended: 0,
          revision: 1,
          created: false,
          adopted: false,
          idempotent: true,
          metadata: {
            timing: {
              jsonValidationMs: 2,
              coreImportMs: 0,
              sessionId: session,
              token: "must-not-be-returned",
            },
          },
        },
      });

    const initial = resultBody(await uploadContextFile(project, session, input, {}, project));
    const replay = resultBody(await uploadContextFile(project, session, input, {}, project));
    const initialTiming = timingBody(initial);
    const replayTiming = timingBody(replay);

    expect(mockApi.postOctetStream).toHaveBeenCalledTimes(2);
    expect(initial).toMatchObject({ idempotent: false, created: true });
    expect(replay).toMatchObject({ idempotent: true, created: false });
    expect(initialTiming).toMatchObject({
      apiBodyReadMs: 3,
      apiCoreImportMs: 7,
      coreValidationMs: 5,
      coreTransactionMs: 9,
    });
    expect(replayTiming).toMatchObject({ apiJsonValidationMs: 2, apiCoreImportMs: 0 });
    expectBoundedTiming(initialTiming);
    expectBoundedTiming(replayTiming);
    for (const timing of [initialTiming, replayTiming]) {
      const serialized = JSON.stringify(timing);
      expect(serialized).not.toContain(input);
      expect(serialized).not.toContain(session);
      expect(serialized).not.toContain("must-not-be-returned");
      expect(timing).not.toHaveProperty("path");
      expect(timing).not.toHaveProperty("content");
      expect(timing).not.toHaveProperty("sourceSessionId");
      expect(timing).not.toHaveProperty("token");
    }
  });

  it.each([
    ["truncated streaming reasoning", "truncated-opencode-export.json", [
      '{"info":{"id":"session"},"messages":[',
      '{"info":{"id":"user","role":"user"},"parts":[{"type":"text","text":"visible user"}]},',
      '{"info":{"id":"assistant","role":"assistant","finish":"stop"},"parts":[{"type":"text","text":"completed assistant"}]},',
      '{"info":{"id":"incomplete","role":"assistant"},"parts":[{"type":"reasoning","reasoningEncryptedContent":"unterminated',
    ].join("")],
    ["truncated assistant envelope", "truncated-opencode-assistant-envelope.json", [
      '{"info":{"id":"session"},"messages":[',
      '{"info":{"id":"user","role":"user"},"parts":[{"type":"text","text":"visible user"}]},',
      '{"info":{"id":"assistant","role":"assistant","finish":"stop"},"parts":[{"type":"text","text":"completed assistant"}]},',
      '{"info":{"id":"incomplete","role":"assistant","sessionID"',
    ].join("")],
    ["truncated user envelope", "truncated-opencode-user-envelope.json", [
      '{"info":{"id":"session"},"messages":[',
      '{"info":{"id":"user","role":"user"},"parts":[{"type":"text","text":"visible user"}]},',
      '{"info":{"id":"incomplete","role":"user","sessionID"',
    ].join("")],
  ])("rejects %s instead of recovering a partial snapshot", (_description, name, content) => {
    const input = writeUpload(name, content);
    let caught: unknown;
    try {
      prepareContextUploadSnapshot(project, session, input);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ContextUploadFileError);
    expect((caught as ContextUploadFileError).code).toBe("CONTEXT_UPLOAD_PARSE_FAILED");
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

  it("keeps the 8 MiB limit for simple JSON, JSONL, Markdown, and text inputs", () => {
    const oversizedSimpleJson = writeUpload("oversized-simple.json", JSON.stringify({
      entries: [{ role: "user", content: "x".repeat(CONTEXT_UPLOAD_MAX_FILE_BYTES) }],
    }));
    const oversizedJsonl = writeOversizedUpload("oversized.jsonl", CONTEXT_UPLOAD_MAX_FILE_BYTES);
    const oversizedMarkdown = writeOversizedUpload("oversized.md", CONTEXT_UPLOAD_MAX_FILE_BYTES);
    const oversizedText = writeOversizedUpload("oversized.txt", CONTEXT_UPLOAD_MAX_FILE_BYTES);

    for (const input of [oversizedSimpleJson, oversizedJsonl, oversizedMarkdown, oversizedText]) {
      let caught: unknown;
      try {
        prepareContextUploadSnapshot(project, session, input);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(ContextUploadFileError);
      expect((caught as ContextUploadFileError).code).toBe("CONTEXT_UPLOAD_TOO_LARGE");
    }
  });

  it("rejects a raw OpenCode JSON candidate over 64 MiB before JSON parsing", () => {
    const oversized = writeOversizedUpload("oversized-opencode-export.json", CONTEXT_UPLOAD_MAX_OPENCODE_EXPORT_BYTES);
    const parse = vi.spyOn(JSON, "parse");
    let caught: unknown;
    try {
      prepareContextUploadSnapshot(project, session, oversized);
    } catch (error) {
      caught = error;
    } finally {
      parse.mockRestore();
    }

    expect(caught).toBeInstanceOf(ContextUploadFileError);
    expect((caught as ContextUploadFileError).code).toBe("CONTEXT_UPLOAD_TOO_LARGE");
    expect(parse).not.toHaveBeenCalled();
  });

  it("rejects traversal, insecure-mode, symlink, and hardlink inputs before upload", () => {
    const safe = writeUpload("safe.txt", "safe content");
    const traversal = `${uploadDirectory}/../safe.txt`;
    const insecure = writeUpload("insecure.txt", "insecure", 0o644);
    const symlink = fixturePath("link.txt");
    symlinkSync(safe, symlink);
    const hardlink = fixturePath("hardlink.txt");
    linkSync(safe, hardlink);

    for (const input of [traversal, insecure, symlink, hardlink]) {
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

  it("preserves sanitized error results without timing metadata or retries", async () => {
    const input = writeUpload("unavailable.md", "Only this text is importable.");
    mockApi.postOctetStream.mockRejectedValueOnce(new Error(`token=secret path=${input} session=${session}`));

    const unavailable = resultBody(await uploadContextFile(project, session, input, {}, project));
    expect(unavailable).toEqual({ error: { code: "CONTEXT_UPLOAD_UNAVAILABLE" } });
    expect(mockApi.postOctetStream).toHaveBeenCalledTimes(1);
    const serialized = JSON.stringify(unavailable);
    expect(serialized).not.toContain(input);
    expect(serialized).not.toContain(session);
    expect(serialized).not.toContain("secret");
    expect(unavailable).not.toHaveProperty("metadata");
  });
});
