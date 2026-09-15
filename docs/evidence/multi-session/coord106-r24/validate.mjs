#!/usr/bin/env node

import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const bundleDirectory = dirname(fileURLToPath(import.meta.url));
const requiredPayloads = [
  "README.md",
  "artifact-ledger.json",
  "event-excerpts.json",
  "proof.json",
  "validate.mjs",
];

function fail(message) {
  throw new Error(`proof validation failed: ${message}`);
}

function read(name) {
  return readFileSync(join(bundleDirectory, name));
}

function json(name) {
  try {
    return JSON.parse(read(name).toString("utf8"));
  } catch {
    return fail(`${name} is not valid JSON`);
  }
}

function sha256(contents) {
  return createHash("sha256").update(contents).digest("hex");
}

function expect(condition, message) {
  if (!condition) fail(message);
}

function inspectKeys(value, source) {
  if (Array.isArray(value)) {
    value.forEach((item) => inspectKeys(item, source));
    return;
  }
  if (value === null || typeof value !== "object") return;
  const forbiddenKey = /^(?:session(?:id|hash)?|actorid|peerid|incarnation|fence(?:id|token)?|claimid|pid|port|token|password|prompt|reasoning|command|output|sourcebody|diff|path)$/i;
  for (const [key, child] of Object.entries(value)) {
    expect(!forbiddenKey.test(key), `${source} contains forbidden field ${key}`);
    inspectKeys(child, source);
  }
}

function inspectCorpus(name) {
  const contents = read(name).toString("utf8");
  const forbidden = [
    [/(?:^|\s)\/home\//m, "absolute home location"],
    [/tests\/c24\//, "raw mutation target"],
    [/\bdGVzdHM\b/, "encoded raw mutation target"],
    [/\b[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}\b/i, "raw UUID"],
    [/\b(?:actor|peer)-[0-9a-f]{16,}\b/i, "raw actor or peer identifier"],
    [/\bsession-[0-9a-f]{8,}\b/i, "raw session identifier"],
    [/\bing_[A-Za-z0-9_-]{12}_[A-Za-z0-9_-]{43}\b/, "credential value"],
    [/(?<![0-9a-f])[0-9a-f]{16}(?![0-9a-f])/i, "raw short operational hash"],
    [/(?<![0-9a-z])\d{13}(?![0-9a-z])/i, "raw incarnation marker"],
    [/(?:localhost|127\.0\.0\.1):\d+/, "raw listener marker"],
  ];
  for (const [pattern, label] of forbidden) {
    expect(!pattern.test(contents), `${name} contains ${label}`);
  }
  if (name.endsWith(".json")) inspectKeys(JSON.parse(contents), name);
}

function validateManifest() {
  const manifest = json("bundle-checksums.json");
  expect(manifest.schema === "ingenium.multi-session-bundle-checksums/v1", "checksum manifest schema mismatch");
  expect(manifest.schemaVersion === 1 && manifest.digestAlgorithm === "sha256", "checksum manifest version mismatch");
  expect(Array.isArray(manifest.files), "checksum manifest files missing");
  const names = manifest.files.map(({ name }) => name).sort();
  expect(JSON.stringify(names) === JSON.stringify([...requiredPayloads].sort()), "checksum manifest payload set mismatch");
  for (const entry of manifest.files) {
    expect(/^[a-f0-9]{64}$/.test(entry.sha256), `invalid digest for ${entry.name}`);
    expect(sha256(read(entry.name)) === entry.sha256, `checksum mismatch for ${entry.name}`);
  }
}

function validateSchemas() {
  const proof = json("proof.json");
  const ledger = json("artifact-ledger.json");
  const excerpts = json("event-excerpts.json");
  expect(proof.schema === "ingenium.multi-session-proof/v1" && proof.schemaVersion === 1, "proof schema mismatch");
  expect(proof.result === "PASS" && proof.originalRun?.retainedArtifactCount === 29, "proof result mismatch");
  expect(JSON.stringify(proof.actualProcessClasses?.map(({ label }) => label)) === JSON.stringify(["external-a", "external-b", "internal-c"]), "process classes mismatch");
  expect(proof.runtime?.openCodeVersion === "1.18.9" && proof.runtime?.model === "gpt-5.6-sol", "runtime version mismatch");
  expect(Array.isArray(proof.gateRecords) && proof.gateRecords.length >= 20, "gate records incomplete");
  expect(proof.gateRecords.every(({ status }) => status === "PASS"), "non-PASS gate retained");
  expect(proof.sourceProvenance?.acceptedSourceCapture?.directParent === proof.originalRun.reportedRepositoryRevision, "source capture lineage mismatch");
  expect(proof.sourceProvenance?.protectedReset?.r24BehaviorExercised === false, "reset/r24 boundary mismatch");

  expect(ledger.schema === "ingenium.multi-session-artifact-ledger/v1" && ledger.schemaVersion === 1, "ledger schema mismatch");
  expect(Array.isArray(ledger.artifacts) && ledger.artifacts.length === 29, "ledger count mismatch");
  expect(new Set(ledger.artifacts.map(({ name }) => name)).size === 29, "ledger names are not unique");
  expect(ledger.artifacts.every(({ name, sha256: digest, classification }) => basename(name) === name && /^[a-f0-9]{64}$/.test(digest) && typeof classification === "string"), "ledger entry invalid");

  expect(excerpts.schema === "ingenium.multi-session-sanitized-events/v1" && excerpts.schemaVersion === 1, "excerpt schema mismatch");
  expect(excerpts.redaction?.rawOperationalIdentifiersIncluded === false && excerpts.redaction?.rawCredentialsIncluded === false, "excerpt redaction mismatch");
  const events = new Set(excerpts.events?.map(({ event }) => event));
  for (const required of ["three_processes_ready", "peer_memory_injected", "memory_derived_read_completed", "independent_writes_completed", "same_target_conflict", "crash_quarantine_recovery", "restart_replay", "privacy_cleanup_health"]) {
    expect(events.has(required), `missing event ${required}`);
  }
  expect(excerpts.events.every(({ sequence }, index) => sequence === index + 1), "event ordering mismatch");
}

function validateOriginals(originalDirectory) {
  const directory = resolve(originalDirectory);
  const ledger = json("artifact-ledger.json");
  const originalChecksums = JSON.parse(readFileSync(join(directory, "checksums.json"), "utf8"));
  expect(Object.keys(originalChecksums).length === 29, "original checksum count mismatch");
  for (const artifact of ledger.artifacts) {
    expect(originalChecksums[artifact.name] === artifact.sha256, `original ledger mismatch for ${artifact.name}`);
    expect(sha256(readFileSync(join(directory, artifact.name))) === artifact.sha256, `original checksum mismatch for ${artifact.name}`);
  }
  const privacy = JSON.parse(readFileSync(join(directory, "privacy.json"), "utf8"));
  expect(privacy.jsonFilesInspected === 29, "original privacy count mismatch");
  expect(privacy.credentialsExcluded === true && privacy.rawSessionIdsExcluded === true && privacy.rawFenceAndClaimIdsExcluded === true, "original privacy assertions failed");
}

function main() {
  validateManifest();
  validateSchemas();
  for (const name of ["README.md", "artifact-ledger.json", "event-excerpts.json", "proof.json", "bundle-checksums.json"]) inspectCorpus(name);
  const args = process.argv.slice(2);
  if (args.length === 2 && args[0] === "--original") validateOriginals(args[1]);
  else if (args.length !== 0) fail("usage: validate.mjs [--original directory]");
  process.stdout.write(`multi-session proof: PASS (${args.length ? "standalone+original" : "standalone"})\n`);
}

main();
