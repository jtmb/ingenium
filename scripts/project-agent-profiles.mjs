#!/usr/bin/env node
/**
 * Descriptor-safe agent profile maintenance.
 *
 * All child paths are resolved from an already-open directory descriptor. This
 * avoids check-then-use pathname races when an entrypoint runs as root against
 * a persistent OpenCode configuration volume.
 */
import {
  closeSync,
  constants,
  fchmodSync,
  fchownSync,
  fstatSync,
  fsyncSync,
  mkdirSync,
  openSync,
  readFileSync,
  readdirSync,
  renameSync,
  unlinkSync,
  writeSync,
} from "node:fs";
import { randomUUID } from "node:crypto";
import { resolve } from "node:path";

const PROFILE_MODE = 0o644;
const DIRECTORY_MODE = 0o700;
const ALLOWLISTED_PROFILES = [
  ["chat", "ingenium-chat.md"],
  ["execution", "ingenium-llm-broker.md"],
];

if (process.platform !== "linux" || typeof constants.O_NOFOLLOW !== "number" || typeof constants.O_DIRECTORY !== "number") {
  throw new Error("Agent profile projection requires Linux O_NOFOLLOW and O_DIRECTORY support");
}

const DIRECTORY_FLAGS = constants.O_RDONLY | constants.O_DIRECTORY | constants.O_NOFOLLOW;
const REGULAR_FILE_FLAGS = constants.O_RDONLY | constants.O_NOFOLLOW;

function fail(message) {
  throw new Error(`Agent profile maintenance failed: ${message}`);
}

function isMissing(error) {
  return error && typeof error === "object" && error.code === "ENOENT";
}

function descriptorPath(directoryFd, name) {
  if (!name || name.includes("/") || name === "." || name === "..") {
    fail(`unsafe path component: ${String(name)}`);
  }
  return `/proc/self/fd/${directoryFd}/${name}`;
}

function assertDirectory(fd, description) {
  const stat = fstatSync(fd);
  if (!stat.isDirectory() || stat.isSymbolicLink()) fail(`${description} must be a real directory`);
  return stat;
}

function openDirectoryPath(path, { create = false, mode = DIRECTORY_MODE } = {}) {
  const absolutePath = resolve(path);
  const components = absolutePath.split("/").filter(Boolean);
  let fd = openSync("/", DIRECTORY_FLAGS);
  try {
    assertDirectory(fd, "/");
    for (const component of components) {
      const childPath = descriptorPath(fd, component);
      if (create) {
        try {
          mkdirSync(childPath, { mode });
        } catch (error) {
          if (!error || typeof error !== "object" || error.code !== "EEXIST") throw error;
        }
      }
      const childFd = openSync(childPath, DIRECTORY_FLAGS);
      closeSync(fd);
      fd = childFd;
      assertDirectory(fd, absolutePath);
    }
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function openDirectoryAt(parentFd, name, description) {
  const fd = openSync(descriptorPath(parentFd, name), DIRECTORY_FLAGS);
  try {
    assertDirectory(fd, description);
    return fd;
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function openRegularFileAt(parentFd, name, description, { optional = false } = {}) {
  let fd;
  try {
    fd = openSync(descriptorPath(parentFd, name), REGULAR_FILE_FLAGS);
  } catch (error) {
    if (optional && isMissing(error)) return undefined;
    throw error;
  }
  try {
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.isSymbolicLink()) fail(`${description} must be a regular non-symlink file`);
    return { fd, stat };
  } catch (error) {
    closeSync(fd);
    throw error;
  }
}

function closeQuietly(fd) {
  if (fd === undefined) return;
  try {
    closeSync(fd);
  } catch {
    // Preserve the primary safety failure.
  }
}

function assertSameOwner(actual, expected, description) {
  if (actual.uid !== expected.uid || actual.gid !== expected.gid) {
    fail(`${description} ownership does not match the server-owned source directory`);
  }
}

function readStableFile(file) {
  const before = fstatSync(file.fd);
  const contents = readFileSync(file.fd);
  const after = fstatSync(file.fd);
  if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs) {
    fail("source profile changed while it was being read");
  }
  return contents;
}

function writeAll(fd, contents) {
  let offset = 0;
  while (offset < contents.length) {
    const written = writeSync(fd, contents, offset, contents.length - offset);
    if (written <= 0) fail("could not write profile temporary file");
    offset += written;
  }
}

function applySourceOwnership(fd, sourceStat) {
  const targetStat = fstatSync(fd);
  if (targetStat.uid !== sourceStat.uid || targetStat.gid !== sourceStat.gid) {
    fchownSync(fd, sourceStat.uid, sourceStat.gid);
  }
}

function assertProfile(fd, sourceStat, expectedContents, description) {
  const stat = fstatSync(fd);
  if (!stat.isFile() || stat.isSymbolicLink()) fail(`${description} is not a regular file`);
  assertSameOwner(stat, sourceStat, description);
  if ((stat.mode & 0o777) !== PROFILE_MODE) fail(`${description} does not have mode 0644`);
  const contents = readFileSync(fd);
  if (!contents.equals(expectedContents)) fail(`${description} did not retain the source contents`);
}

function replaceProfileAtomically(targetDirectoryFd, profileName, sourceStat, contents) {
  let temporaryName;
  let temporaryFd;
  for (let attempt = 0; attempt < 3; attempt += 1) {
    temporaryName = `.${profileName}.${randomUUID()}.tmp`;
    try {
      temporaryFd = openSync(
        descriptorPath(targetDirectoryFd, temporaryName),
        constants.O_WRONLY | constants.O_CREAT | constants.O_EXCL | constants.O_NOFOLLOW,
        PROFILE_MODE,
      );
      break;
    } catch (error) {
      if (!error || typeof error !== "object" || error.code !== "EEXIST" || attempt === 2) throw error;
    }
  }
  if (temporaryFd === undefined || temporaryName === undefined) fail("could not create an exclusive temporary profile");

  try {
    const temporaryStat = fstatSync(temporaryFd);
    if (!temporaryStat.isFile() || temporaryStat.isSymbolicLink() || temporaryStat.nlink !== 1) {
      fail("profile temporary file is not an exclusive regular file");
    }
    writeAll(temporaryFd, contents);
    applySourceOwnership(temporaryFd, sourceStat);
    fchmodSync(temporaryFd, PROFILE_MODE);
    fsyncSync(temporaryFd);
    closeSync(temporaryFd);
    temporaryFd = undefined;

    renameSync(
      descriptorPath(targetDirectoryFd, temporaryName),
      descriptorPath(targetDirectoryFd, profileName),
    );
    fsyncSync(targetDirectoryFd);
  } catch (error) {
    closeQuietly(temporaryFd);
    try {
      unlinkSync(descriptorPath(targetDirectoryFd, temporaryName));
    } catch (cleanupError) {
      if (!isMissing(cleanupError)) {
        // The exclusive name is evidence of an interrupted write; retain it if
        // it cannot be removed without hiding the original failure.
      }
    }
    throw error;
  }
}

function projectProfile(sourceDirectoryFd, targetDirectoryFd, sourceDirectoryStat, group, profileName) {
  const groupFd = openDirectoryAt(sourceDirectoryFd, group, `source agent group ${group}`);
  let source;
  let target;
  try {
    assertSameOwner(fstatSync(groupFd), sourceDirectoryStat, `source agent group ${group}`);
    source = openRegularFileAt(groupFd, profileName, `server-owned source profile ${group}/${profileName}`);
    assertSameOwner(source.stat, sourceDirectoryStat, `server-owned source profile ${group}/${profileName}`);
    const contents = readStableFile(source);
    target = openRegularFileAt(targetDirectoryFd, profileName, `global agent profile ${profileName}`, { optional: true });
    if (target) {
      assertSameOwner(target.stat, sourceDirectoryStat, `global agent profile ${profileName}`);
      const current = readFileSync(target.fd);
      if (current.equals(contents)) {
        fchmodSync(target.fd, PROFILE_MODE);
        fsyncSync(target.fd);
      } else {
        closeSync(target.fd);
        target = undefined;
        replaceProfileAtomically(targetDirectoryFd, profileName, source.stat, contents);
      }
    } else {
      replaceProfileAtomically(targetDirectoryFd, profileName, source.stat, contents);
    }

    const verified = openRegularFileAt(targetDirectoryFd, profileName, `global agent profile ${profileName}`);
    try {
      assertProfile(verified.fd, source.stat, contents, `global agent profile ${profileName}`);
    } finally {
      closeSync(verified.fd);
    }
  } finally {
    closeQuietly(target?.fd);
    closeQuietly(source?.fd);
    closeSync(groupFd);
  }
}

function projectServerOwnedProfiles(sourcePath, targetPath) {
  const sourceDirectoryFd = openDirectoryPath(sourcePath);
  let targetDirectoryFd;
  try {
    const sourceDirectoryStat = assertDirectory(sourceDirectoryFd, "server-owned agent source directory");
    targetDirectoryFd = openDirectoryPath(targetPath, { create: true });
    const targetDirectoryStat = assertDirectory(targetDirectoryFd, "OpenCode global agents directory");
    if (targetDirectoryStat.uid !== sourceDirectoryStat.uid || targetDirectoryStat.gid !== sourceDirectoryStat.gid) {
      applySourceOwnership(targetDirectoryFd, sourceDirectoryStat);
    }
    fchmodSync(targetDirectoryFd, DIRECTORY_MODE);
    assertSameOwner(fstatSync(targetDirectoryFd), sourceDirectoryStat, "OpenCode global agents directory");
    for (const [group, profileName] of ALLOWLISTED_PROFILES) {
      projectProfile(sourceDirectoryFd, targetDirectoryFd, sourceDirectoryStat, group, profileName);
    }
    fsyncSync(targetDirectoryFd);
  } finally {
    closeQuietly(targetDirectoryFd);
    closeSync(sourceDirectoryFd);
  }
}

function normalizeDirectory(directoryFd) {
  for (const entry of readdirSync(`/proc/self/fd/${directoryFd}`, { withFileTypes: true })) {
    if (entry.isSymbolicLink()) continue;
    if (entry.isDirectory()) {
      const childDirectoryFd = openDirectoryAt(directoryFd, entry.name, `agent directory ${entry.name}`);
      try {
        normalizeDirectory(childDirectoryFd);
      } finally {
        closeSync(childDirectoryFd);
      }
      continue;
    }
    if (!entry.name.endsWith(".md")) continue;
    const profile = openRegularFileAt(directoryFd, entry.name, `agent profile ${entry.name}`);
    try {
      fchmodSync(profile.fd, PROFILE_MODE);
      fsyncSync(profile.fd);
    } finally {
      closeSync(profile.fd);
    }
  }
}

function normalizeAgentProfiles(path) {
  let directoryFd;
  try {
    directoryFd = openDirectoryPath(path);
  } catch (error) {
    if (isMissing(error)) return;
    throw error;
  }
  try {
    normalizeDirectory(directoryFd);
    fsyncSync(directoryFd);
  } finally {
    closeSync(directoryFd);
  }
}

function usage() {
  fail("usage: project-agent-profiles.mjs AGENTS_DIR | --project-server-owned SOURCE_AGENTS_DIR TARGET_AGENTS_DIR");
}

try {
  const args = process.argv.slice(2);
  if (args[0] === "--project-server-owned") {
    if (args.length !== 3) usage();
    projectServerOwnedProfiles(args[1], args[2]);
  } else if (args.length === 1) {
    normalizeAgentProfiles(args[0]);
  } else {
    usage();
  }
} catch (error) {
  process.stderr.write(`${error instanceof Error ? error.message : String(error)}\n`);
  process.exitCode = 1;
}
