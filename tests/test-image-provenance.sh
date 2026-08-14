#!/usr/bin/env bash
# Static and Compose-rendering checks for OCI image provenance.
set -euo pipefail

REPO_ROOT="$(git rev-parse --show-toplevel)"
REVISION="$(git -C "$REPO_ROOT" rev-parse HEAD)"

fail() {
  printf 'FAIL: %s\n' "$1" >&2
  exit 1
}

require_text() {
  local path="$1"
  local expected="$2"
  grep -Fq -- "$expected" "$REPO_ROOT/$path" || fail "missing '$expected' in $path"
}

reject_text() {
  local path="$1"
  local forbidden="$2"
  if grep -Fq -- "$forbidden" "$REPO_ROOT/$path"; then
    fail "unsafe '$forbidden' found in $path"
  fi
}

[[ "$REVISION" =~ ^[0-9a-f]{40}$ ]] || fail "Git HEAD is not a lowercase 40-character SHA"

require_text Dockerfile 'ARG IMAGE_REVISION'
require_text Dockerfile 'ARG IMAGE_SOURCE="https://github.com/jtmb/ingenium"'
require_text Dockerfile "grep -Eq '^[0-9a-f]{40}\$'"
require_text Dockerfile 'case "$IMAGE_SOURCE" in https://*/*) ;; *) exit 1 ;; esac'
require_text Dockerfile 'case "$IMAGE_SOURCE" in *"@"*|*"?"*|*"#"*) exit 1 ;; esac'
require_text Dockerfile 'org.opencontainers.image.revision="${IMAGE_REVISION}"'
require_text Dockerfile 'org.opencontainers.image.source="${IMAGE_SOURCE}"'
reject_text Dockerfile 'ENV IMAGE_REVISION'
reject_text Dockerfile 'ENV IMAGE_SOURCE'
require_text Dockerfile 'https://open-vsx.org/api/sst-dev/opencode/0.0.13/file/sst-dev.opencode-0.0.13.vsix'
require_text Dockerfile 'e9a75751aa21fce3f9c9822d1f718043b1a9ba97e64c66b190a3fa85850c60d4'
require_text Dockerfile '/usr/local/share/ingenium/vscode-extensions/sst-dev.opencode-0.0.13.vsix'
require_text Dockerfile 'install -o root -g root -m 0444'
require_text Dockerfile 'test "$extension_list" = "sst-dev.opencode@0.0.13"'
require_text Dockerfile 'manifest.publisher!=="sst-dev"'
require_text Dockerfile 'manifest.name!=="opencode"'
require_text Dockerfile 'manifest.version!=="0.0.13"'
require_text Dockerfile 'manifest.engines?.vscode'
require_text Dockerfile 'rm -rf "$extension_temp_dir"'
reject_text Dockerfile 'sst-dev/opencode/latest'
require_text Dockerfile 'COPY --chown=root:root --chmod=0444 config/vscode-extensions/ingenium.system-theme-defaults/package.json /usr/local/lib/code-server/lib/vscode/extensions/ingenium.system-theme-defaults/package.json'
require_text Dockerfile 'builtin_manifest="/usr/local/lib/code-server/lib/vscode/extensions/ingenium.system-theme-defaults/package.json"'
require_text Dockerfile 'builtin_dir="$(dirname "$builtin_manifest")"'
require_text Dockerfile 'test -d "/usr/local/lib/code-server/lib/vscode/extensions"'
require_text Dockerfile 'chmod 0755 "$builtin_dir"'
require_text Dockerfile 'runuser -u appuser -- test -r /usr/local/lib/code-server/lib/vscode/extensions/ingenium.system-theme-defaults/package.json'
require_text Dockerfile 'manifest.name!=="system-theme-defaults"'
require_text Dockerfile 'manifest.publisher!=="ingenium"'
require_text Dockerfile 'manifest.version!=="1.0.0"'
require_text Dockerfile 'configurationDefaults'
[[ ! -e "$REPO_ROOT/scripts/ensure-vscode-settings.mjs" ]] || fail 'obsolete settings helper remains'
[[ ! -e "$REPO_ROOT/scripts/ensure-vscode-settings.test.mjs" ]] || fail 'obsolete settings helper test remains'
require_text config/vscode-extensions/ingenium.system-theme-defaults/package.json '"name": "system-theme-defaults"'
require_text config/vscode-extensions/ingenium.system-theme-defaults/package.json '"publisher": "ingenium"'
require_text config/vscode-extensions/ingenium.system-theme-defaults/package.json '"version": "1.0.0"'
require_text config/vscode-extensions/ingenium.system-theme-defaults/package.json '"vscode": "^1.131.0"'
require_text config/vscode-extensions/ingenium.system-theme-defaults/package.json '"window.autoDetectColorScheme": true'
require_text config/vscode-extensions/ingenium.system-theme-defaults/package.json '"workbench.preferredDarkColorTheme": "Dark Modern"'
require_text config/vscode-extensions/ingenium.system-theme-defaults/package.json '"workbench.preferredLightColorTheme": "Light Modern"'

require_text docker-compose.yml 'IMAGE_REVISION: "${IMAGE_REVISION:?IMAGE_REVISION must be set to the current Git commit SHA}"'
require_text docker-compose.yml 'IMAGE_SOURCE: "${IMAGE_SOURCE:-https://github.com/jtmb/ingenium}"'
require_text scripts/validate-image-provenance.mjs '"compose", "ps", "-q", "ingenium"'
require_text scripts/validate-image-provenance.mjs 'org.opencontainers.image.revision'
require_text scripts/validate-image-provenance.mjs 'org.opencontainers.image.source'
require_text scripts/validate-image-provenance.mjs 'secret-bearing OCI label key'

node --check "$REPO_ROOT/scripts/validate-image-provenance.mjs"
node -e 'const fs=require("node:fs"); const source=fs.readFileSync(process.argv[1],"utf8"); const quote=String.fromCharCode(39); const marker="node -e "+quote; const start=source.indexOf(marker, source.indexOf("BUILTIN_MANIFEST=")); const end=source.indexOf(quote+";", start); if (start < 0 || end < 0) throw new Error("built-in manifest validator was not found"); new Function(source.slice(start + marker.length, end));' "$REPO_ROOT/Dockerfile"
node -e 'const fs=require("node:fs"); const source=fs.readFileSync(process.argv[1],"utf8"); const quote=String.fromCharCode(39); const marker="node -e "+quote; const start=source.indexOf(marker, source.indexOf("EXTENSION_MANIFEST=")); const end=source.indexOf(quote+"; "+String.fromCharCode(92), start); if (start < 0 || end < 0) throw new Error("VSIX manifest validator was not found"); new Function(source.slice(start + marker.length, end));' "$REPO_ROOT/Dockerfile"

if ! OPENCODE_SERVER_PASSWORD=compose-config-validation-password \
  INGENIUM_EMAIL_ENCRYPTION_KEY=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  IMAGE_REVISION="$REVISION" \
  docker compose --profile compatibility --project-directory "$REPO_ROOT" -f "$REPO_ROOT/docker-compose.yml" config | grep -Fq "IMAGE_REVISION: $REVISION"; then
  fail "Compose config does not pass the current Git SHA as IMAGE_REVISION"
fi

printf 'PASS: OCI image provenance static and Compose config contracts\n'
