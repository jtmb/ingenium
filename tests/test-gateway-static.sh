#!/usr/bin/env bash
# Deterministic deployment and gateway contract checks. They inspect source
# inputs only and never start Docker, nginx, OpenCode, a provider, or a network
# service.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

node --input-type=module - "$REPO_ROOT" <<'NODE'
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';

// Stub provisioned file I/O and external processes, leaving identity isolation unchanged.
const launcher = readFileSync(`${process.argv[2]}/scripts/start-opencode-web.sh`, 'utf8')
  .replace('[ ! -s /run/ingenium-runtime/environment ]', '[ 1 = 0 ]')
  .replaceAll('[ -s /run/ingenium-runtime/environment ]', '[ "${TEST_RUNTIME_ENVIRONMENT:-}" = present ]')
  .replaceAll('[ -s /run/ingenium-runtime/capability ]', '[ "${TEST_RUNTIME_CAPABILITY:-}" = present ]')
  .replace('. /run/ingenium-runtime/environment', 'eval "$TEST_RUNTIME_CONTENT"')
  .replace('[ ! -s /run/ingenium-opencode/.ingenium-mcp-credential ]', '[ 1 = 0 ]')
  .replace('cat /run/ingenium-secrets/opencode/opencode-server-password', 'printf test-opencode-secret')
  .replace('node /app/scripts/probe-api.mjs', 'true')
  .replace('opencode serve --port 4098 --hostname 127.0.0.1', '/usr/bin/env');
const launch = (env) => spawnSync('/bin/sh', ['-c', launcher], { env, encoding: 'utf8' });
const defaults = launch({});
assert.equal(defaults.status, 0, defaults.stderr);
assert.ok(defaults.stdout.split('\n').includes('INGENIUM_WORKSPACE_ID=shared-memory-ingenium'));
assert.ok(defaults.stdout.split('\n').includes('INGENIUM_PROJECT=ingenium'));
for (const binding of [
  'INGENIUM_WORKTREE=/home/brajam/repos/ingenium',
  'INGENIUM_MCP_AUDIENCE=mcp',
  'INGENIUM_MCP_CREDENTIAL_PURPOSE=general',
  'INGENIUM_MCP_CREDENTIAL_FILE=/run/ingenium-opencode/.ingenium-mcp-credential',
]) assert.ok(defaults.stdout.split('\n').includes(binding), binding);
const overridden = launch({ INGENIUM_PROJECT: 'wrong', INGENIUM_WORKSPACE_ID: 'wrong', INGENIUM_WORKTREE: '/workspace' });
assert.equal(overridden.status, 0, overridden.stderr);
for (const binding of ['INGENIUM_PROJECT=ingenium', 'INGENIUM_WORKSPACE_ID=shared-memory-ingenium', 'INGENIUM_WORKTREE=/home/brajam/repos/ingenium']) {
  assert.ok(overridden.stdout.split('\n').includes(binding), binding);
}
const identity = Object.fromEntries([
  'PROJECT', 'PROJECT_ID', 'ORGANIZATION_ID', 'RUNTIME_ID', 'RUNTIME_OWNER_ID',
  'WORKSPACE_ID', 'STORAGE_MAPPING_HASH',
].map((name) => [`INGENIUM_${name}`, `explicit-${name.toLowerCase()}`]));
for (const files of [{}, { TEST_RUNTIME_ENVIRONMENT: 'present' }, { TEST_RUNTIME_CAPABILITY: 'present' }]) {
  const inherited = launch({ ...identity, ...files });
  assert.equal(inherited.status, 0, inherited.stderr);
  assert.ok(inherited.stdout.split('\n').includes('INGENIUM_MCP_CREDENTIAL_PURPOSE=general'));
  assert.ok(!inherited.stdout.split('\n').some((line) => line.startsWith('INGENIUM_RUNTIME_ID=')));
}
const provisioned = {
  TEST_RUNTIME_ENVIRONMENT: 'present',
  TEST_RUNTIME_CAPABILITY: 'present',
  TEST_RUNTIME_CONTENT: Object.entries({ ...identity, INGENIUM_WORKTREE: '/workspace' })
    .map(([name, value]) => `${name}=${value}`).join('\n'),
};
const explicit = launch(provisioned);
assert.equal(explicit.status, 0, explicit.stderr);
assert.ok(explicit.stdout.split('\n').includes('INGENIUM_MCP_CREDENTIAL_PURPOSE=runtime'));
for (const [name, value] of Object.entries(identity)) {
  assert.ok(explicit.stdout.split('\n').includes(`${name}=${value}`), `${name} must survive env -i`);
}
assert.ok(explicit.stdout.split('\n').includes('INGENIUM_WORKTREE=/workspace'));
assert.equal(launch({ ...provisioned, TEST_RUNTIME_CONTENT: 'INGENIUM_RUNTIME_ID=incomplete' }).status, 1);
console.log('PASS: launcher defaults, inherited identity isolation, both-file runtime identity, and incomplete provisioned identity rejection');
NODE

sh "$REPO_ROOT/scripts/validate-deployment-config.sh" "$REPO_ROOT"
bash "$REPO_ROOT/tests/test-control-plane-startup-env.sh"
bash "$REPO_ROOT/tests/test-vault-job-secret-root.sh"
bash "$REPO_ROOT/tests/test-vscode-extension.sh"
bash "$REPO_ROOT/tests/test-opencode-global-agent-profiles.sh"
printf 'PASS: deployment, gateway, and agent projection contracts\n'
