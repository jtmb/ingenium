import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { createHash, randomUUID } from "node:crypto";
import {
  chmodSync,
  existsSync,
  lstatSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  readdirSync,
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
  await write(JSON.stringify({ info: { id: process.argv[3], directory: process.cwd() } }).slice(0, -1)
    + ',"messages":[{"info":' + JSON.stringify({ id: "message", sessionID: process.argv[3], role: "user" })
    + ',"parts":[{"type":"text","text":"');
  const chunk = "x".repeat(1024 * 1024);
  for (let index = 0; index < megabytes; index += 1) await write(chunk);
  await write('"}]}]}');
}

async function writeNormalizedExport(megabytes) {
  const info = { id: process.argv[3], directory: process.cwd(), projectID: "project-frozen", time: { created: 1, updated: 100 } };
  const user = { info: { id: "m1", sessionID: info.id, role: "user", time: { created: 10 } }, parts: [{ type: "text", text: "first visible" }] };
  const assistant = { id: "m2", sessionID: info.id, role: "assistant", time: { created: 20, completed: 100 } };
  await write('{"info":' + JSON.stringify(info) + ',"messages":[' + JSON.stringify(user)
    + ',{"info":' + JSON.stringify(assistant) + ',"parts":[{"type":"reasoning","text":"');
  const chunk = "x".repeat(1024 * 1024);
  for (let index = 0; index < megabytes; index += 1) await write(chunk);
  await write('"},{"type":"text","text":"last visible 雪"}]}]}');
}

async function main() {
  if (process.argv[2] !== "export" || !process.argv[3]) process.exit(97);
  switch (process.env.FAKE_EXPORT_MODE) {
    case "redaction":
      await write(JSON.stringify({ info: { id: process.argv[3], directory: process.cwd() }, messages: [
        { info: { id: "m1", sessionID: process.argv[3], role: "user" }, parts: [
          { type: "text", text: "token=" + process.env.FAKE_VALUE },
          { type: "reasoning", text: "not retained" },
        ] },
        { info: { id: "m2", sessionID: process.argv[3], role: "assistant" }, parts: [{ type: "text", text: "unfinished" }] },
      ] }));
      return;
    case "large":
      await writeExport(51);
      return;
    case "normalized-large":
      await writeNormalizedExport(98);
      return;
    case "oversize":
      await writeExport(65);
      return;
    case "source-oversize":
      await writeNormalizedExport(129);
      return;
    case "partial":
      await write('{"info":{"id":"fake-export"},"messages":[');
      return;
    case "nonzero":
      await writeExport(1);
      process.exitCode = 9;
      return;
    case "eof-without-exit":
      await writeExport(1);
      process.stdout.end();
      setInterval(() => {}, 1_000);
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
      // Each test owns a disposable private tree; force cleanup also covers
      // partially-created fixtures when an assertion fails.
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
  arguments_ = [],
  input,
  endInput = true,
} = {}) {
  return new Promise((resolveResult, reject) => {
    const child = spawn(process.execPath, [
      helper,
      "--session", session,
      "--worktree", worktree,
      "--output", output,
      "--timeout-ms", String(timeoutMs),
      ...(input === undefined ? [] : ["--input", "-"]),
      ...arguments_,
    ], {
      cwd: repositoryRoot,
      env: {
        ...process.env,
        ...extraEnvironment,
        FAKE_EXPORT_MODE: mode,
        PATH: `${fixture.bin}${delimiter}${process.env.PATH ?? ""}`,
      },
      shell: false,
      stdio: [input === undefined ? "ignore" : "pipe", "pipe", "pipe"],
    });
    let stdout = "";
    let stderr = "";
    child.stdout.setEncoding("utf8");
    child.stderr.setEncoding("utf8");
    child.stdout.on("data", (chunk) => { stdout += chunk; });
    child.stderr.on("data", (chunk) => { stderr += chunk; });
    child.once("error", reject);
    child.once("close", (code, signal) => resolveResult({ code, signal, stdout, stderr }));
    if (input !== undefined) {
      child.stdin.on("error", (error) => { if (error.code !== "EPIPE") reject(error); });
      if (endInput) child.stdin.end(input);
      else child.stdin.write(input);
    }
  });
}

function finalArguments({ projectId = "project-frozen", cutoffMs = "1000", cutoffMessage = "m2", expectedMessages = "2" } = {}) {
  return ["--mode", "final", "--project-id", projectId, "--cutoff-ms", cutoffMs,
    "--cutoff-message", cutoffMessage, "--expected-messages", expectedMessages];
}

function frozenExport(fixture) {
  const session = "export-session-001";
  return {
    info: { id: session, directory: fixture.worktree, projectID: "project-frozen", time: { created: 1, updated: 100 } },
    messages: [
      { info: { id: "m1", sessionID: session, role: "user", time: { created: 10 } }, parts: [{ type: "text", text: "first visible" }] },
      { info: { id: "m2", sessionID: session, role: "assistant", time: { created: 20, completed: 100 } }, parts: [{ type: "text", text: "last visible 雪" }] },
    ],
  };
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

test("retains a complete 50+ MiB visible export in a 0600 context-upload file", async () => {
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

test("acquires a complete 98 MiB normalized session before filtering and emits a content-free final receipt", { timeout: 30_000 }, async () => {
  const fixture = createFixture();
  try {
    const result = await runHelper(fixture, { mode: "normalized-large", arguments_: finalArguments() });
    assert.equal(result.code, 0, result.stderr);
    const metadata = JSON.parse(result.stdout);
    assert.ok(metadata.final.sourceBytes > 98 * MiB);
    assert.ok(metadata.final.sourceBytes < 99 * MiB);
    assert.deepEqual(metadata.final, {
      projectId: "project-frozen", session: "export-session-001", worktree: fixture.worktree,
      cutoffMs: 1000, cutoffMessage: "m2", sourceBytes: metadata.final.sourceBytes,
      sourceMessageCount: 2, visibleMessageCount: 2, excludedMessageCount: 0, complete: true,
    });
    const bytes = readFileSync(outputPath(fixture, "export.json"));
    const exported = JSON.parse(bytes);
    assert.deepEqual(exported.messages.map((message) => message.parts), [
      [{ type: "text", text: "first visible" }], [{ type: "text", text: "last visible 雪" }],
    ]);
    assert.equal(metadata.bytes, bytes.byteLength);
    assert.equal(metadata.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(result.stdout.includes("first visible"), false);
    assert.equal(result.stdout.includes("last visible"), false);
    assert.equal(statSync(outputPath(fixture, "export.json")).mode & 0o777, 0o600);
    assert.deepEqual(readdirSync(join(fixture.worktree, ".ingenium", "context-uploads")), ["export.json"]);
  } finally { fixture.cleanup(); }
});

test("accepts normalized stdin only through EOF and redacts before final output and hashing", async () => {
  const fixture = createFixture();
  try {
    const value = randomUUID();
    const raw = frozenExport(fixture);
    raw.info.title = value;
    raw.info.contextUploadAutomatic = true;
    raw.messages[0].parts[0].text = `Passphrase: "two words ${value}"; keep useful text\nSee https://example.test/#access_token=${value}\nKeep https://example.test/docs#install`;
    raw.messages[1].parts[0].time = { start: 30, end: 100 };
    raw.messages[1].parts.push({ type: "tool", state: { status: "completed", time: { start: 20, end: 30 } } });
    raw.messages.splice(1, 0, { ...structuredClone(raw.messages[0]), info: { ...raw.messages[0].info, id: "hidden", hidden: true } });
    const input = JSON.stringify(raw);
    const result = await runHelper(fixture, { input, arguments_: finalArguments({ expectedMessages: "3" }) });
    assert.equal(result.code, 0, result.stderr);
    const bytes = readFileSync(outputPath(fixture, "export.json"));
    const text = bytes.toString("utf8");
    assert.equal(text.includes(value), false);
    assert.equal(`${result.stdout}${result.stderr}`.includes(value), false);
    assert.ok(text.includes("keep useful text"));
    assert.ok(text.includes("https://example.test/docs#install"));
    const metadata = JSON.parse(result.stdout);
    assert.equal(metadata.final.sourceBytes, Buffer.byteLength(input));
    assert.equal(metadata.final.excludedMessageCount, 1);
    assert.equal(metadata.final.visibleMessageCount, 2);
    assert.equal(metadata.sha256, createHash("sha256").update(bytes).digest("hex"));
    assert.equal(JSON.parse(bytes).info.contextUploadAutomatic, undefined);
  } finally { fixture.cleanup(); }
});

test("final mode refuses missing freeze data, foreign bindings, cutoffs, omissions, and unfinished content", async () => {
  const fixture = createFixture();
  try {
    const cases = [
      ["missing-freeze", () => {}, ["--mode", "final"], "INVALID_ARGUMENTS"],
      ["partial-freeze", () => {}, ["--cutoff-ms", "1000"], "INVALID_ARGUMENTS"],
      ["invalid-count", () => {}, finalArguments({ expectedMessages: "1.5" }), "INVALID_ARGUMENTS"],
      ["invalid-time", () => {}, finalArguments({ cutoffMs: "NaN" }), "INVALID_ARGUMENTS"],
      ["future-freeze", () => {}, finalArguments({ cutoffMs: String(Date.now() + 60_000) }), "INVALID_ARGUMENTS"],
      ["foreign-project", () => {}, finalArguments({ projectId: "other" }), "FINAL_EXPORT_BINDING_MISMATCH"],
      ["foreign-session", (raw) => { raw.info.id = "other"; }, finalArguments(), "FINAL_EXPORT_BINDING_MISMATCH"],
      ["foreign-worktree", (raw) => { raw.info.directory = fixture.root; }, finalArguments(), "FINAL_EXPORT_BINDING_MISMATCH"],
      ["foreign-message", (raw) => { raw.messages[0].info.sessionID = "other"; }, finalArguments(), "FINAL_EXPORT_BINDING_MISMATCH"],
      ["duplicate-message", (raw) => { raw.messages[0].info.id = "m2"; }, finalArguments(), "FINAL_EXPORT_BINDING_MISMATCH"],
      ["wrong-cutoff", () => {}, finalArguments({ cutoffMessage: "missing" }), "FINAL_EXPORT_CUTOFF_MISMATCH"],
      ["omitted-prefix", (raw) => { raw.messages.shift(); }, finalArguments(), "FINAL_EXPORT_CUTOFF_MISMATCH"],
      ["appended-message", (raw) => { raw.messages.push(structuredClone(raw.messages[0])); }, finalArguments(), "FINAL_EXPORT_CUTOFF_MISMATCH"],
      ["session-after-cutoff", (raw) => { raw.info.time.updated = 1001; }, finalArguments(), "FINAL_EXPORT_CUTOFF_MISMATCH"],
      ["message-after-cutoff", (raw) => { raw.messages[1].info.time.completed = 1001; }, finalArguments(), "FINAL_EXPORT_INCOMPLETE"],
      ["unfinished", (raw) => { delete raw.messages[1].info.time.completed; }, finalArguments(), "FINAL_EXPORT_INCOMPLETE"],
      ["finish-only", (raw) => { delete raw.messages[1].info.time.completed; raw.messages[1].info.finish = "stop"; }, finalArguments(), "FINAL_EXPORT_INCOMPLETE"],
      ["errored", (raw) => { raw.messages[1].info.error = { name: "MessageAbortedError" }; }, finalArguments(), "FINAL_EXPORT_INCOMPLETE"],
      ["missing-parts", (raw) => { delete raw.messages[1].parts; }, finalArguments(), "FINAL_EXPORT_INCOMPLETE"],
      ["partial-text", (raw) => { raw.messages[1].parts[0].time = { start: 20 }; }, finalArguments(), "FINAL_EXPORT_INCOMPLETE"],
      ["running-tool", (raw) => { raw.messages[1].parts.push({ type: "tool", state: { status: "running" } }); }, finalArguments(), "FINAL_EXPORT_INCOMPLETE"],
      ["tool-after-cutoff", (raw) => { raw.messages[1].parts.push({ type: "tool", state: { status: "completed", time: { start: 20, end: 1001 } } }); }, finalArguments(), "FINAL_EXPORT_INCOMPLETE"],
      ["foreign-part", (raw) => { raw.messages[1].parts[0].sessionID = "other"; }, finalArguments(), "FINAL_EXPORT_INCOMPLETE"],
      ["empty-final-text", (raw) => { raw.messages[1].parts[0].text = ""; }, finalArguments(), "FINAL_EXPORT_INCOMPLETE"],
    ];
    for (const [name, mutate, arguments_, code] of cases) {
      const raw = frozenExport(fixture);
      mutate(raw);
      const output = `${name}.json`;
      const result = await runHelper(fixture, { input: JSON.stringify(raw), arguments_, output });
      assert.equal(result.code, 1, name);
      assert.equal(result.stdout, "", name);
      assert.equal(result.stderr, `context export failed: ${code}\n`, name);
      assert.equal(existsSync(outputPath(fixture, output)), false, name);
    }
  } finally { fixture.cleanup(); }
});

test("incremental capture still stops at an unfinished assistant while final capture rejects that prefix", async () => {
  const fixture = createFixture();
  try {
    const raw = frozenExport(fixture);
    raw.messages.splice(1, 0, { info: { id: "unfinished", sessionID: raw.info.id, role: "assistant", time: { created: 15 } }, parts: [{ type: "text", text: "not finished" }] });
    const input = JSON.stringify(raw);
    const incremental = await runHelper(fixture, { input });
    assert.equal(incremental.code, 0, incremental.stderr);
    assert.deepEqual(JSON.parse(readFileSync(outputPath(fixture, "export.json"))).messages.map((message) => message.info.id), ["m1"]);
    const final = await runHelper(fixture, { input, output: "final.json", arguments_: finalArguments({ expectedMessages: "3" }) });
    assert.equal(final.code, 1);
    assert.equal(final.stderr, "context export failed: FINAL_EXPORT_INCOMPLETE\n");
    assert.equal(existsSync(outputPath(fixture, "final.json")), false);
  } finally { fixture.cleanup(); }
});

test("rejects truncated JSON, invalid UTF-8, trailing data, missing EOF, and a non-exiting exporter", async () => {
  const fixture = createFixture();
  try {
    const input = JSON.stringify(frozenExport(fixture));
    for (const [index, bytes] of ["", input.slice(0, -1), Buffer.concat([Buffer.from(input.slice(0, -1)), Buffer.from([0xff])]), `${input}{}`].entries()) {
      const output = `truncated-${index}.json`;
      const result = await runHelper(fixture, { input: bytes, arguments_: finalArguments(), output });
      assert.equal(result.stderr, "context export failed: INVALID_EXPORT\n");
      assert.equal(result.code, 1);
      assert.equal(result.stdout, "");
      assert.equal(existsSync(outputPath(fixture, output)), false);
    }
    for (const options of [{ input, endInput: false }, { mode: "eof-without-exit" }]) {
      const result = await runHelper(fixture, { ...options, timeoutMs: 500, output: "timeout.json" });
      assert.equal(result.code, 1);
      assert.equal(result.stderr, "context export failed: EXPORT_TIMEOUT\n");
      assert.equal(result.stdout, "");
      assert.equal(existsSync(outputPath(fixture, "timeout.json")), false);
    }
  } finally { fixture.cleanup(); }
});

test("redacts before writing or hashing and excludes unfinished and non-visible content", async () => {
  const fixture = createFixture();
  try {
    const value = randomUUID();
    const result = await runHelper(fixture, { mode: "redaction", extraEnvironment: { FAKE_VALUE: value } });
    assert.equal(result.code, 0);
    const bytes = readFileSync(outputPath(fixture, "export.json"));
    assert.equal(bytes.toString().includes(value), false);
    const exported = JSON.parse(bytes);
    assert.equal(exported.messages.length, 1);
    assert.deepEqual(exported.messages[0].parts, [{ type: "text", text: "token= [REDACTED]" }]);
    assert.equal(JSON.parse(result.stdout).sha256, createHash("sha256").update(bytes).digest("hex"));
  } finally { fixture.cleanup(); }
});

test("removes owned output files after partial, nonzero, invalid, and oversize exports", async () => {
  const fixture = createFixture();
  try {
    for (const [mode, output, timeoutMs] of [
      ["partial", "partial.json", 10_000],
      ["nonzero", "nonzero.json", 10_000],
      ["invalid", "invalid.json", 10_000],
      ["oversize", "oversize.json", 10_000],
      ["source-oversize", "source-oversize.json", 10_000],
    ]) {
      const result = await runHelper(fixture, { mode, output, timeoutMs });
      assert.equal(result.code, 1, `${mode}: ${result.stderr}`);
      const code = mode.includes("oversize") ? "EXPORT_TOO_LARGE" : mode === "nonzero" ? "EXPORT_FAILED" : "INVALID_EXPORT";
      assert.equal(result.stderr, `context export failed: ${code}\n`, mode);
      assert.equal(result.stdout, "", mode);
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
      timeoutMs: 500,
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
