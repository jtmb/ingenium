import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createProject } from "../lib/tools/projects.js";
import {
  createCommand,
  getCommand,
  listCommands,
  updateCommand,
  deleteCommand,
} from "../lib/tools/commands.js";

let tempDir: string;
let projectId: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-test-commands-"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, "test.db");
  const project = createProject("test-project");
  projectId = project.id;
});

afterAll(() => {
  rmSync(tempDir, { recursive: true, force: true });
});

describe("commands CRUD", () => {
  it("creates a command and lists it", () => {
    const cmd = createCommand(projectId, "hello-cmd", "hello-cmd.sh", "echo hello");
    expect(cmd.name).toBe("hello-cmd");
    expect(cmd.file_path).toBe("hello-cmd.sh");
    expect(cmd.content).toBe("echo hello");
    expect(cmd.project_id).toBe(projectId);
    expect(cmd.id).toBeTruthy();
    expect(cmd.created_at).toBeTruthy();
    expect(cmd.updated_at).toBeTruthy();

    const all = listCommands(projectId);
    expect(all.some((c) => c.name === "hello-cmd")).toBe(true);
  });

  it("retrieves a command by name", () => {
    createCommand(projectId, "get-me", "get-me.sh", "# Get test");
    const cmd = getCommand(projectId, "get-me");
    expect(cmd).not.toBeUndefined();
    expect(cmd!.name).toBe("get-me");
    expect(cmd!.file_path).toBe("get-me.sh");
    expect(cmd!.content).toBe("# Get test");
  });

  it("throws on duplicate command name (UNIQUE constraint)", () => {
    createCommand(projectId, "uniq-cmd", "uniq.sh", "first");
    expect(() => createCommand(projectId, "uniq-cmd", "uniq.sh", "second")).toThrow();
  });

  it("updates command content", () => {
    createCommand(projectId, "updatable", "updatable.sh", "# Original content");
    const updated = updateCommand(projectId, "updatable", {
      content: "# Updated content",
    });
    expect(updated).not.toBeUndefined();
    expect(updated!.content).toBe("# Updated content");
    expect(updated!.file_path).toBe("updatable.sh"); // unchanged
  });

  it("updates command file_path", () => {
    createCommand(projectId, "relocatable", "old-path.sh", "mv test");
    const updated = updateCommand(projectId, "relocatable", {
      file_path: "new-path.sh",
    });
    expect(updated).not.toBeUndefined();
    expect(updated!.file_path).toBe("new-path.sh");
  });

  it("deletes a command and removes it from list", () => {
    createCommand(projectId, "delete-me", "delete-me.sh", "bye");
    const result = deleteCommand(projectId, "delete-me");
    expect(result).toBe(true);

    const all = listCommands(projectId);
    expect(all.some((c) => c.name === "delete-me")).toBe(false);
    expect(getCommand(projectId, "delete-me")).toBeUndefined();
  });

  it("returns false when deleting a non-existent command", () => {
    const result = deleteCommand(projectId, "i-dont-exist");
    expect(result).toBe(false);
  });

  it("returns undefined for get on non-existent command", () => {
    const cmd = getCommand(projectId, "no-such-command");
    expect(cmd).toBeUndefined();
  });

  it("throws on path traversal", () => {
    expect(() =>
      createCommand(projectId, "traversal", "../../etc/passwd", "evil"),
    ).toThrow();
  });

  it("throws on invalid file path characters", () => {
    expect(() =>
      createCommand(projectId, "bad-path", "inject\x00null", "bad"),
    ).toThrow();
  });

  it("creates command without content", () => {
    const cmd = createCommand(projectId, "no-content-cmd", "empty.md");
    expect(cmd.name).toBe("no-content-cmd");
    expect(cmd.content).toBe(""); // defaults to empty string
  });
});
