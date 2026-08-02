#!/usr/bin/env bash
# Static startup contract: no Docker, code-server process, registry, or network.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
START_SCRIPT="$REPO_ROOT/scripts/start-vscode.sh"
DOCKERFILE="$REPO_ROOT/Dockerfile"
THEME_MANIFEST="$REPO_ROOT/config/vscode-extensions/ingenium.system-theme-defaults/package.json"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

require_text() {
  local expected="$1"
  grep -Fq -- "$expected" "$START_SCRIPT" || fail "missing '$expected'"
}

require_file_text() {
  local path="$1"
  local expected="$2"
  grep -Fq -- "$expected" "$path" || fail "missing '$expected' in $path"
}

reject_pattern() {
  local pattern="$1"
  if grep -Eq -- "$pattern" "$START_SCRIPT"; then
    fail "forbidden '$pattern' found in start-vscode.sh"
  fi
}

sh -n "$START_SCRIPT"
require_text 'exec env -i'
require_text '/bin/sh "$0" --clean-env'
require_text '"$(id -un)" != "appuser"'
require_text 'VSCODE_EXTENSION_FILE="/usr/local/share/ingenium/vscode-extensions/sst-dev.opencode-0.0.13.vsix"'
require_text 'VSCODE_EXTENSION_ID="sst-dev.opencode@0.0.13"'
require_text 'VSCODE_EXTENSION_SHA256="e9a75751aa21fce3f9c9822d1f718043b1a9ba97e64c66b190a3fa85850c60d4"'
require_text '[ ! -f "$VSCODE_EXTENSION_FILE" ] || [ -L "$VSCODE_EXTENSION_FILE" ]'
require_text 'sha256sum "$VSCODE_EXTENSION_FILE"'
require_text 'code_server --list-extensions --show-versions'
require_text 'code_server --install-extension "$VSCODE_EXTENSION_FILE" --force'
require_text 'normalized_extension="$(printf '\''%s'\'' "$extension" | tr '\''[:upper:]'\'' '\''[:lower:]'\'' | tr -d '\''[:space:]'\'')"'
require_text 'case "$normalized_extension" in'
require_text 'sst-dev.opencode@*)'
require_text 'if [ "$extension" != "$VSCODE_EXTENSION_ID" ]; then'
require_text '[ "$found" -eq 1 ]'
reject_pattern 'open-vsx|https?://|curl|wget'
reject_pattern 'rm[[:space:]].*extensions'
reject_pattern 'INGENIUM_API_TOKEN|INGENIUM_EMAIL_ENCRYPTION_KEY|GOOGLE_OAUTH_CLIENT_SECRET|MS_OAUTH_CLIENT_SECRET'
reject_pattern 'ensure-vscode-settings|VSCODE_SETTINGS|settings\.json'
[[ ! -e "$REPO_ROOT/scripts/ensure-vscode-settings.mjs" ]] || fail "obsolete settings helper remains"
[[ ! -e "$REPO_ROOT/scripts/ensure-vscode-settings.test.mjs" ]] || fail "obsolete settings helper test remains"

extension_parser="$(awk '
  /^has_expected_extension\(\) \{/ { capture=1 }
  capture { print }
  capture && /^}$/ { exit }
' "$START_SCRIPT")"
[[ -n "$extension_parser" ]] || fail "extension-list parser function is missing"
VSCODE_EXTENSION_ID='sst-dev.opencode@0.0.13'
eval "$extension_parser"

expect_parser_accept() {
  local description="$1"
  local extension_list="$2"
  has_expected_extension "$extension_list" || fail "parser rejected $description"
}

expect_parser_reject() {
  local description="$1"
  local extension_list="$2"
  if has_expected_extension "$extension_list"; then
    fail "parser accepted $description"
  fi
}

expect_parser_accept "the exact identity alongside unrelated extensions" "$(printf '%s\n' \
  'ms-python.python@2024.0.0' \
  "$VSCODE_EXTENSION_ID" \
  'redhat.java@1.40.202' \
  'sst-dev.opencode-tools@1.0.0')"
expect_parser_accept "the exact identity with an empty line" "$(printf '%s\n\n' "$VSCODE_EXTENSION_ID")"
expect_parser_reject "zero matching identity lines" "$(printf '%s\n' 'ms-python.python@2024.0.0')"
expect_parser_reject "duplicate exact identity lines" "$(printf '%s\n' "$VSCODE_EXTENSION_ID" "$VSCODE_EXTENSION_ID")"
expect_parser_reject "a conflicting lower version" 'sst-dev.opencode@0.0.12'
expect_parser_reject "a conflicting higher version" 'sst-dev.opencode@0.0.14'
expect_parser_reject "a leading-whitespace spoof" "$(printf ' %s\n' "$VSCODE_EXTENSION_ID")"
expect_parser_reject "a trailing-whitespace spoof" "$(printf '%s \n' "$VSCODE_EXTENSION_ID")"
expect_parser_reject "a suffix spoof" 'sst-dev.opencode@0.0.13-suffix'
expect_parser_reject "an internal-whitespace spoof" 'sst-dev.opencode @0.0.13'
expect_parser_reject "a case spoof" 'SST-DEV.OPENCODE@0.0.13'
expect_parser_reject "an exact identity hidden by a malformed duplicate" "$(printf '%s\n' \
  "$VSCODE_EXTENSION_ID" \
  'sst-dev.opencode@0.0.13 ')"

require_file_text "$DOCKERFILE" 'COPY --chown=root:root --chmod=0444 config/vscode-extensions/ingenium.system-theme-defaults/package.json /usr/local/lib/code-server/lib/vscode/extensions/ingenium.system-theme-defaults/package.json'
require_file_text "$DOCKERFILE" 'builtin_manifest="/usr/local/lib/code-server/lib/vscode/extensions/ingenium.system-theme-defaults/package.json"'
require_file_text "$DOCKERFILE" 'builtin_dir="$(dirname "$builtin_manifest")"'
require_file_text "$DOCKERFILE" 'test -d "/usr/local/lib/code-server/lib/vscode/extensions"'
require_file_text "$DOCKERFILE" 'chmod 0755 "$builtin_dir"'
require_file_text "$DOCKERFILE" 'runuser -u appuser -- test -r /usr/local/lib/code-server/lib/vscode/extensions/ingenium.system-theme-defaults/package.json'
require_file_text "$DOCKERFILE" 'manifest.name!=="system-theme-defaults"'
require_file_text "$DOCKERFILE" 'manifest.publisher!=="ingenium"'
require_file_text "$DOCKERFILE" 'manifest.version!=="1.0.0"'
require_file_text "$DOCKERFILE" 'forbidden=["main","browser","activationEvents","scripts","dependencies","devDependencies","permissions"]'

node -e 'const fs=require("node:fs"); const manifest=JSON.parse(fs.readFileSync(process.argv[1],"utf8")); const defaults={"window.autoDetectColorScheme":true,"workbench.preferredDarkColorTheme":"Dark Modern","workbench.preferredLightColorTheme":"Light Modern"}; const forbidden=["main","browser","activationEvents","scripts","dependencies","devDependencies","permissions"]; if (manifest.name!=="system-theme-defaults" || manifest.publisher!=="ingenium" || manifest.version!=="1.0.0" || manifest.engines?.vscode!=="^1.131.0" || JSON.stringify(manifest.contributes?.configurationDefaults)!==JSON.stringify(defaults) || forbidden.some((key)=>Object.hasOwn(manifest,key))) throw new Error("invalid built-in theme defaults manifest");' "$THEME_MANIFEST"

printf 'PASS: VS Code extension and built-in theme-default contracts\n'
