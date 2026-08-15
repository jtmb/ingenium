#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolveOwnedComposeContainer } from "./owned-compose-container.mjs";

// OCI provenance is compared to the canonical full lowercase Git SHA.
const revisionPattern = /^[0-9a-f]{40}$/;
// Reject label names that could carry credential material into image metadata.
const secretBearingLabelPattern = /(api[-_]?key|credential|password|secret|token)/i;

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function docker(args) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
  });

  if (result.error || result.status !== 0) {
    fail("Docker could not inspect the running Compose image provenance");
  }

  return result.stdout.trim();
}

const serviceByProfile = {
  compatibility: "ingenium",
  production: "control-plane",
};

let expectedRevision;
let profile = "compatibility";
const arguments_ = process.argv.slice(2);
for (let index = 0; index < arguments_.length; index += 1) {
  const argument = arguments_[index];
  if (argument === "--profile") {
    profile = arguments_[index + 1];
    index += 1;
  } else if (argument?.startsWith("--profile=")) {
    profile = argument.slice("--profile=".length);
  } else if (expectedRevision === undefined) {
    expectedRevision = argument;
  } else {
    fail("usage: validate-image-provenance.mjs EXPECTED_REVISION [--profile compatibility|production]");
  }
}

if (typeof expectedRevision !== "string" || !revisionPattern.test(expectedRevision)) {
  fail("expected revision must be a lowercase 40-character Git SHA");
}
if (!Object.hasOwn(serviceByProfile, profile)) {
  fail(`unsupported Compose profile: ${String(profile)}`);
}
const service = serviceByProfile[profile];
try {
  const { imageId } = resolveOwnedComposeContainer(service, import.meta.url);
  const serializedLabels = docker(
    ["image", "inspect", "--format", "{{json .Config.Labels}}", imageId],
  );

  let labels;
  try {
    labels = JSON.parse(serializedLabels);
  } catch {
    fail("running image OCI labels are not valid JSON");
  }

  if (!labels || typeof labels !== "object" || Array.isArray(labels)) {
    fail("running image does not expose OCI labels");
  }

  if (labels["org.opencontainers.image.revision"] !== expectedRevision) {
    fail("running image revision label does not match the expected Git SHA");
  }

  const source = labels["org.opencontainers.image.source"];
  if (typeof source !== "string") {
    fail("running image does not expose an OCI source label");
  }

  try {
    const sourceUrl = new URL(source);
    if (
      sourceUrl.protocol !== "https:"
      || !sourceUrl.hostname
      || sourceUrl.username
      || sourceUrl.password
      || sourceUrl.search
      || sourceUrl.hash
    ) {
      fail("running image source label is not a credential-free HTTPS repository URL");
    }
  } catch {
    fail("running image source label is not a credential-free HTTPS repository URL");
  }

  if (Object.keys(labels).some((key) => secretBearingLabelPattern.test(key))) {
    fail("running image includes a secret-bearing OCI label key");
  }
} catch (error) {
  fail(error instanceof Error ? error.message : "running image provenance could not be validated");
}

// Do not print raw labels: deployment metadata checks must not become a path
// for accidentally exposing label values in logs.
console.log(`PASS: running image exposes OCI revision ${expectedRevision}`);
