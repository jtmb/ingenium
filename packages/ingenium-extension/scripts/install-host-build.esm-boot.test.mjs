import assert from "node:assert/strict";
import childProcess from "node:child_process";
import { createHash } from "node:crypto";
import fs from "node:fs";
import { isBuiltin, syncBuiltinESMExports } from "node:module";
import net from "node:net";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { SourceTextModule, SyntheticModule } from "node:vm";

const [providedInput, output, previous] = process.argv.slice(2);
const tmpdir = process.env.TMPDIR;
if (!providedInput) assert(tmpdir?.startsWith("/tmp/opencode/ci-extension-mjs-fixture-"), "Use a private run-owned TMPDIR");
const fixture = providedInput ? null : fs.mkdtempSync(join(tmpdir, "esm-boot-"));
const input = providedInput ?? join(fixture, "synthetic-bundle.mjs");
try {
if (fixture) {
  const synthetic = Buffer.from([
    'import { createRequire as __hostCreateRequire } from "node:module";',
    'const require = __hostCreateRequire(import.meta.url);',
    'if (require.resolve("node:path") !== "node:path") throw new Error("ESM entry resolution failed");',
    "var __create = Object.create;",
    "function __toESM(value) { return { default: value }; }",
    'function require_cross_spawn() { return () => { throw new Error("Synthetic spawn invoked"); }; }',
    "var import_cross_spawn = __toESM(require_cross_spawn(), 1);",
    'async function runManagedTui() { throw new Error("Managed TUI invoked"); }',
    "process.exitCode = await runManagedTui();",
    "",
  ].join("\n"));
  const expected = createHash("sha256").update(synthetic).digest("hex");
  fs.writeFileSync(input, synthetic, { flag: "wx", mode: 0o600 });
  assert.equal(createHash("sha256").update(fs.readFileSync(input)).digest("hex"), expected);
}
const root = resolve(dirname(fileURLToPath(import.meta.url)), "../../..");
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
let bytes;
if (output) {
  assert(resolve(output).startsWith(`${root}/build/`));
  const workspace = resolve(input);
  const packageRoot = resolve(workspace, "packages/ingenium-extension");
  const entry = JSON.parse(fs.readFileSync(resolve(packageRoot, "package.json"))).bin["ingenium-opencode"];
  assert.equal(entry, "./dist/scripts/opencode.js");
  const { bundlePrivateLauncher } = await import("./install-host-build.mjs");
  const cwd = process.cwd();
  try {
    process.chdir(workspace);
    bytes = await bundlePrivateLauncher(workspace, resolve(packageRoot, entry.slice(7, -3) + ".ts"));
  } finally { process.chdir(cwd); }
  assert(Buffer.isBuffer(bytes) && bytes.length > 0);
  fs.writeFileSync(resolve(output), bytes, { flag: "wx", mode: 0o600 });
} else bytes = fs.readFileSync(resolve(input));

const code = bytes.toString();
if (process.env.EXPECTED_BUNDLE_SHA256) assert.equal(sha256(bytes), process.env.EXPECTED_BUNDLE_SHA256);
if (previous) {
  const prior = fs.readFileSync(resolve(previous), "utf8");
  const body = "var __create = Object.create;";
  assert(code.includes(body) && prior.includes(body));
  assert.equal(code.slice(code.indexOf(body)), prior.slice(prior.indexOf(body)), "Only the emitted preamble may change");
}
const footer = "process.exitCode = await runManagedTui();\n";
assert(code.endsWith(footer), "Managed CLI boundary changed; inspect before running this check");
assert.equal(code.split("runManagedTui(").length, 3);
assert(code.includes("var import_cross_spawn = __toESM(require_cross_spawn(), 1);"));
assert.equal(typeof globalThis.require, "undefined");

// The published-bundle path retains real initialization; the no-argument path exercises only synthetic ESM boot.
const prefix = code.slice(0, -footer.length) + "\nexport const bootInitialized = typeof import_cross_spawn.default === 'function';\n";
const identifier = pathToFileURL(resolve(output ?? input)).href;
new SourceTextModule(code, { identifier });
const module = new SourceTextModule(prefix, {
  identifier,
  initializeImportMeta(meta) { meta.url = identifier; },
  importModuleDynamically() { throw new Error("Dynamic import during boot-prefix check"); },
});
const linked = new Map();
const attempts = [], restore = [];
const unguardedFunctions = new Set();
try {
  for (const [object, names] of [
    [childProcess, ["spawn", "spawnSync", "exec", "execSync", "execFile", "execFileSync", "fork"]],
    [net.Server.prototype, ["listen"]], [net.Socket.prototype, ["connect"]],
    [fs, ["open", "openSync", "readFile", "readFileSync", "writeFile", "writeFileSync", "mkdirSync", "statSync", "lstatSync", "realpathSync", "readdirSync", "readlinkSync", "accessSync", "existsSync", "watch"]],
    [process, ["exit", "kill", "abort"]],
    [globalThis, ["fetch", "setTimeout", "setInterval", "setImmediate"]],
  ]) for (const name of names) {
    const original = object[name];
    restore.push(() => { object[name] = original; });
    unguardedFunctions.add(original);
    object[name] = () => { attempts.push(name); throw new Error(`Unexpected boot I/O: ${name}`); };
  }
  syncBuiltinESMExports();
  await module.link(async (specifier) => {
    assert(isBuiltin(specifier), `Unexpected boot dependency: ${specifier}`);
    const id = specifier.startsWith("node:") ? specifier : `node:${specifier}`;
    if (!linked.has(id)) {
      const entries = Object.entries(await import(id));
      for (const [name, value] of entries) assert(!unguardedFunctions.has(value), `Unguarded builtin export: ${id}.${name}`);
      linked.set(id, new SyntheticModule(entries.map(([name]) => name), function () {
        for (const [name, value] of entries) this.setExport(name, value);
      }));
    }
    return linked.get(id);
  });
  console.log(JSON.stringify({ check: "ESM_BOOT_PREFIX_START", bundle: identifier, bytes: bytes.length, sha256: sha256(bytes) }));
  await module.evaluate({ timeout: 5000 });
  assert.equal(module.namespace.bootInitialized, true);
  assert.deepEqual(attempts, []);
} finally {
  for (const undo of restore.reverse()) undo();
  syncBuiltinESMExports();
}
console.log(JSON.stringify({ check: fixture ? "SYNTHETIC_ESM_BOOT_PREFIX_PASS" : "ESM_BOOT_PREFIX_PASS", bytes: bytes.length, sha256: sha256(bytes), fullBundleSyntax: "passed", linkedBuiltins: [...linked.keys()].sort(), guardedBuiltinSnapshots: true, crossSpawnInitialized: true, ioAttempts: attempts, managedCallExecuted: false }));
} finally {
  if (fixture) fs.rmSync(fixture, { recursive: true, force: true });
}
