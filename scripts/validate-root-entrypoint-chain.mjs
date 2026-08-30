#!/usr/bin/env node
import { lstatSync, readdirSync, readlinkSync } from "node:fs";
import { join } from "node:path";

const exactModes = new Map([
  ["/app", 0o755],
  ["/app/packages", 0o755],
  ["/app/services", 0o755],
  ["/app/services/ingenium-api", 0o755],
  ["/app/scripts", 0o555],
  ["/app/entrypoint.sh", 0o555],
  ["/app/control-plane-supervisord.conf", 0o444],
  ["/app/supervisord.conf", 0o444],
  ["/app/scripts/normalize-agent-profiles.sh", 0o555],
  ["/app/scripts/opencode-auth-proxy.mjs", 0o444],
  ["/app/scripts/project-agent-profiles.mjs", 0o444],
  ["/app/scripts/provision-dashboard-bootstrap-token.mjs", 0o444],
  ["/app/scripts/runtime-control-entrypoint.sh", 0o555],
  ["/app/scripts/runtime-gateway-healthcheck.mjs", 0o444],
  ["/app/scripts/provision-auth-encryption-key.sh", 0o555],
  ["/app/scripts/read-protected-api-token.mjs", 0o444],
  ["/app/scripts/recover-restore-maintenance.sh", 0o555],
  ["/app/scripts/run-restore-maintenance.sh", 0o555],
  ["/app/scripts/run-restore-handoff.sh", 0o555],
  ["/app/scripts/restore-handoff.mjs", 0o444],
  ["/usr/local/share/ingenium/api-uid", 0o444],
  ["/usr/local/share/ingenium/dashboard-uid", 0o444],
  ["/usr/local/share/ingenium/opencode-uid", 0o444],
  ["/usr/local/share/ingenium/restore-uid", 0o444],
  ["/usr/local/share/ingenium/runtime-manager-uid", 0o444],
  ["/usr/local/share/ingenium/runtime-manager-gid", 0o444],
  ["/usr/local/share/ingenium/runtime-gateway-uid", 0o444],
  ["/usr/local/share/ingenium/runtime-gateway-gid", 0o444],
  ["/usr/local/share/ingenium/opencode-managed", 0o555],
  ["/usr/local/share/ingenium/opencode-managed/opencode.json", 0o444],
  ["/usr/local/share/ingenium/opencode-managed/agents", 0o555],
  ["/usr/local/share/ingenium/opencode-managed/agents/ingenium-llm-broker.md", 0o444],
  ["/usr/local/share/ingenium/opencode-managed/plugins", 0o555],
  ["/usr/local/share/ingenium/opencode-managed/plugins/enforce-reserved-broker.mjs", 0o444],
  ["/etc/opencode", 0o555],
  ["/etc/opencode/opencode.json", 0o777],
  ["/app/scripts/validate-root-entrypoint-chain.mjs", 0o444],
  ["/app/scripts/validate-process-isolation.sh", 0o555],
  ["/app/scripts/validate-vault-job-secret-root.sh", 0o555],
]);
const immutableTrees = [
  "/app/node_modules",
  "/app/packages",
  "/app/scripts",
  "/app/services",
  "/app/docs",
  "/app/.opencode",
  "/app/nginx",
  "/usr/local/share/ingenium/opencode-managed",
  "/etc/opencode",
];
const visited = new Set();

function fail() {
  process.stderr.write("ERROR: root entrypoint artifact chain is unsafe\n");
  process.exit(1);
}

function validateMetadata(path, metadata) {
  if (metadata.uid !== 0 || metadata.gid !== 0) fail();
  if (!metadata.isSymbolicLink() && (metadata.mode & 0o022) !== 0) fail();
  const exactMode = exactModes.get(path);
  if (exactMode !== undefined && (metadata.mode & 0o777) !== exactMode) fail();
}

function validateTree(path) {
  const metadata = lstatSync(path);
  validateMetadata(path, metadata);
  if (metadata.isSymbolicLink()) return;
  if (!metadata.isDirectory()) return;
  const identity = `${metadata.dev}:${metadata.ino}`;
  if (visited.has(identity)) return;
  visited.add(identity);
  for (const child of readdirSync(path)) validateTree(join(path, child));
}

try {
  for (const path of exactModes.keys()) validateMetadata(path, lstatSync(path));
  if (readlinkSync("/etc/opencode/opencode.json") !== "/usr/local/share/ingenium/opencode-managed/opencode.json") fail();
  for (const path of immutableTrees) validateTree(path);
} catch {
  fail();
}
