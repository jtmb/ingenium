import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { syncBuiltinESMExports } from "node:module";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { pathToFileURL } from "node:url";

const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const installer = new URL("./install-host-build.mjs", import.meta.url);
const installerBytes = fs.readFileSync(installer);
const installerSha256 = hash(installerBytes);

test("qualified closure consumer accepts an owned fixture and rejects tampering without installer effects", async (t) => {
  const tmpdir = process.env.TMPDIR;
  assert(tmpdir?.startsWith("/tmp/opencode/ci-extension-mjs-fixture-"), "Use a private run-owned TMPDIR");
  const fixture = fs.mkdtempSync(join(tmpdir, "closure-"));
  t.after(() => fs.rmSync(fixture, { recursive: true, force: true }));
  const root = join(fixture, "repository");
  const build = join(root, "build");
  const extension = join(root, "packages/ingenium-extension");
  const scripts = join(extension, "scripts");
  const artifact = join(build, "artifact");
  for (const path of [build, scripts, join(artifact, "dist/scripts")]) fs.mkdirSync(path, { recursive: true, mode: 0o700 });
  const installerPath = join(scripts, "install-host-build.mjs");
  fs.writeFileSync(installerPath, installerBytes, { flag: "wx", mode: 0o644 });
  fs.chmodSync(installerPath, 0o644);
  assert.equal(hash(fs.readFileSync(installerPath)), installerSha256);
  const { parseInstallerArgs, prepareInstallerInvocation } = await import(pathToFileURL(installerPath).href);
  const sourceFiles = {
    "package.json": JSON.stringify({ bin: {
      "ingenium-build": "./dist/scripts/build-command.js",
      "ingenium-opencode": "./dist/scripts/opencode.js",
    } }),
    "context-upload-codec.mjs": "export const codec = true;\n",
    "replacement-first-restart.ts": "export const restart = true;\n",
    "scripts/source-snapshot.mjs": "export const snapshot = true;\n",
    "scripts/opencode.ts": "export const opencode = true;\n",
    "scripts/build-command.ts": "export const build = true;\n",
    "scripts/managed-command-wrapper.ts": "export const wrapper = true;\n",
  };
  const lineage = {};
  for (const [name, value] of Object.entries(sourceFiles)) {
    const path = join(extension, name);
    fs.mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path, value, { flag: "wx", mode: 0o644 });
    fs.chmodSync(path, 0o644);
    lineage[`packages/ingenium-extension/${name}`] = hash(Buffer.from(value));
  }
  const roleData = {
    "package.json": sourceFiles["package.json"],
    "context-upload-codec.mjs": sourceFiles["context-upload-codec.mjs"],
    "source-snapshot.mjs": sourceFiles["scripts/source-snapshot.mjs"],
    "dist/replacement-first-restart.js": "export const restart = true;\n",
    "dist/scripts/build-command.js": "export const build = true;\n",
    "dist/scripts/managed-command-wrapper.js": "export const wrapper = true;\n",
    "dist/scripts/opencode.js": "export const opencode = true;\n",
  };
  const files = {};
  for (const [name, value] of Object.entries(roleData)) {
    const bytes = Buffer.from(value), path = join(artifact, name);
    fs.mkdirSync(dirname(path), { recursive: true, mode: 0o700 });
    fs.writeFileSync(path, bytes, { flag: "wx", mode: 0o400 });
    files[name] = { bytes: bytes.length, sha256: hash(bytes) };
  }
  const head = "a".repeat(40), sourceDigest = "b".repeat(64), helperSha256 = lineage["packages/ingenium-extension/scripts/source-snapshot.mjs"];
  const receiptPath = join(build, "qualification.json");
  const receipt = { version: 1, kind: "host-closure-esm-initialization-repair", canonicalRoot: root,
    historicalCandidatePins: { head, sourceDigest, helperSha256 },
    sources: { "packages/ingenium-extension/scripts/install-host-build.mjs": { sha256: installerSha256 } },
    selectedCurrentSourceLineage: lineage, artifact, files };
  const receiptBytes = Buffer.from(JSON.stringify(receipt));
  fs.writeFileSync(receiptPath, receiptBytes, { flag: "wx", mode: 0o600 });
  const admission = { schemaVersion: 1, repositoryRoot: root, head, sourceDigest, helperSha256, installerSha256,
    qualification: { path: receiptPath, sha256: hash(receiptBytes), producerSha256: installerSha256, sourceDigest } };
  let sequence = 0;
  const write = (value) => {
    const path = join(build, `${sequence++}.json`), bytes = Buffer.from(JSON.stringify(value));
    fs.writeFileSync(path, bytes, { flag: "wx", mode: 0o600 });
    return { path, sha256: hash(bytes) };
  };
  const base = ["--expected-head", head, "--expected-source-digest", sourceDigest,
    "--expected-helper-sha256", helperSha256];
  const args = (pin) => [...base, "--qualified-closure", pin.path, "--expected-closure-sha256", pin.sha256];
  const validPin = write(admission), valid = args(validPin);
  const cases = [];
  for (const [name, index] of [["head", 1], ["source", 3], ["helper", 5], ["descriptor hash", 9]]) {
    const changed = [...valid]; changed[index] = "0".repeat(index === 1 ? 40 : 64);
    cases.push([name, changed]);
  }
  for (const field of ["installerSha256", "qualification"]) {
    const changed = structuredClone(admission); delete changed[field];
    cases.push([`missing ${field}`, args(write(changed))]);
  }
  cases.push(["consumer pin", args(write({ ...admission, installerSha256: "0".repeat(64) }))]);
  for (const field of ["sha256", "producerSha256", "sourceDigest"]) {
    const changed = structuredClone(admission); changed.qualification[field] = "0".repeat(64);
    cases.push([`origin ${field}`, args(write(changed))]);
  }
  const withReceipt = (value) => ({ ...admission, qualification: { ...admission.qualification, ...write(value) } });
  const missingRole = structuredClone(receipt); delete missingRole.files["source-snapshot.mjs"];
  cases.push(["missing role", args(write(withReceipt(missingRole)))]);
  const wrongRole = structuredClone(receipt); wrongRole.files["dist/scripts/opencode.js"].sha256 = "0".repeat(64);
  cases.push(["role hash", args(write(withReceipt(wrongRole)))]);
  const oversizedRole = structuredClone(receipt); oversizedRole.files["dist/scripts/opencode.js"].bytes = 16 * 1024 * 1024 + 1;
  cases.push(["role bound", args(write(withReceipt(oversizedRole)))]);
  const wrongLineage = structuredClone(receipt); wrongLineage.selectedCurrentSourceLineage["packages/ingenium-extension/scripts/opencode.ts"] = "0".repeat(64);
  cases.push(["source lineage", args(write(withReceipt(wrongLineage)))]);
  const symlink = join(build, "descriptor-link.json"); fs.symlinkSync(validPin.path, symlink);
  cases.push(["descriptor symlink", args({ ...validPin, path: symlink })]);
  const sharedPin = write(admission); fs.linkSync(sharedPin.path, join(build, "descriptor-hardlink.json"));
  cases.push(["descriptor nlink", args(sharedPin)]);
  const artifactLink = join(build, "artifact-link"); fs.symlinkSync(artifact, artifactLink);
  cases.push(["artifact ancestry symlink", args(write(withReceipt({ ...receipt, artifact: artifactLink })))]);
  cases.push(["outside build territory", args({ ...validPin, path: join(root, "qualification.json") })]);
  const tooLarge = join(build, "oversized.json"), largeBytes = Buffer.alloc(64 * 1024 + 1, 32);
  fs.writeFileSync(tooLarge, largeBytes, { flag: "wx", mode: 0o600 });
  cases.push(["descriptor bound", args({ path: tooLarge, sha256: hash(largeBytes) })]);

  const restore = [], attempts = [];
  try {
    const open = fs.openSync;
    restore.push(() => { fs.openSync = open; });
    fs.openSync = (path, flags, ...rest) => {
      const writable = typeof flags === "string" ? !["r", "rs"].includes(flags)
        : flags & (fs.constants.O_WRONLY | fs.constants.O_RDWR | fs.constants.O_CREAT | fs.constants.O_TRUNC | fs.constants.O_APPEND);
      if (writable) { attempts.push("openSync:write"); throw new Error("Unexpected consumer write descriptor"); }
      return open(path, flags, ...rest);
    };
    for (const [object, names] of [[childProcess, ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]],
      [fs, ["writeFileSync", "mkdirSync", "renameSync", "unlinkSync", "fchmodSync", "fsyncSync"]]]) {
      for (const name of names) {
        const original = object[name]; restore.push(() => { object[name] = original; });
        object[name] = () => { attempts.push(name); throw new Error(`Unexpected consumer effect: ${name}`); };
      }
    }
    syncBuiltinESMExports();
    assert.equal(parseInstallerArgs(base), head);
    assert.equal(Object.hasOwn(prepareInstallerInvocation(base.slice(0, 2), root).options, "build"), false);
    assert.equal(Object.hasOwn(prepareInstallerInvocation(base, root).options, "build"), false);
    assert.throws(() => prepareInstallerInvocation(valid.slice(0, -1), root), /Usage/);
    assert.throws(() => prepareInstallerInvocation([...valid, "--unknown"], root), /Usage/);
    const invocation = prepareInstallerInvocation(valid, root);
    assert.equal(invocation.expectedHead, head);
    assert.equal(typeof invocation.options.build, "function");
    assert.throws(() => invocation.options.build(`${root}/other`), /root changed/);
    const output = invocation.options.build(root);
    assert.deepEqual(Object.keys(output).sort(), Object.keys(receipt.files).sort());
    for (const [name, bytes] of Object.entries(output)) {
      assert(Buffer.isBuffer(bytes) && bytes.length > 0);
      assert.equal(bytes.length, receipt.files[name].bytes);
      assert.equal(hash(bytes), receipt.files[name].sha256);
      assert(bytes.equals(fs.readFileSync(join(artifact, name))));
    }
    for (const [name, argv] of cases) assert.throws(() => prepareInstallerInvocation(argv, root), undefined, name);
    assert.deepEqual(attempts, []);
  } finally {
    for (const undo of restore.reverse()) undo();
    syncBuiltinESMExports();
  }
  t.diagnostic(JSON.stringify({ check: "SYNTHETIC_QUALIFIED_CLOSURE_CONSUMER_PASS", rejected: cases.map(([name]) => name),
    effectAttempts: attempts, realPublicValidatorBytes: installerSha256, hostInstallerInvoked: false }));
});
