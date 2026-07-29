import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  statSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { delimiter, dirname, join, resolve } from "node:path";
import test from "node:test";
import { fileURLToPath } from "node:url";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const helper = join(repositoryRoot, "scripts", "export-context-upload.mjs");
const MiB = 1024 * 1024;

const fakeOpenCode = `#!/usr/bin/env node
const { symlinkSync, unlinkSync, writeFileSync } = require("node:fs");
const { spawn } = require("node:child_process");
const { once } = require("node:events");

async function write(value) {
  if (!process.stdout.write(value)) await once(process.stdout, "drain");
}

async function writeExport(megabytes) {
  await write('{"info":{"id":"fake-export"},"messages":[{"info":{"id":"message","role":"user"},"parts":[{"type":"text","text":"');
  const chunk = "x".repeat(1024 * 1024);
  for (let index = 0; index < megabytes; index += 1) await write(chunk);
  await write('"}]}]}');
}

async function main() {
  if (process.argv[2] !== "export" || !process.argv[3]) process.exit(97);
  switch (process.env.FAKE_EXPORT_MODE) {
    case "large":
      await writeExport(51);
      return;
    case "oversize":
      await writeExport(65);
      return;
    case "partial":
      await write('{"info":{"id":"fake-export"},"messages":[');
      return;
    case "nonzero":
      await writeExport(1);
      process.exitCode = 9;
      return;
    case "timeout":
      await write('{"info":{"id":"fake-export"},"messages":[');
      const descendant = spawn(process.execPath, ["-e", "setInterval(() => {}, 1000)"], { stdio: "ignore" });
      writeFileSync(process.env.FAKE_CHILD_PID_FILE, String(descendant.pid));
      setInterval(() => {}, 1_000);
      return;
    case "invalid":
      await write('{"info":[],"messages":{}}');
      return;
    case "replace-with-symlink":
      await write('{"info":{"id":"fake-export"},"messages":[');
      unlinkSync(process.env.FAKE_OUTPUT_PATH);
      symlinkSync(process.env.FAKE_SYMLINK_TARGET, process.env.FAKE_OUTPUT_PATH);
      process.exitCode = 9;
      return;
    default:
      await writeExport(1);
  }
}

main().catch(() => process.exit(98));
`;

function createFixture() {
  const root = mkdtempSync(join(tmpdir(), "ingenium-context-export-"));
  const worktree = join(root, "worktree");
  const bin = join(root, "bin");
  mkdirSync(worktree, { mode: 0o700 });
  mkdirSync(bin, { mode: 0o700 });
  chmodSync(worktree, 0o700);
  chmodSync(bin, 0o700);
  const exporter = join(bin, "opencode");
  writeFileSync(exporter, fakeOpenCode, { mode: 0o700 });
  chmodSync(exporter, 0o700);
  return {
    root,
    worktree,
    bin,
    cleanup() {
      rmSync(root, { recursive: true, force: true });
    },
  };
}

function outputPath(fixture, output) {
  return join(fixture.worktree, ".ingenium", "context-uploads", output);
}

function runHelper(fixture, {
  session = "export-session-001",
  worktree = fixture.worktree,
  output = "export.json",
  timeoutMs = 10_000,
  mode = "valid",
  extraEnvironment = {},
} = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [
      helper,
      "--session", session,
      "--worktree", worktree,
      "--output", output,
      "--timeout-ms", String(timeoutMs),
    ], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        ...extraEnvironment,
        FAKE_EXPORT_MODE: mode,
        PATH: `${fixture.bin}${delimiter}${process.env.PATH ?? ""}`,
      },
      shell: false,
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => resolveResult({ code, signal, stdout, stderr }));
  });
}

async function waitForProcessExit(pid) {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    try {
      process.kill(pid, 0);
    } catch (error) {
      if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") return;
      throw error;
    }
    await new Promise((resolveWait) => setTimeout(resolveWait, 25));
  }
  assert.fail(`timed-out exporter descendant ${pid} is still running`);
}

test("streams a 50+ MiB export directly to a 0600 context-upload file without truncation", async () => {
  const fixture = createFixture();
  try {
    const result = await runHelper(fixture, { output: "large.json", mode: "large" });
    assert.equal(result.code, 0, result.stderr);
    assert.equal(result.signal, null);
    const metadata = JSON.parse(result.stdout);
    const output = outputPath(fixture, "large.json");
    const contents = readFileSync(output);

    assert.deepEqual(Object.keys(metadata).sort(), ["bytes", "elapsedMs", "path", "sha256"]);
    assert.equal(metadata.path, output);
    assert.equal(metadata.bytes, contents.byteLength);
    assert.ok(metadata.bytes > 50 * MiB);
    assert.equal(metadata.sha256, createHash("sha256").update(contents).digest("hex"));
    assert.equal(JSON.parse(contents.toString("utf8")).messages[0].parts[0].text.length, 51 * MiB);
    assert.equal(statSync(output).mode & 0o777, 0o600);
    assert.equal(statSync(join(fixture.worktree, ".ingenium", "context-uploads")).mode & 0o777, 0o700);
  } finally {
    fixture.cleanup();
  }
}, 30_000);

test("removes owned output files after partial, nonzero, invalid, and oversize exports", async () => {
  const fixture = createFixture();
  try {
    for (const [mode, output, timeoutMs] of [
      ["partial", "partial.json", 10_000],
      ["nonzero", "nonzero.json", 10_000],
      ["invalid", "invalid.json", 10_000],
      ["oversize", "oversize.json", 10_000],
    ]) {
      const result = await runHelper(fixture, { mode, output, timeoutMs });
      assert.equal(result.code, 1, `${mode}: ${result.stderr}`);
      assert.equal(existsSync(outputPath(fixture, output)), false, `${mode} left an output file`);
    }
  } finally {
    fixture.cleanup();
  }
}, 45_000);

test("times out and cleans the exporter process group and owned output", async () => {
  const fixture = createFixture();
  let descendantPid;
  try {
    const childPidPath = join(fixture.root, "timeout-child.pid");
    const result = await runHelper(fixture, {
      mode: "timeout",
      output: "timeout.json",
      timeoutMs: 100,
      extraEnvironment: { FAKE_CHILD_PID_FILE: childPidPath },
    });
    assert.equal(result.code, 1, result.stderr);
    assert.equal(existsSync(outputPath(fixture, "timeout.json")), false);
    descendantPid = Number(readFileSync(childPidPath, "utf8"));
    await waitForProcessExit(descendantPid);
  } finally {
    if (descendantPid !== undefined) {
      try {
        process.kill(descendantPid, "SIGKILL");
      } catch {
        // The expected process-group cleanup has already reaped the descendant.
      }
    }
    fixture.cleanup();
  }
}, 10_000);

test("rejects traversal and unsafe session arguments before creating an output", async () => {
  const fixture = createFixture();
  try {
    const traversal = await runHelper(fixture, { output: "../escaped.json" });
    assert.equal(traversal.code, 1);
    assert.equal(existsSync(join(fixture.worktree, ".ingenium", "escaped.json")), false);

    const unsafeSession = await runHelper(fixture, { session: "../escaped", output: "unsafe-session.json" });
    assert.equal(unsafeSession.code, 1);
    assert.equal(existsSync(outputPath(fixture, "unsafe-session.json")), false);

    const nonCanonicalWorktree = await runHelper(fixture, {
      worktree: `${fixture.worktree}/..`,
      output: "non-canonical-worktree.json",
    });
    assert.equal(nonCanonicalWorktree.code, 1);
    assert.equal(existsSync(join(fixture.root, ".ingenium", "context-uploads", "non-canonical-worktree.json")), false);
  } finally {
    fixture.cleanup();
  }
});

test("does not follow or remove a symlink during output creation or failed cleanup", async () => {
  const fixture = createFixture();
  try {
    const uploadDirectory = join(fixture.worktree, ".ingenium", "context-uploads");
    mkdirSync(uploadDirectory, { recursive: true, mode: 0o700 });
    chmodSync(join(fixture.worktree, ".ingenium"), 0o700);
    chmodSync(uploadDirectory, 0o700);
    const target = join(fixture.root, "symlink-target.json");
    writeFileSync(target, "preserve this target", { mode: 0o600 });
    const existingLink = outputPath(fixture, "linked.json");
    symlinkSync(target, existingLink);

    const existingLinkResult = await runHelper(fixture, { output: "linked.json" });
    assert.equal(existingLinkResult.code, 1);
    assert.equal(lstatSync(existingLink).isSymbolicLink(), true);
    assert.equal(readFileSync(target, "utf8"), "preserve this target");

    const replacedOutput = outputPath(fixture, "replaced.json");
    const replacementTarget = join(fixture.root, "replacement-target.json");
    writeFileSync(replacementTarget, "preserve replacement target", { mode: 0o600 });
    const replacedResult = await runHelper(fixture, {
      output: "replaced.json",
      mode: "replace-with-symlink",
      extraEnvironment: {
        FAKE_OUTPUT_PATH: replacedOutput,
        FAKE_SYMLINK_TARGET: replacementTarget,
      },
    });
    assert.equal(replacedResult.code, 1);
    assert.equal(lstatSync(replacedOutput).isSymbolicLink(), true);
    assert.equal(readFileSync(replacementTarget, "utf8"), "preserve replacement target");
  } finally {
    fixture.cleanup();
  }
});
