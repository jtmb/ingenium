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
require_text scripts/validate-image-provenance.mjs '"compose", "--profile", profile, "ps", "-q", service'
require_text scripts/validate-image-provenance.mjs 'compatibility: "ingenium"'
require_text scripts/validate-image-provenance.mjs 'production: "control-plane"'
require_text scripts/validate-image-provenance.mjs 'running container is not owned by the expected Compose project and service'
require_text scripts/validate-image-provenance.mjs 'org.opencontainers.image.revision'
require_text scripts/validate-image-provenance.mjs 'org.opencontainers.image.source'
require_text scripts/validate-image-provenance.mjs 'secret-bearing OCI label key'
reject_text scripts/validate-image-provenance.mjs '"compose", "ps", "-q", "ingenium"'
require_text docs/operations/deployment.md "validator's default and targets the"
require_text docs/operations/deployment.md './scripts/validate-image-provenance.mjs "$IMAGE_REVISION" --profile production'

node --check "$REPO_ROOT/scripts/validate-image-provenance.mjs"
node -e 'const fs=require("node:fs"); const source=fs.readFileSync(process.argv[1],"utf8"); const quote=String.fromCharCode(39); const marker="node -e "+quote; const start=source.indexOf(marker, source.indexOf("BUILTIN_MANIFEST=")); const end=source.indexOf(quote+";", start); if (start < 0 || end < 0) throw new Error("built-in manifest validator was not found"); new Function(source.slice(start + marker.length, end));' "$REPO_ROOT/Dockerfile"
node -e 'const fs=require("node:fs"); const source=fs.readFileSync(process.argv[1],"utf8"); const quote=String.fromCharCode(39); const marker="node -e "+quote; const start=source.indexOf(marker, source.indexOf("EXTENSION_MANIFEST=")); const end=source.indexOf(quote+"; "+String.fromCharCode(92), start); if (start < 0 || end < 0) throw new Error("VSIX manifest validator was not found"); new Function(source.slice(start + marker.length, end));' "$REPO_ROOT/Dockerfile"

if ! OPENCODE_SERVER_PASSWORD=compose-config-validation-password \
  INGENIUM_EMAIL_ENCRYPTION_KEY=aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa \
  INGENIUM_RUNTIME_ROOT_DOMAIN=runtime.example.test \
  DASHBOARD_ALLOWED_ORIGINS=https://dashboard.example.test \
  IMAGE_REVISION="$REVISION" \
  docker compose --profile compatibility --project-directory "$REPO_ROOT" -f "$REPO_ROOT/docker-compose.yml" config | grep -Fq "IMAGE_REVISION: $REVISION"; then
  fail "Compose config does not pass the current Git SHA as IMAGE_REVISION"
fi

node - "$REPO_ROOT" <<'NODE'
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { spawnSync } = require("node:child_process");

const repoRoot = process.argv[2];
const validator = path.join(repoRoot, "scripts/validate-image-provenance.mjs");
const revision = "a".repeat(40);
const imageId = "sha256:test-image";
const containerId = "b".repeat(64);
const fakeDockerDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "ingenium-provenance-docker-"));
const fakeDocker = path.join(fakeDockerDirectory, "docker");
process.on("exit", () => fs.rmSync(fakeDockerDirectory, { recursive: true, force: true }));

fs.writeFileSync(fakeDocker, `#!/usr/bin/env node
const scenario = JSON.parse(process.env.PROVENANCE_SCENARIO);
const args = process.argv.slice(2);
if (args[0] === "compose") {
  const profileIndex = args.indexOf("--profile");
  if (profileIndex < 0 || args[profileIndex + 1] !== scenario.profile || args.at(-1) !== scenario.service) {
    process.exitCode = 91;
  } else {
    process.stdout.write(scenario.containerIds.join("\\n"));
  }
} else if (args[0] === "inspect" && args.includes("{{json .Config.Labels}}")) {
  process.stdout.write(JSON.stringify(scenario.containerLabels));
} else if (args[0] === "inspect" && args.includes("{{.Image}}")) {
  process.stdout.write(scenario.imageId);
} else if (args[0] === "image" && args.includes("{{json .Config.Labels}}")) {
  process.stdout.write(JSON.stringify(scenario.imageLabels));
} else {
  process.exitCode = 92;
}
`, { mode: 0o755 });

function scenario(profile, service, overrides = {}) {
  return {
    profile,
    service,
    containerIds: [containerId],
    containerLabels: {
      "com.docker.compose.project": "ingenium",
      "com.docker.compose.service": service,
    },
    imageId,
    imageLabels: {
      "org.opencontainers.image.revision": revision,
      "org.opencontainers.image.source": "https://github.com/jtmb/ingenium",
    },
    ...overrides,
  };
}

function run(name, expectedStatus, arguments_, value) {
  const result = spawnSync(process.execPath, [validator, revision, ...arguments_], {
    encoding: "utf8",
    env: {
      ...process.env,
      PATH: `${fakeDockerDirectory}:${process.env.PATH}`,
      PROVENANCE_SCENARIO: JSON.stringify(value),
    },
  });
  if (result.status !== expectedStatus) {
    throw new Error(`${name}: expected exit ${expectedStatus}, got ${result.status}; stderr: ${result.stderr}`);
  }
}

run("compatibility defaults to ingenium", 0, [], scenario("compatibility", "ingenium"));
run("production selects control-plane", 0, ["--profile", "production"], scenario("production", "control-plane"));
run("missing service fails closed", 1, [], scenario("compatibility", "ingenium", { containerIds: [] }));
run("ambiguous service fails closed", 1, [], scenario("compatibility", "ingenium", { containerIds: [containerId, "c".repeat(64)] }));
run("mismatched SHA fails closed", 1, [], scenario("compatibility", "ingenium", {
  imageLabels: {
    "org.opencontainers.image.revision": "c".repeat(40),
    "org.opencontainers.image.source": "https://github.com/jtmb/ingenium",
  },
}));
run("unowned container fails closed", 1, [], scenario("compatibility", "ingenium", {
  containerLabels: {
    "com.docker.compose.project": "unrelated-project",
    "com.docker.compose.service": "ingenium",
  },
}));
NODE

printf 'PASS: OCI image provenance static and Compose config contracts\n'
