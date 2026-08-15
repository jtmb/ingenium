#!/usr/bin/env node
import { spawnSync } from "node:child_process";
import { resolveOwnedComposeContainer } from "./owned-compose-container.mjs";

function fail(message) {
  console.error(`ERROR: ${message}`);
  process.exit(1);
}

let containerId;
try {
  ({ containerId } = resolveOwnedComposeContainer("control-plane", import.meta.url));
} catch (error) {
  fail(error instanceof Error ? error.message : "control-plane ownership could not be validated");
}

const execution = spawnSync(
  "docker",
  ["exec", containerId, "node", "/app/services/ingenium-api/dist/scripts/check-database-integrity.js"],
  { encoding: "utf8" },
);
if (execution.error || execution.signal || execution.status === null) {
  fail("database integrity check could not be executed in the owned control plane");
}

let result;
try {
  result = JSON.parse(execution.stdout.trim());
} catch {
  fail("database integrity check did not return valid JSON");
}
const expectedKeys = ["foreignKeyViolationCount", "integrityViolationCount", "ok"];
if (
  !result
  || typeof result !== "object"
  || Array.isArray(result)
  || JSON.stringify(Object.keys(result).sort()) !== JSON.stringify(expectedKeys)
  || typeof result.ok !== "boolean"
  || !Number.isSafeInteger(result.integrityViolationCount)
  || result.integrityViolationCount < 0
  || !Number.isSafeInteger(result.foreignKeyViolationCount)
  || result.foreignKeyViolationCount < 0
  || execution.status !== (result.ok ? 0 : 1)
) {
  fail("database integrity check returned an invalid content-free result");
}
if (!result.ok) {
  fail(`database integrity check failed: integrity=${result.integrityViolationCount}, foreign_keys=${result.foreignKeyViolationCount}`);
}

console.log("PASS: control-plane database integrity and foreign keys are valid");
