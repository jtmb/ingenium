#!/usr/bin/env node
import { spawnSync } from "node:child_process";

const revisionPattern = /^[0-9a-f]{40}$/;
const secretBearingLabelPattern = /(api[-_]?key|credential|password|secret|token)/i;

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

function docker(args, environment) {
  const result = spawnSync("docker", args, {
    encoding: "utf8",
    env: environment,
  });

  if (result.error || result.status !== 0) {
    fail("Docker could not inspect the running Compose image provenance");
  }

  return result.stdout.trim();
}

const expectedRevision = process.argv[2];
if (typeof expectedRevision !== "string" || !revisionPattern.test(expectedRevision)) {
  fail("expected revision must be a lowercase 40-character Git SHA");
}

// Compose resolves build arguments for every subcommand. Supply only the
// expected public revision so this verifier never needs deployment secrets.
const composeEnvironment = {
  ...process.env,
  IMAGE_REVISION: expectedRevision,
};
const containerId = docker(["compose", "ps", "-q", "ingenium"], composeEnvironment);
if (!containerId) {
  fail("Ingenium Compose service is not running");
}

const imageId = docker(["inspect", "--format", "{{.Image}}", containerId], composeEnvironment);
const serializedLabels = docker(
  ["image", "inspect", "--format", "{{json .Config.Labels}}", imageId],
  composeEnvironment,
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

// Do not print raw labels: deployment metadata checks must not become a path
// for accidentally exposing label values in logs.
console.log(`PASS: running image exposes OCI revision ${expectedRevision}`);
