import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { createHash } from "node:crypto";
import { closeSync, constants, fstatSync, lstatSync, openSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { runInNewContext } from "node:vm";

const validator = "scripts/validate-root-entrypoint-chain.mjs";
const testPath = "tests/source181-root-artifact-diagnostic.test.mjs";
const head = "0181e990fa52ff950e4ec90e75e1b54814a3801f";
const oldBlob = "8b4744b3d20a86799ae0a5cc476c06e56e5f86e0";
const heldSha = "a06616cfe88444dc3fe64d87953ce58cf9d02f7aa3e8f7a6c66600179cde0820";
const heldMetadata = ["2096", "2929524", "33212", "1000", "1000", "1", "3644", "1790107476685926912", "1790107476685926912"];
const git = (...args) => execFileSync("git", args);
const hash = (bytes) => createHash("sha256").update(bytes).digest("hex");
const statFields = (s) => [s.dev, s.ino, s.mode, s.uid, s.gid, s.nlink, s.size, s.mtimeNs, s.ctimeNs].map(String);

const diagnostic = [
  "function fail(path, reason) {",
  "  const publicPath = exactModes.has(path) ? path",
  '    : immutableTrees.some((root) => path === root || path.startsWith(`${root}/`))',
  '      ? path.split("/").map((part) => /^[\\w.@+-]*$/.test(part) && !/(?:secret|credential|token|password|private|(?:^|[._-])key(?:$|[._-])|^\\.env)/i.test(part) ? part : "<redacted>").join("/")',
  '      : "<redacted>";',
  '  process.stderr.write(`ERROR: root entrypoint artifact chain is unsafe: ${publicPath}: ${reason}\\n`);',
  "  process.exit(1);",
  "}",
  "",
].join("\n");

const edits = [
  ["const visited = new Set();\n", 'const visited = new Set();\nlet currentPath = "<unknown>";\n'],
  ['function fail() {\n  process.stderr.write("ERROR: root entrypoint artifact chain is unsafe\\n");\n  process.exit(1);\n}\n', diagnostic],
  [
    '  if (metadata.uid !== 0 || metadata.gid !== 0) fail();\n  if (!metadata.isSymbolicLink() && (metadata.mode & 0o022) !== 0) fail();\n  const exactMode = exactModes.get(path);\n  if (exactMode !== undefined && (metadata.mode & 0o777) !== exactMode) fail();\n',
    '  if (metadata.uid !== 0 || metadata.gid !== 0) fail(path, "uid-gid");\n  if (!metadata.isSymbolicLink() && (metadata.mode & 0o022) !== 0) fail(path, "writable");\n  const exactMode = exactModes.get(path);\n  if (exactMode !== undefined && (metadata.mode & 0o777) !== exactMode) fail(path, "exact-mode");\n',
  ],
  ["function validateTree(path) {\n  const metadata = lstatSync(path);\n", "function validateTree(path) {\n  currentPath = path;\n  const metadata = lstatSync(path);\n"],
  [
    'try {\n  for (const path of exactModes.keys()) validateMetadata(path, lstatSync(path));\n  if (readlinkSync("/etc/opencode/opencode.json") !== "/usr/local/share/ingenium/opencode-managed/opencode.json") fail();\n  for (const path of immutableTrees) validateTree(path);\n} catch {\n  fail();\n}\n',
    [
      "try {",
      "  for (const path of exactModes.keys()) {",
      "    currentPath = path;",
      "    validateMetadata(path, lstatSync(path));",
      "  }",
      '  currentPath = "/etc/opencode/opencode.json";',
      '  if (readlinkSync(currentPath) !== "/usr/local/share/ingenium/opencode-managed/opencode.json") fail(currentPath, "link-target");',
      "  for (const path of immutableTrees) validateTree(path);",
      "} catch (error) {",
      '  fail(currentPath, ["ENOENT", "EACCES", "ENOTDIR", "ELOOP"].includes(error?.code) ? `fs-${error.code}` : "fs-error");',
      "}",
      "",
    ].join("\n"),
  ],
];

function pinnedWork() {
  const before = lstatSync(validator, { bigint: true });
  assert(before.isFile() && before.nlink === 1n && before.uid === BigInt(process.getuid()));
  assert.deepEqual(statFields(before), heldMetadata);
  const fd = openSync(validator, constants.O_RDONLY | constants.O_NOFOLLOW);
  try {
    assert.deepEqual(statFields(fstatSync(fd, { bigint: true })), heldMetadata);
    const bytes = readFileSync(fd);
    assert.deepEqual(statFields(fstatSync(fd, { bigint: true })), heldMetadata);
    assert.equal(hash(bytes), heldSha);
  } finally {
    closeSync(fd);
  }
}

function selected(staged) {
  assert.equal(git("rev-parse", "HEAD").toString().trim(), head);
  assert.equal(git("rev-parse", `${head}:${validator}`).toString().trim(), oldBlob);
  assert.deepEqual(git("diff", "--cached", "--name-only").toString().trim().split("\n"), staged ? [validator, testPath] : [""]);
  pinnedWork();
  const source = git("show", `${head}:${validator}`).toString();
  let candidate = "";
  let patch = `diff --git a/${validator} b/${validator}\n--- a/${validator}\n+++ b/${validator}\n`;
  let cursor = 0;
  let delta = 0;
  for (const [oldText, newText] of edits) {
    const offset = source.indexOf(oldText, cursor);
    assert(offset >= cursor && source.indexOf(oldText, offset + oldText.length) < 0, "selected hunk must occur once");
    assert(oldText.endsWith("\n") && newText.endsWith("\n"));
    candidate += source.slice(cursor, offset) + newText;
    const oldLine = source.slice(0, offset).split("\n").length;
    const oldCount = oldText.split("\n").length - 1;
    const newCount = newText.split("\n").length - 1;
    patch += `@@ -${oldLine},${oldCount} +${oldLine + delta},${newCount} @@\n`;
    patch += oldText.split("\n").slice(0, -1).map((line) => `-${line}\n`).join("");
    patch += newText.split("\n").slice(0, -1).map((line) => `+${line}\n`).join("");
    cursor = offset + oldText.length;
    delta += newCount - oldCount;
  }
  candidate += source.slice(cursor);
  assert.equal(source.slice(source.indexOf("const exactModes"), source.indexOf("const visited")), candidate.slice(candidate.indexOf("const exactModes"), candidate.indexOf("const visited")));
  if (staged) assert.equal(git("show", `:${validator}`).toString(), candidate);
  return { source, candidate, patch };
}

const cases = [
  ["safe", 0, ""],
  ["owner", 1, "/app/scripts: uid-gid"],
  ["writable", 1, "/app/docs/public-fixture.js: writable"],
  ["exact-mode", 1, "/app/scripts: exact-mode"],
  ["link-target", 1, "/etc/opencode/opencode.json: link-target"],
  ["missing", 1, "/app/scripts: fs-ENOENT"],
  ["fs-error", 1, "/app/scripts: fs-error"],
  ["redact", 1, "/app/docs/<redacted>: fs-EACCES"],
  ["first", 1, "/app/services: uid-gid"],
];

function worker(scenario) {
  const source = readFileSync(0, "utf8");
  const imports = '#!/usr/bin/env node\nimport { lstatSync, readdirSync, readlinkSync } from "node:fs";\nimport { join } from "node:path";\n';
  assert(source.startsWith(imports));
  const modes = new Map([...source.matchAll(/^  \["([^"]+)", 0o([0-7]+)\],?$/gm)].map(([, path, mode]) => [path, Number.parseInt(mode, 8)]));
  const roots = [...source.slice(source.indexOf("const immutableTrees = ["), source.indexOf("const visited = new Set();")).matchAll(/^  "(\/[^\"]+)",?$/gm)].map(([, path]) => path);
  assert.equal(modes.get("/usr/local/share/ingenium/opencode-managed/plugins/enforce-reserved-broker.mjs"), 0o444);
  assert(!modes.has("/usr/local/share/ingenium/opencode-managed/plugins/enforce-reserved-broker/index.mjs"));
  assert.equal(roots.length, 9);
  const dirs = new Set(["/app", "/app/packages", "/app/services", "/app/services/ingenium-api", "/app/scripts", "/app/docs", "/app/.opencode", "/app/nginx", "/app/node_modules", "/usr/local/share/ingenium/opencode-managed", "/usr/local/share/ingenium/opencode-managed/agents", "/usr/local/share/ingenium/opencode-managed/plugins", "/etc/opencode"]);
  const fs = {
    lstatSync(path) {
      if ((scenario === "missing" || scenario === "fs-error") && path === "/app/scripts") throw Object.assign(new Error("PRIVATE_MARKER"), { code: scenario === "missing" ? "ENOENT" : "PRIVATE_MARKER" });
      if (scenario === "redact" && path === "/app/docs/.env.production") throw Object.assign(new Error("PRIVATE_MARKER"), { code: "EACCES" });
      const symlink = path === "/etc/opencode/opencode.json";
      const mode = scenario === "writable" && path === "/app/docs/public-fixture.js" ? 0o666 : scenario === "exact-mode" && path === "/app/scripts" ? 0o544 : modes.get(path) ?? (dirs.has(path) ? 0o555 : 0o444);
      const uid = ((scenario === "owner" && path === "/app/scripts") || (scenario === "first" && ["/app/services", "/app/scripts"].includes(path))) ? 1000 : 0;
      return { uid, gid: 0, mode, dev: 1, ino: path.length, isSymbolicLink: () => symlink, isDirectory: () => dirs.has(path) };
    },
    readdirSync(path) {
      return path === "/app/docs" ? [scenario === "redact" ? ".env.production" : "public-fixture.js"] : [];
    },
    readlinkSync(path) {
      assert.equal(path, "/etc/opencode/opencode.json");
      return scenario === "link-target" ? "/PRIVATE_MARKER" : "/usr/local/share/ingenium/opencode-managed/opencode.json";
    },
  };
  runInNewContext('const { lstatSync, readdirSync, readlinkSync } = __fs; const { join } = __path;\n' + source.slice(imports.length), { __fs: fs, __path: { join }, process }, { timeout: 1000 });
}

function verify(source, strict) {
  for (const [scenario, code, detail] of cases) {
    const child = spawnSync(process.execPath, [process.argv[1], "--worker", scenario], { input: source, encoding: "utf8", timeout: 3000 });
    assert.equal(child.status, code, `${scenario}: ${child.error?.message ?? child.stderr}`);
    assert.equal(child.stdout, "", scenario);
    assert.equal(child.stderr, detail && strict ? `ERROR: root entrypoint artifact chain is unsafe: ${detail}\n` : code ? "ERROR: root entrypoint artifact chain is unsafe\n" : "", scenario);
    assert(!child.stderr.includes("PRIVATE_MARKER") && !child.stderr.includes(".env.production"));
  }
}

if (process.argv[2] === "--worker") {
  worker(process.argv[3]);
} else {
  const mode = process.argv[2];
  if (mode === "--current" || mode === "--current-staged") {
    const baseline = git("show", `${head}:${validator}`).toString();
    const current = git("show", mode === "--current" ? `HEAD:${validator}` : `:${validator}`).toString();
    verify(baseline, false);
    verify(current, true);
    console.log("D181_CURRENT_VALIDATOR_PASS", { mode, sourceSha256: hash(current), baselineSha256: hash(baseline), cases: cases.length });
  } else {
    const { source, candidate, patch } = selected(mode === "--staged");
    if (mode === "--patch") {
      process.stdout.write(patch);
    } else if (["--baseline", "--candidate", "--staged"].includes(mode)) {
      verify(source, false);
      verify(mode === "--baseline" ? source : candidate, true);
      console.log("D181_FIRST_FAILURE_CONTEXT_PASS", { mode, candidateSha256: hash(candidate), baselineSha256: hash(source), cases: cases.length });
    } else {
      throw new Error("select --baseline, --candidate, --staged, --current, --current-staged or --patch");
    }
  }
}
