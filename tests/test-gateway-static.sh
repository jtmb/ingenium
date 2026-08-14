#!/usr/bin/env bash
# Deterministic deployment and gateway contract checks. They inspect source
# inputs only and never start Docker, nginx, OpenCode, a provider, or a network
# service.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"

sh "$REPO_ROOT/scripts/validate-deployment-config.sh" "$REPO_ROOT"
bash "$REPO_ROOT/tests/test-control-plane-startup-env.sh"
bash "$REPO_ROOT/tests/test-vault-job-secret-root.sh"
bash "$REPO_ROOT/tests/test-vscode-extension.sh"
bash "$REPO_ROOT/tests/test-opencode-global-agent-profiles.sh"
printf 'PASS: deployment, gateway, and agent projection contracts\n'
