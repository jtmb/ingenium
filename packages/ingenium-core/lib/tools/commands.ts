import { randomUUID } from "node:crypto";
import {
  closeSync,
  constants,
  fstatSync,
  fsyncSync,
  linkSync,
  lstatSync,
  mkdirSync,
  openSync,
  readFileSync,
  renameSync,
  statSync,
  unlinkSync,
  writeSync,
  type Stats,
} from "node:fs";
import { isAbsolute, relative, resolve, sep } from "node:path";
import { checkpointAfterWrite, execTransaction, getDb } from "../db.js";
import { Command } from "../schema.js";
import { getCommandsBase } from "./paths.js";

const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const FILE_READ_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_NONBLOCK;
const TEMPORARY_PREFIX = ".ingenium-command-tmp-";
const QUARANTINE_PREFIX = ".ingenium-command-quarantine-";

interface FileIdentity {
  readonly dev: number;
  readonly ino: number;
}

interface RegularFile {
  readonly identity: FileIdentity;
  readonly content: Buffer;
}

interface NormalizedCommandPath {
  readonly storagePath: string;
  readonly relativePath: string;
}

interface QuarantinedFile {
  readonly parent: AnchoredDirectory;
  readonly originalName: string;
  readonly quarantineName: string;
  readonly identity: FileIdentity;
}

interface FileChange {
  rollback(): void;
  cleanup(): void;
}

export type CommandFilesystemTestStage =
  | "after-final-lstat"
  | "before-quarantine"
  | "before-publish"
  | "before-namespace-verification";

type CommandFilesystemTestHook = (stage: CommandFilesystemTestStage, path: string) => void;

let commandFilesystemTestHook: CommandFilesystemTestHook | undefined;

/** Test-only seam for deterministic namespace-swap coverage. */
export function configureCommandFilesystemTestHookForTesting(
  hook?: CommandFilesystemTestHook,
): () => void {
  const previous = commandFilesystemTestHook;
  commandFilesystemTestHook = hook;
  return () => {
    commandFilesystemTestHook = previous;
  };
}

function runFilesystemTestHook(stage: CommandFilesystemTestStage, path: string): void {
  commandFilesystemTestHook?.(stage, path);
}

function isErrno(error: unknown, code: string): boolean {
  return typeof error === "object" && error !== null && "code" in error && error.code === code;
}

function identity(stat: Stats): FileIdentity {
  return { dev: Number(stat.dev), ino: Number(stat.ino) };
}

function sameIdentity(left: FileIdentity, right: FileIdentity): boolean {
  return left.dev === right.dev && left.ino === right.ino;
}

function assertDirectory(stat: Stats): void {
  if (!stat.isDirectory() || stat.isSymbolicLink()) throw new Error("unsafe command directory");
}

function assertRegularFile(stat: Stats, allowMultipleLinks = false): void {
  if (!stat.isFile() || stat.isSymbolicLink() || (!allowMultipleLinks && stat.nlink !== 1)) {
    throw new Error("unsafe command file");
  }
}

function isSafeFilesystemComponent(name: string): boolean {
  return name.length > 0 && name !== "." && name !== ".." && !/[\/\u0000]/.test(name);
}

function lstatIfPresent(path: string): Stats | undefined {
  try {
    return lstatSync(path);
  } catch (error) {
    if (isErrno(error, "ENOENT")) return undefined;
    throw error;
  }
}

function assertLinuxAnchorRuntime(): void {
  if (process.platform !== "linux"
    || typeof constants.O_NOFOLLOW !== "number"
    || typeof constants.O_DIRECTORY !== "number") {
    throw new Error("secure command filesystem operations require Linux descriptor anchors");
  }
  try {
    if (!statSync("/proc/self/fd").isDirectory()) throw new Error("unsafe descriptor anchor");
  } catch {
    throw new Error("secure command filesystem operations require /proc/self/fd");
  }
}

function descriptorDirectoryPath(fd: number): string {
  return `/proc/self/fd/${fd}/.`;
}

function descriptorChildPath(fd: number, name: string): string {
  return `/proc/self/fd/${fd}/${name}`;
}

function assertDescriptorAnchor(fd: number, expected: FileIdentity): void {
  const opened = fstatSync(fd);
  assertDirectory(opened);
  if (!sameIdentity(identity(opened), expected)) throw new Error("command directory identity changed");
  const anchored = statSync(descriptorDirectoryPath(fd));
  assertDirectory(anchored);
  if (!sameIdentity(identity(anchored), expected)) throw new Error("unsafe descriptor anchor");
}

function normalizeCommandPath(filePath: unknown): NormalizedCommandPath {
  if (typeof filePath !== "string" || filePath.length === 0 || filePath.length > 1024 || filePath !== filePath.trim()) {
    throw new Error("invalid command file path");
  }

  let candidate = filePath;
  let storagePrefix = "";
  if (candidate.startsWith(".opencode/commands/")) {
    candidate = candidate.slice(".opencode/commands/".length);
    storagePrefix = ".opencode/commands/";
  } else if (candidate.startsWith("opencode/commands/")) {
    candidate = candidate.slice("opencode/commands/".length);
    storagePrefix = ".opencode/commands/";
  }

  if (!candidate || candidate.includes("\\") || isAbsolute(candidate)) {
    throw new Error("invalid command file path");
  }
  const components = candidate.split("/");
  if (components.some((component) => component.length === 0
    || component === "."
    || component === ".."
    || !/^[A-Za-z0-9][A-Za-z0-9._-]*$/.test(component))) {
    throw new Error("invalid command file path");
  }
  if (components.join("/") !== candidate) throw new Error("invalid command file path");
  return {
    storagePath: `${storagePrefix}${candidate}`,
    relativePath: candidate,
  };
}

function commandPathSegments(filePath: string): string[] {
  return normalizeCommandPath(filePath).relativePath.split("/");
}

class AnchoredDirectory {
  private closed = false;

  constructor(
    private readonly fd: number,
    private readonly expectedIdentity: FileIdentity,
  ) {
    assertDescriptorAnchor(fd, expectedIdentity);
  }

  static openAbsolute(path: string): AnchoredDirectory {
    const before = lstatSync(path);
    assertDirectory(before);
    const fd = openSync(path, DIRECTORY_FLAGS);
    try {
      const opened = fstatSync(fd);
      assertDirectory(opened);
      if (!sameIdentity(identity(before), identity(opened))) throw new Error("command directory identity changed");
      return new AnchoredDirectory(fd, identity(opened));
    } catch (error) {
      closeSync(fd);
      throw error;
    }
  }

  assertCurrent(): FileIdentity {
    if (this.closed) throw new Error("command directory descriptor is closed");
    assertDescriptorAnchor(this.fd, this.expectedIdentity);
    return this.expectedIdentity;
  }

  clone(): AnchoredDirectory {
    this.assertCurrent();
    const fd = openSync(descriptorDirectoryPath(this.fd), DIRECTORY_FLAGS);
    try {
      const opened = fstatSync(fd);
      assertDirectory(opened);
      if (!sameIdentity(this.expectedIdentity, identity(opened))) throw new Error("command directory identity changed");
      return new AnchoredDirectory(fd, identity(opened));
    } catch (error) {
      closeSync(fd);
      throw error;
    }
  }

  childPath(name: string): string {
    if (!isSafeFilesystemComponent(name)) throw new Error("invalid command path component");
    this.assertCurrent();
    return descriptorChildPath(this.fd, name);
  }

  fsync(): void {
    this.assertCurrent();
    fsyncSync(this.fd);
  }

  close(): void {
    if (this.closed) return;
    this.closed = true;
    closeSync(this.fd);
  }

  get fileIdentity(): FileIdentity {
    return this.assertCurrent();
  }
}

function openChildDirectory(
  parent: AnchoredDirectory,
  name: string,
  create: boolean,
): AnchoredDirectory | undefined {
  const childPath = parent.childPath(name);
  let before = lstatIfPresent(childPath);
  let created = false;
  if (!before) {
    if (!create) return undefined;
    try {
      mkdirSync(childPath, { mode: 0o700 });
      created = true;
    } catch (error) {
      if (!isErrno(error, "EEXIST")) throw error;
    }
    before = lstatIfPresent(childPath);
    if (!before) throw new Error("command directory disappeared during creation");
  }
  assertDirectory(before);
  if (created) parent.fsync();

  const fd = openSync(childPath, DIRECTORY_FLAGS);
  try {
    const opened = fstatSync(fd);
    assertDirectory(opened);
    if (!sameIdentity(identity(before), identity(opened))) throw new Error("command directory identity changed");
    return new AnchoredDirectory(fd, identity(opened));
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function commandBaseSegments(projectId?: string): string[] {
  const base = resolve(getCommandsBase(projectId));
  if (!isAbsolute(base) || base === sep) throw new Error("invalid command directory");
  const relativeBase = relative(sep, base);
  const segments = relativeBase.split(sep);
  if (segments.some((segment) => !segment || segment === "." || segment === "..")) {
    throw new Error("invalid command directory");
  }
  return segments;
}

function openCommandBase(projectId: string | undefined, create: boolean): AnchoredDirectory | undefined {
  assertLinuxAnchorRuntime();
  let current = AnchoredDirectory.openAbsolute(sep);
  try {
    for (const segment of commandBaseSegments(projectId)) {
      const next = openChildDirectory(current, segment, create);
      current.close();
      if (!next) return undefined;
      current = next;
    }
    return current;
  } catch (error) {
    current.close();
    throw error;
  }
}

function openCommandParent(
  root: AnchoredDirectory,
  filePath: string,
  create: boolean,
): { parent: AnchoredDirectory; name: string } | undefined {
  const segments = commandPathSegments(filePath);
  const name = segments.pop();
  if (!name) throw new Error("invalid command file path");

  let current = root.clone();
  try {
    for (const segment of segments) {
      const next = openChildDirectory(current, segment, create);
      current.close();
      if (!next) return undefined;
      current = next;
    }
    return { parent: current, name };
  } catch (error) {
    current.close();
    throw error;
  }
}

function inspectRegularFile(
  parent: AnchoredDirectory,
  name: string,
  expected?: FileIdentity,
  allowMultipleLinks = false,
): FileIdentity | undefined {
  const path = parent.childPath(name);
  const before = lstatIfPresent(path);
  if (!before) return undefined;
  assertRegularFile(before, allowMultipleLinks);
  if (expected && !sameIdentity(identity(before), expected)) throw new Error("command file identity changed");

  runFilesystemTestHook("after-final-lstat", path);
  const afterHook = lstatIfPresent(path);
  if (!afterHook) throw new Error("command file disappeared during verification");
  assertRegularFile(afterHook, allowMultipleLinks);
  if (!sameIdentity(identity(before), identity(afterHook))
    || (expected && !sameIdentity(identity(afterHook), expected))) {
    throw new Error("command file identity changed");
  }

  const fd = openSync(path, FILE_READ_FLAGS);
  try {
    const opened = fstatSync(fd);
    assertRegularFile(opened, allowMultipleLinks);
    if (!sameIdentity(identity(afterHook), identity(opened))
      || (expected && !sameIdentity(identity(opened), expected))) {
      throw new Error("command file identity changed");
    }
    return identity(opened);
  } finally {
    closeSync(fd);
  }
}

function readRegularFile(
  parent: AnchoredDirectory,
  name: string,
  expected?: FileIdentity,
): RegularFile | undefined {
  const path = parent.childPath(name);
  const before = lstatIfPresent(path);
  if (!before) return undefined;
  assertRegularFile(before);
  if (expected && !sameIdentity(identity(before), expected)) throw new Error("command file identity changed");

  runFilesystemTestHook("after-final-lstat", path);
  const afterHook = lstatIfPresent(path);
  if (!afterHook) throw new Error("command file disappeared during verification");
  assertRegularFile(afterHook);
  if (!sameIdentity(identity(before), identity(afterHook))
    || (expected && !sameIdentity(identity(afterHook), expected))) {
    throw new Error("command file identity changed");
  }

  const fd = openSync(path, FILE_READ_FLAGS);
  try {
    const opened = fstatSync(fd);
    assertRegularFile(opened);
    const openedIdentity = identity(opened);
    if (!sameIdentity(identity(afterHook), openedIdentity)
      || (expected && !sameIdentity(openedIdentity, expected))) {
      throw new Error("command file identity changed");
    }
    const content = readFileSync(fd);
    const afterRead = fstatSync(fd);
    assertRegularFile(afterRead);
    if (!sameIdentity(openedIdentity, identity(afterRead))) throw new Error("command file identity changed");
    return { identity: openedIdentity, content };
  } finally {
    closeSync(fd);
  }
}

function uniqueSiblingName(parent: AnchoredDirectory, prefix: string): string {
  for (let attempt = 0; attempt < 16; attempt += 1) {
    const name = `${prefix}${randomUUID()}`;
    if (!lstatIfPresent(parent.childPath(name))) return name;
  }
  throw new Error("unable to allocate secure command temporary path");
}

function writeAll(fd: number, content: Buffer): void {
  let offset = 0;
  while (offset < content.length) {
    const written = writeSync(fd, content, offset, content.length - offset, null);
    if (written <= 0) throw new Error("unable to write command file");
    offset += written;
  }
}

function writeTemporaryFile(parent: AnchoredDirectory, content: Buffer): { name: string; identity: FileIdentity } {
  const name = uniqueSiblingName(parent, TEMPORARY_PREFIX);
  const path = parent.childPath(name);
  let temporaryIdentity: FileIdentity | undefined;
  const fd = openSync(
    path,
    constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
    0o600,
  );
  try {
    const opened = fstatSync(fd);
    assertRegularFile(opened);
    temporaryIdentity = identity(opened);
    writeAll(fd, content);
    fsyncSync(fd);
    const completed = fstatSync(fd);
    assertRegularFile(completed);
    return { name, identity: identity(completed) };
  } catch (error) {
    try {
      if (temporaryIdentity) unlinkVerifiedFile(parent, name, temporaryIdentity);
    } catch {
      // A failed temporary cleanup is safer than unlinking a replacement path.
    }
    throw error;
  } finally {
    closeSync(fd);
  }
}

function unlinkVerifiedFile(
  parent: AnchoredDirectory,
  name: string,
  expected: FileIdentity,
  allowMultipleLinks = false,
): void {
  const current = inspectRegularFile(parent, name, expected, allowMultipleLinks);
  if (!current) throw new Error("command file disappeared during deletion");
  unlinkSync(parent.childPath(name));
  parent.fsync();
}

function restoreQuarantine(file: QuarantinedFile): void {
  const existing = lstatIfPresent(file.parent.childPath(file.originalName));
  if (existing) throw new Error("command file path changed during compensation");
  const quarantined = inspectRegularFile(file.parent, file.quarantineName, file.identity);
  if (!quarantined) throw new Error("command quarantine disappeared during compensation");
  linkSync(
    file.parent.childPath(file.quarantineName),
    file.parent.childPath(file.originalName),
  );
  try {
    const restored = inspectRegularFile(file.parent, file.originalName, file.identity, true);
    if (!restored) throw new Error("command file restore failed");
    unlinkVerifiedFile(file.parent, file.quarantineName, file.identity, true);
    const final = inspectRegularFile(file.parent, file.originalName, file.identity);
    if (!final) throw new Error("command file restore failed");
  } catch (error) {
    throw error;
  }
}

function discardQuarantine(file: QuarantinedFile): void {
  unlinkVerifiedFile(file.parent, file.quarantineName, file.identity);
}

function quarantineFile(
  parent: AnchoredDirectory,
  name: string,
  expected?: FileIdentity,
): QuarantinedFile | undefined {
  const current = inspectRegularFile(parent, name, expected);
  if (!current) return undefined;
  const quarantineName = uniqueSiblingName(parent, QUARANTINE_PREFIX);
  runFilesystemTestHook("before-quarantine", parent.childPath(name));
  const verified = inspectRegularFile(parent, name, current);
  if (!verified) throw new Error("command file disappeared during quarantine");

  let moved = false;
  const file: QuarantinedFile = { parent, originalName: name, quarantineName, identity: current };
  try {
    renameSync(parent.childPath(name), parent.childPath(quarantineName));
    moved = true;
    const quarantined = inspectRegularFile(parent, quarantineName, current);
    if (!quarantined) throw new Error("command file disappeared during quarantine");
    parent.fsync();
    return file;
  } catch (error) {
    if (moved) {
      try {
        restoreQuarantine(file);
      } catch {
        // Do not delete or replace a path whose identity no longer matches.
      }
    }
    throw error;
  }
}

class NoopChange implements FileChange {
  rollback(): void {}

  cleanup(): void {}
}

class AtomicWriteChange implements FileChange {
  private complete = false;

  constructor(
    private readonly parent: AnchoredDirectory,
    private readonly targetName: string,
    private readonly writtenIdentity: FileIdentity,
    private readonly previous: QuarantinedFile | undefined,
  ) {}

  rollback(): void {
    if (this.complete) return;
    try {
      const written = quarantineFile(this.parent, this.targetName, this.writtenIdentity);
      if (written) discardQuarantine(written);
      if (this.previous) restoreQuarantine(this.previous);
    } finally {
      this.complete = true;
      this.parent.close();
    }
  }

  cleanup(): void {
    if (this.complete) return;
    try {
      if (this.previous) discardQuarantine(this.previous);
    } finally {
      this.complete = true;
      this.parent.close();
    }
  }
}

class AtomicDeleteChange implements FileChange {
  private complete = false;

  constructor(private readonly file: QuarantinedFile) {}

  rollback(): void {
    if (this.complete) return;
    try {
      restoreQuarantine(this.file);
    } finally {
      this.complete = true;
      this.file.parent.close();
    }
  }

  cleanup(): void {
    if (this.complete) return;
    try {
      discardQuarantine(this.file);
    } finally {
      this.complete = true;
      this.file.parent.close();
    }
  }
}

class CompositeChange implements FileChange {
  private complete = false;

  constructor(private readonly changes: FileChange[]) {}

  rollback(): void {
    if (this.complete) return;
    try {
      for (const change of [...this.changes].reverse()) change.rollback();
    } finally {
      this.complete = true;
    }
  }

  cleanup(): void {
    if (this.complete) return;
    try {
      for (const change of this.changes) change.cleanup();
    } finally {
      this.complete = true;
    }
  }
}

class CommandFilesystem {
  private constructor(
    private readonly projectId: string,
    private readonly root: AnchoredDirectory,
  ) {}

  static open(projectId: string, create: boolean): CommandFilesystem | undefined {
    const root = openCommandBase(projectId, create);
    return root ? new CommandFilesystem(projectId, root) : undefined;
  }

  close(): void {
    this.root.close();
  }

  verifyNamespace(): void {
    runFilesystemTestHook("before-namespace-verification", getCommandsBase(this.projectId));
    const current = openCommandBase(this.projectId, false);
    try {
      if (!current || !sameIdentity(this.root.fileIdentity, current.fileIdentity)) {
        throw new Error("command directory identity changed");
      }
    } finally {
      current?.close();
    }
  }

  read(filePath: string): RegularFile | undefined {
    this.verifyNamespace();
    const target = openCommandParent(this.root, filePath, false);
    if (!target) return undefined;
    try {
      const result = readRegularFile(target.parent, target.name);
      this.verifyNamespace();
      return result;
    } finally {
      target.parent.close();
    }
  }

  write(filePath: string, content: Buffer): FileChange {
    this.verifyNamespace();
    const target = openCommandParent(this.root, filePath, true);
    if (!target) throw new Error("command directory is unavailable");

    let previous: QuarantinedFile | undefined;
    let temporary: { name: string; identity: FileIdentity } | undefined;
    let writtenIdentity: FileIdentity | undefined;
    let published = false;
    try {
      previous = quarantineFile(target.parent, target.name);
      temporary = writeTemporaryFile(target.parent, content);
      writtenIdentity = temporary.identity;
      runFilesystemTestHook("before-publish", target.parent.childPath(target.name));
      if (lstatIfPresent(target.parent.childPath(target.name))) {
        throw new Error("command file appeared during atomic write");
      }
      const temp = inspectRegularFile(target.parent, temporary.name, temporary.identity);
      if (!temp) throw new Error("command temporary file disappeared during publish");
      linkSync(target.parent.childPath(temporary.name), target.parent.childPath(target.name));
      published = true;
      const output = inspectRegularFile(target.parent, target.name, temporary.identity, true);
      if (!output) throw new Error("command file publish failed");
      unlinkVerifiedFile(target.parent, temporary.name, temporary.identity, true);
      temporary = undefined;
      const final = inspectRegularFile(target.parent, target.name, output);
      if (!final) throw new Error("command file publish failed");
      published = true;
      target.parent.fsync();
      this.verifyNamespace();
      return new AtomicWriteChange(target.parent, target.name, output, previous);
    } catch (error) {
      try {
        if (temporary) {
          const temp = inspectRegularFile(target.parent, temporary.name, temporary.identity, true);
          if (temp) unlinkVerifiedFile(target.parent, temporary.name, temporary.identity, true);
        }
        if (published) {
          const output = quarantineFile(target.parent, target.name, writtenIdentity);
          if (output) discardQuarantine(output);
        }
        if (previous) restoreQuarantine(previous);
      } finally {
        target.parent.close();
      }
      throw error;
    }
  }

  delete(filePath: string, expected?: FileIdentity): FileChange {
    this.verifyNamespace();
    const target = openCommandParent(this.root, filePath, false);
    if (!target) return new NoopChange();
    let quarantined: QuarantinedFile | undefined;
    try {
      quarantined = quarantineFile(target.parent, target.name, expected);
      if (!quarantined) {
        target.parent.close();
        return new NoopChange();
      }
      this.verifyNamespace();
      return new AtomicDeleteChange(quarantined);
    } catch (error) {
      try {
        if (quarantined) restoreQuarantine(quarantined);
      } finally {
        target.parent.close();
      }
      throw error;
    }
  }

  move(oldPath: string, newPath: string, fallbackContent: Buffer): FileChange {
    const source = this.read(oldPath);
    const destination = this.write(newPath, source?.content ?? fallbackContent);
    if (!source) return destination;
    try {
      const deletion = this.delete(oldPath, source.identity);
      return new CompositeChange([destination, deletion]);
    } catch (error) {
      destination.rollback();
      throw error;
    }
  }

  writeThenDelete(newPath: string, content: Buffer, oldPath: string): FileChange {
    const source = this.read(oldPath);
    const destination = this.write(newPath, content);
    if (!source) return destination;
    try {
      const deletion = this.delete(oldPath, source.identity);
      return new CompositeChange([destination, deletion]);
    } catch (error) {
      destination.rollback();
      throw error;
    }
  }
}

function normalizeCommand(command: Command): Command {
  const filePath = normalizeCommandPath(command.file_path);
  return {
    ...command,
    file_path: filePath.storagePath,
    content: command.content ?? "",
  };
}

function rawCommands(projectId: string): Command[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return db.prepare("SELECT * FROM commands WHERE project_id = ?").all(projectId) as Command[];
}

function rawCommand(projectId: string, name: string): Command | undefined {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
  return db.prepare("SELECT * FROM commands WHERE project_id = ? AND name = ?")
    .get(projectId, name) as Command | undefined;
}

function assertPathAvailable(projectId: string, relativePath: string, excludedId?: string): void {
  for (const command of rawCommands(projectId)) {
    const path = normalizeCommandPath(command.file_path);
    if (path.relativePath === relativePath && command.id !== excludedId) {
      throw new Error("command file path is already registered");
    }
  }
}

function assertUnchanged(current: Command | undefined, expected: Command): void {
  if (!current
    || current.id !== expected.id
    || current.project_id !== expected.project_id
    || current.name !== expected.name
    || current.file_path !== expected.file_path
    || (current.content ?? "") !== (expected.content ?? "")
    || current.updated_at !== expected.updated_at) {
    throw new Error("command changed during filesystem operation");
  }
}

function rollbackChange(change: FileChange | undefined): void {
  if (!change) return;
  change.rollback();
}

function cleanupChange(change: FileChange | undefined): void {
  if (!change) return;
  try {
    change.cleanup();
  } catch {
    // The command file already matches the committed record; retain only a quarantine artifact.
  }
}

/** Ensure the command directory exists without recursively following symlinks. */
export function ensureCommandDir(projectId?: string): void {
  const filesystem = openCommandBase(projectId, true);
  filesystem?.close();
}

/** List all commands registered for a project. */
export function listCommands(projectId: string): Command[] {
  return rawCommands(projectId).map(normalizeCommand);
}

/** Get a single command by name. Returns undefined if not found. */
export function getCommand(projectId: string, name: string): Command | undefined {
  const command = rawCommand(projectId, name);
  return command ? normalizeCommand(command) : undefined;
}

/** Create a command record and atomically write its canonical file. */
export function createCommand(
  projectId: string,
  name: string,
  filePath: string,
  content?: string,
): Command {
  const normalizedPath = normalizeCommandPath(filePath);
  if (content !== undefined && typeof content !== "string") throw new Error("invalid command content");
  const body = content ?? "";
  if (rawCommand(projectId, name)) throw new Error("command name is already registered");
  assertPathAvailable(projectId, normalizedPath.relativePath);

  const filesystem = CommandFilesystem.open(projectId, true);
  if (!filesystem) throw new Error("command directory is unavailable");
  let change: FileChange | undefined;
  let committed = false;
  try {
    change = filesystem.write(normalizedPath.relativePath, Buffer.from(body));
    const command = execTransaction(() => {
      const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
      if (db.prepare("SELECT 1 FROM commands WHERE project_id = ? AND name = ?").get(projectId, name)) {
        throw new Error("command name is already registered");
      }
      assertPathAvailable(projectId, normalizedPath.relativePath);
      const now = new Date().toISOString();
      const id = `cmd_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`;
      db.prepare(
        `INSERT INTO commands (id, project_id, name, file_path, content, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, projectId, name, normalizedPath.storagePath, body, now, now);
      return db.prepare("SELECT * FROM commands WHERE id = ?").get(id) as Command;
    });
    committed = true;
    checkpointAfterWrite();
    return normalizeCommand(command);
  } catch (error) {
    if (!committed) rollbackChange(change);
    throw error;
  } finally {
    if (committed) cleanupChange(change);
    filesystem.close();
  }
}

/** Delete a command record after securely quarantining its file. */
export function deleteCommand(projectId: string, name: string): boolean {
  const existing = rawCommand(projectId, name);
  if (!existing) return false;
  const command = normalizeCommand(existing);
  const filesystem = CommandFilesystem.open(projectId, false);
  let change: FileChange | undefined;
  let committed = false;
  try {
    if (filesystem) change = filesystem.delete(command.file_path);
    execTransaction(() => {
      const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
      const current = db.prepare("SELECT * FROM commands WHERE project_id = ? AND name = ?")
        .get(projectId, name) as Command | undefined;
      assertUnchanged(current, existing);
      db.prepare("DELETE FROM commands WHERE id = ?").run(existing.id);
    });
    committed = true;
    checkpointAfterWrite();
    return true;
  } catch (error) {
    if (!committed) rollbackChange(change);
    throw error;
  } finally {
    if (committed) cleanupChange(change);
    filesystem?.close();
  }
}

/** Update a command using a reversible filesystem change before its DB commit. */
export function updateCommand(
  projectId: string,
  name: string,
  updates: { file_path?: string; content?: string },
): Command | undefined {
  const existing = rawCommand(projectId, name);
  if (!existing) return undefined;
  if (updates.file_path !== undefined && typeof updates.file_path !== "string") {
    throw new Error("invalid command file path");
  }
  if (updates.content !== undefined && typeof updates.content !== "string") {
    throw new Error("invalid command content");
  }

  const normalizedExisting = normalizeCommand(existing);
  const existingPath = normalizeCommandPath(existing.file_path);
  const newPath = updates.file_path === undefined
    ? existingPath
    : normalizeCommandPath(updates.file_path);
  const newContent = updates.content ?? normalizedExisting.content ?? "";
  const pathChanged = newPath.relativePath !== existingPath.relativePath;
  assertPathAvailable(projectId, newPath.relativePath, existing.id);

  const filesystem = CommandFilesystem.open(projectId, true);
  if (!filesystem) throw new Error("command directory is unavailable");
  let change: FileChange | undefined;
  let committed = false;
  try {
    if (pathChanged) {
      change = updates.content === undefined
        ? filesystem.move(existingPath.relativePath, newPath.relativePath, Buffer.from(newContent))
        : filesystem.writeThenDelete(newPath.relativePath, Buffer.from(newContent), existingPath.relativePath);
    } else if (updates.content !== undefined) {
      change = filesystem.write(newPath.relativePath, Buffer.from(newContent));
    }

    const command = execTransaction(() => {
      const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./data");
      const current = db.prepare("SELECT * FROM commands WHERE project_id = ? AND name = ?")
        .get(projectId, name) as Command | undefined;
      assertUnchanged(current, existing);
      assertPathAvailable(projectId, newPath.relativePath, existing.id);
      const now = new Date().toISOString();
      db.prepare(
        "UPDATE commands SET file_path = ?, content = ?, updated_at = ? WHERE id = ?",
      ).run(newPath.storagePath, newContent, now, existing.id);
      return db.prepare("SELECT * FROM commands WHERE id = ?").get(existing.id) as Command;
    });
    committed = true;
    checkpointAfterWrite();
    return normalizeCommand(command);
  } catch (error) {
    if (!committed) rollbackChange(change);
    throw error;
  } finally {
    if (committed) cleanupChange(change);
    filesystem.close();
  }
}
