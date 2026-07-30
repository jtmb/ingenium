import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const race = vi.hoisted(() => ({
  mode: "none" as "none" | "replace-before-open" | "mutate-before-second-stream",
  target: "",
  replacement: "",
  readCount: 0,
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    openSync(...args: Parameters<typeof actual.openSync>) {
      const [path] = args;
      if (race.mode === "replace-before-open" && typeof path === "string" && path === race.target) {
        race.mode = "none";
        renameSync(race.replacement, race.target);
      }
      return actual.openSync(...args);
    },
    readSync(...args: Parameters<typeof actual.readSync>) {
      race.readCount += 1;
      if (race.mode === "mutate-before-second-stream" && race.readCount === 2) {
        race.mode = "none";
        actual.writeFileSync(race.target, race.replacement);
      }
      return actual.readSync(...args);
    },
  };
});

vi.mock("../lib/client.js", () => ({ api: { postOctetStream: vi.fn() } }));

const { ContextUploadFileError, prepareContextUploadSnapshot } = await import("../lib/tools/context-upload.js");

const project = "context-upload-race";
let root = "";
let priorWorktree: string | undefined;

beforeEach(() => {
  root = mkdtempSync(join(tmpdir(), "ingenium-context-upload-race-"));
  const worktree = join(root, project);
  const uploads = join(worktree, ".ingenium", "context-uploads");
  mkdirSync(uploads, { recursive: true, mode: 0o700 });
  for (const directory of [worktree, join(worktree, ".ingenium"), uploads]) chmodSync(directory, 0o700);
  priorWorktree = process.env.INGENIUM_WORKTREE;
  process.env.INGENIUM_WORKTREE = worktree;
  race.mode = "none";
  race.target = "";
  race.replacement = "";
  race.readCount = 0;
});

afterEach(() => {
  if (priorWorktree === undefined) delete process.env.INGENIUM_WORKTREE;
  else process.env.INGENIUM_WORKTREE = priorWorktree;
  if (root) rmSync(root, { recursive: true, force: true });
  root = "";
});

describe("context upload descriptor TOCTOU defense", () => {
  it("rejects a regular-file replacement between lstat and O_NOFOLLOW descriptor validation", () => {
    const uploads = join(root, project, ".ingenium", "context-uploads");
    const source = join(uploads, "export.md");
    const replacement = join(uploads, "replacement.md");
    writeFileSync(source, "original visible text", { mode: 0o600 });
    writeFileSync(replacement, "replacement visible text", { mode: 0o600 });
    chmodSync(source, 0o600);
    chmodSync(replacement, 0o600);
    race.target = source;
    race.replacement = replacement;
    race.mode = "replace-before-open";

    let caught: unknown;
    try {
      prepareContextUploadSnapshot(project, "race-session", source);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ContextUploadFileError);
    expect((caught as ContextUploadFileError).code).toBe("CONTEXT_UPLOAD_FILE_REJECTED");
  });

  it("rejects same-inode same-size mutation before the descriptor-bound second hash stream", () => {
    const uploads = join(root, project, ".ingenium", "context-uploads");
    const source = join(uploads, "in-place.md");
    const original = "original visible text".padEnd(4_096, "a");
    const replacement = "mutated visible text".padEnd(4_096, "b");
    writeFileSync(source, original, { mode: 0o600 });
    chmodSync(source, 0o600);
    const before = statSync(source, { bigint: true });
    race.target = source;
    race.replacement = replacement;
    race.mode = "mutate-before-second-stream";

    let caught: unknown;
    try {
      prepareContextUploadSnapshot(project, "in-place-race-session", source);
    } catch (error) {
      caught = error;
    }

    const after = statSync(source, { bigint: true });
    expect(race.readCount).toBeGreaterThanOrEqual(2);
    expect(after.dev).toBe(before.dev);
    expect(after.ino).toBe(before.ino);
    expect(after.size).toBe(before.size);
    expect(caught).toBeInstanceOf(ContextUploadFileError);
    expect((caught as ContextUploadFileError).code).toBe("CONTEXT_UPLOAD_FILE_REJECTED");
  });
});
