import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import test from "node:test";
import { productionScope, scopeDigest, programDigest, parseRecoveryArgs } from "./host-install-recovery.mjs";

const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
const previousVerifier = "/tmp/opencode/ingenium-external-verifier-20261007/verifier.mjs";
const previousVerifierSha256 = "335c791cf65bfafa5a6070bea3df97442824ce3da390b4b3f9b3aea9840d753e";

test("binds the current public production scope without reading the installed verifier", () => {
  assert.deepEqual(productionScope, {
    root: "/home/brajam/repos/ingenium",
    home: "/home/brajam",
    node: "/home/brajam/.nvm/versions/node/v22.23.1/bin/node",
    nodeSha256: "93956de2e59480474a7b46571da1651180b1a050cdf32641ebec4ce6e478e068",
    installerSha256: "c88f8cfe8fb36f752de5583d8f466d38f8351f904a22479241056e9120821613",
    helperSha256: "435498222616863c6f6941831907535bd29db49fd2405b6ff4d9cfb0f03ee8f0",
    verifier: "/home/brajam/.local/share/ingenium/verified-programs/verifier-e28be68b-20261009-001/verifier.mjs",
    verifierSha256: "e28be68bcbea7553932429e1abedeca58e7f02f4d55a80f8ed93b31b7e63ecee",
  });
  assert.ok(Object.isFrozen(productionScope));
  assert.equal(sha256(readFileSync(new URL("./install-host-build.mjs", import.meta.url))), productionScope.installerSha256);
});

test("checks installed verifier bytes only with explicit protected-owner admission", {
  skip: process.env.INGENIUM_TEST_INSTALLED_VERIFIER !== "1" && "Requires protected installed-verifier admission",
}, () => {
  const retainedBytes = readFileSync(productionScope.verifier);
  assert.equal(retainedBytes.length, 9395);
  assert.equal(sha256(retainedBytes), productionScope.verifierSha256);
});

test("changes scope and program digests when verifier fields are substituted in current public source", (t) => {
  const previousScope = {
    ...productionScope, verifier: previousVerifier, verifierSha256: previousVerifierSha256,
  };
  const currentScopeDigest = scopeDigest(productionScope);
  const previousScopeDigest = scopeDigest(previousScope);
  const currentProgramDigest = programDigest();
  assert.notEqual(currentScopeDigest, previousScopeDigest);

  const source = readFileSync(new URL("./host-install-recovery.mjs", import.meta.url), "utf8");
  assert.equal(currentProgramDigest, sha256(source));
  assert.equal(currentProgramDigest, "4827edf0768252193b6d582ba9dae55939a04bd208276887b5ea25aacfb46257");
  const previousSource = source
    .replace(`  verifier: ${JSON.stringify(productionScope.verifier)},\n`, `  verifier: ${JSON.stringify(previousVerifier)},\n`)
    .replace(`  verifierSha256: ${JSON.stringify(productionScope.verifierSha256)},\n`, `  verifierSha256: ${JSON.stringify(previousVerifierSha256)},\n`);
  assert.notEqual(sha256(previousSource), currentProgramDigest);
  assert.equal(previousSource
    .replace(`  verifier: ${JSON.stringify(previousVerifier)},\n`, `  verifier: ${JSON.stringify(productionScope.verifier)},\n`)
    .replace(`  verifierSha256: ${JSON.stringify(previousVerifierSha256)},\n`, `  verifierSha256: ${JSON.stringify(productionScope.verifierSha256)},\n`), source);
  t.diagnostic(JSON.stringify({
    scopeDigest: currentScopeDigest, previousScopeDigest, programDigest: currentProgramDigest,
    sourceBytes: Buffer.byteLength(source), unchangedExceptTwoBindingValues: true,
  }));
});

test("keeps exactly three recovery arguments and rejects path or override arguments", () => {
  const operation = "a".repeat(64);
  const authorization = "b".repeat(64);
  for (const action of ["prepare", "run", "status", "adopt", "restore"]) {
    const args = [action, operation, authorization];
    assert.deepEqual(parseRecoveryArgs(args), args);
  }
  const args = ["status", operation, authorization];
  const invalid = [
    [], args.slice(0, 2), [...args, "extra"], [...args, "--verifier", productionScope.verifier],
    ["unknown", operation, authorization],
    ["status", productionScope.verifier, authorization],
    ["status", operation, productionScope.verifier],
    ["status", "A".repeat(64), authorization],
    ["status", operation.slice(1), authorization],
    ["status", operation, ""],
  ];
  for (const input of invalid) {
    assert.throws(() => parseRecoveryArgs(input), {
      message: "Usage: host-install-recovery.mjs <prepare|run|status|adopt|restore> <operation-sha256> <authorization-sha256>",
    });
  }
});
