import { describe, it, expect, beforeAll, afterAll } from "vitest";
import {
  existsSync,
  linkSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  renameSync,
  rmSync,
  symlinkSync,
  unlinkSync,
  writeFileSync,
} from "node:fs";
import { execFileSync } from "node:child_process";
import { createServer } from "node:net";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { getDb, resetDbForTest } from "../lib/db.js";
import { createProject } from "../lib/tools/projects.js";
import {
  createCommand,
  getCommand,
  listCommands,
  updateCommand,
  deleteCommand,
  configureCommandFilesystemTestHookForTesting,
} from "../lib/tools/commands.js";
import { getCommandsBase } from "../lib/tools/paths.js";

let tempDir: string;
let projectId: string;

beforeAll(() => {
  tempDir = mkdtempSync(join(tmpdir(), "ingenium-test-commands-"));
  mkdirSync(join(tempDir, ".ingenium"));
  process.env.INGENIUM_CORE_DB_PATH = join(tempDir, ".ingenium", "data");
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

  it("keeps one create result and file when the checkpoint threshold is reached", () => {
    resetDbForTest();
    const prefix = `threshold-create-${Date.now()}`;
    for (let index = 0; index < 49; index += 1) {
      createCommand(projectId, `${prefix}-filler-${index}`, `${prefix}-filler-${index}.md`);
    }

    const name = `${prefix}-target`;
    const filePath = `${name}.md`;
    try {
      expect(() => createCommand(projectId, name, filePath, "created once")).not.toThrow();
      expect(listCommands(projectId).filter((command) => command.name === name)).toHaveLength(1);
      expect(readFileSync(join(getCommandsBase(projectId), filePath), "utf8")).toBe("created once");
    } finally {
      rmSync(join(getCommandsBase(projectId), filePath), { force: true });
    }
  });

  it("keeps one update result and one relocated file at the checkpoint threshold", () => {
    resetDbForTest();
    const prefix = `threshold-update-${Date.now()}`;
    for (let index = 0; index < 48; index += 1) {
      createCommand(projectId, `${prefix}-filler-${index}`, `${prefix}-filler-${index}.md`);
    }

    const name = `${prefix}-target`;
    const oldPath = `${name}-old.md`;
    const newPath = `${name}-new.md`;
    createCommand(projectId, name, oldPath, "moved once");
    try {
      expect(() => updateCommand(projectId, name, { file_path: newPath })).not.toThrow();
      expect(listCommands(projectId).filter((command) => command.name === name)).toHaveLength(1);
      expect(getCommand(projectId, name)).toMatchObject({ file_path: newPath, content: "moved once" });
      expect(existsSync(join(getCommandsBase(projectId), oldPath))).toBe(false);
      expect(readFileSync(join(getCommandsBase(projectId), newPath), "utf8")).toBe("moved once");
    } finally {
      rmSync(join(getCommandsBase(projectId), oldPath), { force: true });
      rmSync(join(getCommandsBase(projectId), newPath), { force: true });
    }
  });

  it("keeps the database delete and file delete consistent at the checkpoint threshold", () => {
    resetDbForTest();
    const prefix = `threshold-delete-${Date.now()}`;
    for (let index = 0; index < 48; index += 1) {
      createCommand(projectId, `${prefix}-filler-${index}`, `${prefix}-filler-${index}.md`);
    }

    const name = `${prefix}-target`;
    const filePath = `${name}.md`;
    createCommand(projectId, name, filePath, "deleted once");
    try {
      expect(() => deleteCommand(projectId, name)).not.toThrow();
      expect(listCommands(projectId).filter((command) => command.name === name)).toHaveLength(0);
      expect(existsSync(join(getCommandsBase(projectId), filePath))).toBe(false);
    } finally {
      rmSync(join(getCommandsBase(projectId), filePath), { force: true });
    }
  });

  it("normalizes the supported command prefix while rejecting noncanonical components", () => {
    const name = `legacy-${Date.now()}`;
    const created = createCommand(projectId, name, `.opencode/commands/${name}.md`, "legacy");
    expect(created.file_path).toBe(`.opencode/commands/${name}.md`);
    expect(readFileSync(join(getCommandsBase(projectId), `${name}.md`), "utf8")).toBe("legacy");

    const moved = updateCommand(projectId, name, {
      file_path: `opencode/commands/${name}-moved.md`,
    });
    expect(moved?.file_path).toBe(`.opencode/commands/${name}-moved.md`);
    expect(existsSync(join(getCommandsBase(projectId), `${name}.md`))).toBe(false);
    expect(readFileSync(join(getCommandsBase(projectId), `${name}-moved.md`), "utf8")).toBe("legacy");

    for (const path of [`./${name}.md`, `nested//${name}.md`, `nested/../${name}.md`, `${name}.md/`]) {
      expect(() => createCommand(projectId, `${name}-${path.length}`, path, "bad")).toThrow();
    }
  });

  it("rejects final and dangling ancestor symlinks without changing outside files or the DB", () => {
    const base = getCommandsBase(projectId);
    const outside = join(tempDir, `outside-${Date.now()}.md`);
    const finalName = `final-symlink-${Date.now()}.md`;
    writeFileSync(outside, "outside stays unchanged");
    symlinkSync(outside, join(base, finalName));
    try {
      expect(() => createCommand(projectId, `final-${Date.now()}`, finalName, "overwrite")).toThrow();
      expect(readFileSync(outside, "utf8")).toBe("outside stays unchanged");
    } finally {
      unlinkSync(join(base, finalName));
    }

    const ancestorName = `dangling-${Date.now()}`;
    const ancestor = join(base, ancestorName);
    symlinkSync(join(tempDir, `missing-${Date.now()}`), ancestor, "dir");
    try {
      expect(() => createCommand(projectId, `ancestor-${Date.now()}`, `${ancestorName}/never.md`, "bad")).toThrow();
    } finally {
      unlinkSync(ancestor);
    }
  });

  it("rejects directories, FIFOs, sockets, and hard links as command destinations", async () => {
    const base = getCommandsBase(projectId);
    const directoryName = `directory-${Date.now()}.md`;
    mkdirSync(join(base, directoryName));
    expect(() => createCommand(projectId, `directory-${Date.now()}`, directoryName, "bad")).toThrow();

    const fifoName = `fifo-${Date.now()}.md`;
    const fifoPath = join(base, fifoName);
    execFileSync("mkfifo", [fifoPath]);
    expect(() => createCommand(projectId, `fifo-${Date.now()}`, fifoName, "bad")).toThrow();

    const outside = join(tempDir, `hardlink-source-${Date.now()}.md`);
    const hardLinkName = `hardlink-${Date.now()}.md`;
    writeFileSync(outside, "outside hard link");
    linkSync(outside, join(base, hardLinkName));
    expect(() => createCommand(projectId, `hardlink-${Date.now()}`, hardLinkName, "bad")).toThrow();
    expect(readFileSync(outside, "utf8")).toBe("outside hard link");

    const socketName = `socket-${Date.now()}.md`;
    const socketPath = join(base, socketName);
    const server = createServer();
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(socketPath, () => resolve());
    });
    try {
      expect(() => createCommand(projectId, `socket-${Date.now()}`, socketName, "bad")).toThrow();
    } finally {
      await new Promise<void>((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
    }
  });

  it("fails a deterministic final-file swap before the DB update and leaves the outside file unchanged", () => {
    const name = `final-swap-${Date.now()}`;
    const filePath = `${name}.md`;
    const base = getCommandsBase(projectId);
    const target = join(base, filePath);
    const outside = join(tempDir, `${name}-outside.md`);
    createCommand(projectId, name, filePath, "original");
    writeFileSync(outside, "outside stays unchanged");

    let swapped = false;
    const restoreHook = configureCommandFilesystemTestHookForTesting((stage, path) => {
      if (!swapped && stage === "after-final-lstat" && path.endsWith(`/${filePath}`)) {
        swapped = true;
        unlinkSync(target);
        symlinkSync(outside, target);
      }
    });
    try {
      expect(() => updateCommand(projectId, name, { content: "updated" })).toThrow();
      expect(getCommand(projectId, name)?.content).toBe("original");
      expect(readFileSync(outside, "utf8")).toBe("outside stays unchanged");
    } finally {
      restoreHook();
      unlinkSync(target);
      writeFileSync(target, "original");
    }
  });

  it("fails a deterministic ancestor swap before the DB update without writing through the new namespace", () => {
    const name = `ancestor-swap-${Date.now()}`;
    const filePath = `nested/${name}.md`;
    const base = getCommandsBase(projectId);
    const opencode = dirname(base);
    const saved = join(tempDir, `.opencode-saved-${Date.now()}`);
    const outside = join(tempDir, `outside-directory-${Date.now()}`);
    createCommand(projectId, name, filePath, "original");
    mkdirSync(outside);
    writeFileSync(join(outside, "sentinel"), "outside stays unchanged");

    let verificationCount = 0;
    let swapped = false;
    const restoreHook = configureCommandFilesystemTestHookForTesting((stage) => {
      if (stage === "before-namespace-verification") verificationCount += 1;
      if (!swapped && verificationCount === 2) {
        swapped = true;
        renameSync(opencode, saved);
        symlinkSync(outside, opencode, "dir");
      }
    });
    try {
      expect(() => updateCommand(projectId, name, { content: "updated" })).toThrow();
      expect(getCommand(projectId, name)?.content).toBe("original");
      expect(readFileSync(join(outside, "sentinel"), "utf8")).toBe("outside stays unchanged");
    } finally {
      restoreHook();
      unlinkSync(opencode);
      renameSync(saved, opencode);
    }
    expect(readFileSync(join(base, filePath), "utf8")).toBe("original");
  });

  it("compensates an atomic file update when the database commit is rejected", () => {
    const name = `compensation-${Date.now()}`;
    const filePath = `${name}.md`;
    const command = createCommand(projectId, name, filePath, "original");
    const trigger = `commands_fail_update_${Date.now()}`;
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH);
    db.exec(
      `CREATE TRIGGER ${trigger} BEFORE UPDATE ON commands
       WHEN NEW.id = '${command.id}'
       BEGIN SELECT RAISE(ABORT, 'forced command update failure'); END`,
    );
    try {
      expect(() => updateCommand(projectId, name, { content: "updated" })).toThrow("forced command update failure");
      expect(getCommand(projectId, name)).toMatchObject({ content: "original", file_path: filePath });
      expect(readFileSync(join(getCommandsBase(projectId), filePath), "utf8")).toBe("original");
    } finally {
      db.exec(`DROP TRIGGER IF EXISTS ${trigger}`);
    }
  });

  it("rejects a symlinked command root without changing its target", () => {
    const base = getCommandsBase(projectId);
    const outside = join(tempDir, `root-outside-${Date.now()}`);
    mkdirSync(outside);
    writeFileSync(join(outside, "sentinel"), "outside stays unchanged");
    rmSync(base, { recursive: true, force: true });
    symlinkSync(outside, base, "dir");
    try {
      expect(() => createCommand(projectId, `root-${Date.now()}`, `root-${Date.now()}.md`, "bad")).toThrow();
      expect(readFileSync(join(outside, "sentinel"), "utf8")).toBe("outside stays unchanged");
    } finally {
      unlinkSync(base);
      mkdirSync(base, { recursive: true });
    }
  });

  it("rejects unsafe stored paths before filesystem or DB mutation", () => {
    const outside = join(tempDir, `stored-outside-${Date.now()}.md`);
    writeFileSync(outside, "outside stays unchanged");
    const name = `unsafe-stored-${Date.now()}`;
    const now = new Date().toISOString();
    getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      `INSERT INTO commands (id, project_id, name, file_path, content, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?)`,
    ).run(`cmd-${name}`, projectId, name, "../../stored-outside.md", "bad", now, now);

    expect(() => deleteCommand(projectId, name)).toThrow("invalid command file path");
    expect(readFileSync(outside, "utf8")).toBe("outside stays unchanged");
    expect(getDb(process.env.INGENIUM_CORE_DB_PATH).prepare(
      "SELECT count(*) AS count FROM commands WHERE id = ?",
    ).get(`cmd-${name}`)).toMatchObject({ count: 1 });
  });
});
