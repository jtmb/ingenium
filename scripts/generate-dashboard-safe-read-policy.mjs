#!/usr/bin/env node
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const defaultPolicyPath = resolve(root, "services/ingenium-api/config/dashboard-safe-reads.json");
const defaultOutputPath = resolve(root, "nginx/dashboard-safe-reads-map.conf");
function loadPolicy(policyPath) {
  const policy = JSON.parse(readFileSync(policyPath, "utf8"));
  if (policy.schemaVersion !== 1 || !policy.evidence || !Array.isArray(policy.safeRoutes)
    || !Array.isArray(policy.observedStrictRoutes)) throw new Error("Dashboard safe-read policy is malformed");
  const routes = [...policy.safeRoutes, ...policy.observedStrictRoutes];
  for (const route of routes) {
    if (typeof route.template !== "string" || !route.template.startsWith("/api/v1/")
      || route.template.endsWith("/") || route.template.includes("?") || route.template.includes("%")
      || !Number.isSafeInteger(route.observedCount) || route.observedCount < 0) {
      throw new Error(`Invalid Dashboard read policy route: ${route.template}`);
    }
  }
  for (const route of policy.safeRoutes) {
    if (typeof route.pattern !== "string" || !route.pattern.startsWith("/api/v1/")
      || route.pattern.includes("?") || route.pattern.includes("%")) {
      throw new Error(`Invalid Dashboard safe-read pattern: ${route.template}`);
    }
    new RegExp(`^${route.pattern}$`);
  }
  if (new Set(routes.map((route) => route.template)).size !== routes.length) {
    throw new Error("Dashboard read policy contains duplicate route templates");
  }
  const safe = policy.safeRoutes.reduce((total, route) => total + route.observedCount, 0);
  const strict = policy.observedStrictRoutes.reduce((total, route) => total + route.observedCount, 0);
  if (safe !== policy.evidence.safeGetRequests || strict !== policy.evidence.strictGetRequests
    || safe + strict !== policy.evidence.observedGetRequests
    || !Number.isSafeInteger(policy.evidence.observedStrictNonGetRequests) || policy.evidence.observedStrictNonGetRequests < 0
    || !Number.isSafeInteger(policy.evidence.maxSinglePageFanout) || policy.evidence.maxSinglePageFanout < 1
    || !Number.isSafeInteger(policy.evidence.maxSinglePageApiRequests) || policy.evidence.maxSinglePageApiRequests < policy.evidence.maxSinglePageFanout
    || !Number.isSafeInteger(policy.evidence.humanPacedTransitionIntervalMs) || policy.evidence.humanPacedTransitionIntervalMs < 1) {
    throw new Error("Dashboard read policy evidence totals do not reconcile");
  }
  return policy;
}

export function renderDashboardSafeReadMap(policy) {
  const hash = createHash("sha256").update(JSON.stringify(policy)).digest("hex");
  const rules = policy.safeRoutes.map((route) =>
    `    "~^GET\\|(${route.pattern}/?)\\|\\1$" safe;`,
  );
  return [
    `# Generated from services/ingenium-api/config/dashboard-safe-reads.json (sha256: ${hash}).`,
    "# Run node scripts/generate-dashboard-safe-read-policy.mjs after policy changes.",
    "map $request_uri $dashboard_api_raw_path {",
    "    default \"\";",
    "    \"~^([^?]*)\" $1;",
    "}",
    "",
    "map \"$request_method|$uri|$dashboard_api_raw_path\" $dashboard_api_limit_class {",
    "    default strict;",
    ...rules,
    "}",
    "",
  ].join("\n");
}

function main() {
  const check = process.argv[2] === "--check";
  const offset = check ? 3 : 2;
  const policyPath = resolve(process.argv[offset] ?? defaultPolicyPath);
  const outputPath = resolve(process.argv[offset + 1] ?? defaultOutputPath);
  const expected = renderDashboardSafeReadMap(loadPolicy(policyPath));
  if (check) {
    if (readFileSync(outputPath, "utf8") !== expected) {
      throw new Error(`Generated Dashboard safe-read map is stale: ${outputPath}`);
    }
    return;
  }
  writeFileSync(outputPath, expected, "utf8");
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main();
