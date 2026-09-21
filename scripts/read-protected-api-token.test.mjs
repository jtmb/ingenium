#!/usr/bin/env node
import assert from "node:assert/strict";
import { existsSync, mkdtempSync, readFileSync, statSync, symlinkSync, writeFileSync, chmodSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

const root = mkdtempSync(join(tmpdir(), "ingenium-api-token-reader-"));
const helper = new URL("./read-protected-api-token.mjs", import.meta.url);
const uid = process.getuid();
const gid = process.getgid();
const token = "a".repeat(64);

function run(source, expectedUid = uid, expectedGid = gid, kind = "installation-api") {
  const destination = join(root, `destination-${Math.random().toString(16).slice(2)}`);
  const result = spawnSync(
    process.execPath,
    [helper.pathname, source, String(expectedUid), String(expectedGid), destination, kind, String(uid), String(gid)],
    { encoding: "utf8" },
  );
  return { ...result, destination };
}

function expectFailure(source, expectedUid = uid, expectedGid = gid, sensitive = token, kind = "installation-api") {
  const result = run(source, expectedUid, expectedGid, kind);
  assert.notEqual(result.status, 0);
  assert.equal(result.stdout.includes(sensitive), false);
  assert.equal(result.stderr.includes(sensitive), false);
  assert.equal(result.stderr, "ERROR: protected deployment secret is missing or unsafe\n");
  assert.equal(existsSync(result.destination), false);
}

try {
  const valid = join(root, "valid");
  writeFileSync(valid, `${token}\n`, { mode: 0o600 });
  const success = run(valid);
  assert.equal(success.status, 0);
  assert.equal(success.stdout, "");
  assert.equal(success.stderr, "");
  assert.equal(readFileSync(success.destination, "utf8"), `${token}\n`);
  const destinationMetadata = statSync(success.destination);
  assert.equal(destinationMetadata.mode & 0o777, 0o600);
  assert.equal(destinationMetadata.uid, uid);
  assert.equal(destinationMetadata.gid, gid);

  const linked = join(root, "linked");
  symlinkSync(valid, linked);
  expectFailure(linked);
  expectFailure(valid, uid + 1, gid);
  expectFailure(valid, uid, gid + 1);

  for (const mode of [0o640, 0o644]) {
    const unsafe = join(root, `mode-${mode.toString(8)}`);
    writeFileSync(unsafe, `${token}\n`, { mode: 0o600 });
    chmodSync(unsafe, mode);
    expectFailure(unsafe);
  }

  const malformed = join(root, "malformed");
  const malformedValue = "malformed token material must stay private";
  writeFileSync(malformed, `${malformedValue}\n`, { mode: 0o600 });
  expectFailure(malformed, uid, gid, malformedValue);
  expectFailure(join(root, "missing"));

  const learning = join(root, "learning");
  const learningToken = `ing_${"a".repeat(12)}_${"b".repeat(43)}`;
  writeFileSync(learning, `${learningToken}\n`, { mode: 0o600 });
  const projected = run(learning, uid, gid, "mcp-learning");
  assert.equal(projected.status, 0);
  assert.equal(readFileSync(projected.destination, "utf8"), `${learningToken}\n`);
  assert.equal(statSync(projected.destination).mode & 0o777, 0o600);
  const generalToken = join(root, "general-token");
  writeFileSync(generalToken, `${token}\n`, { mode: 0o600 });
  expectFailure(generalToken, uid, gid, token, "mcp-learning");
  expectFailure(learning, uid + 1, gid, learningToken, "mcp-learning");
  expectFailure(join(root, "missing-learning"), uid, gid, token, "mcp-learning");
  console.log("PASS: protected credential projection validates learning tokens and fails closed without disclosure");
} finally {
  rmSync(root, { recursive: true, force: true });
}
