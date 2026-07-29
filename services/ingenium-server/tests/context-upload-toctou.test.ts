import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { chmodSync, mkdirSync, mkdtempSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";

const race = vi.hoisted(() => ({
  enabled: false,
  target: "",
  replacement: "",
}));

vi.mock("node:fs", async (importOriginal) => {
  const actual = await importOriginal<typeof import("node:fs")>();
  return {
    ...actual,
    openSync(path: string | Buffer | URL, flags: number) {
      if (race.enabled && typeof path === "string" && path === race.target) {
        race.enabled = false;
        renameSync(race.replacement, race.target);
      }
      return actual.openSync(path, flags);
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
  race.enabled = false;
  race.target = "";
  race.replacement = "";
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
    race.enabled = true;

    let caught: unknown;
    try {
      prepareContextUploadSnapshot(project, "race-session", source);
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(ContextUploadFileError);
    expect((caught as ContextUploadFileError).code).toBe("CONTEXT_UPLOAD_FILE_REJECTED");
  });
});
