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
require_text scripts/validate-image-provenance.mjs 'compatibility: "ingenium"'
require_text scripts/validate-image-provenance.mjs 'production: "control-plane"'
require_text scripts/owned-compose-container.mjs '"com.docker.compose.project"'
require_text scripts/owned-compose-container.mjs '"com.docker.compose.service"'
require_text scripts/owned-compose-container.mjs '"com.docker.compose.project.working_dir"'
require_text scripts/owned-compose-container.mjs '"com.docker.compose.project.config_files"'
require_text scripts/owned-compose-container.mjs 'running container is not owned by the expected repository, Compose project, and service'
require_text scripts/validate-image-provenance.mjs 'org.opencontainers.image.revision'
require_text scripts/validate-image-provenance.mjs 'org.opencontainers.image.source'
require_text scripts/validate-image-provenance.mjs 'secret-bearing OCI label key'
reject_text scripts/validate-image-provenance.mjs '"compose"'
reject_text scripts/owned-compose-container.mjs '"compose"'
require_text scripts/validate-database-integrity.mjs 'resolveOwnedComposeContainer("control-plane", import.meta.url)'
require_text scripts/validate-database-integrity.mjs '/app/services/ingenium-api/dist/scripts/check-database-integrity.js'
require_text docs/operations/deployment.md "Compatibility is the validator's default and targets only"
require_text docs/operations/deployment.md './scripts/validate-image-provenance.mjs "$IMAGE_REVISION" --profile production'

node --check "$REPO_ROOT/scripts/validate-image-provenance.mjs"
node --check "$REPO_ROOT/scripts/owned-compose-container.mjs"
node --check "$REPO_ROOT/scripts/validate-database-integrity.mjs"
node -e 'const fs=require("node:fs"); const source=fs.readFileSync(process.argv[1],"utf8"); const quote=String.fromCharCode(39); const marker="node -e "+quote; const start=source.indexOf(marker, source.indexOf("BUILTIN_MANIFEST=")); const end=source.indexOf(quote+";", start); if (start < 0 || end < 0) throw new Error("built-in manifest validator was not found"); new Function(source.slice(start + marker.length, end));' "$REPO_ROOT/Dockerfile"
node -e 'const fs=require("node:fs"); const source=fs.readFileSync(process.argv[1],"utf8"); const quote=String.fromCharCode(39); const marker="node -e "+quote; const start=source.indexOf(marker, source.indexOf("EXTENSION_MANIFEST=")); const end=source.indexOf(quote+"; "+String.fromCharCode(92), start); if (start < 0 || end < 0) throw new Error("VSIX manifest validator was not found"); new Function(source.slice(start + marker.length, end));' "$REPO_ROOT/Dockerfile"

if ! OPENCODE_SERVER_PASSWORD_FILE=/tmp/opencode-server.password \
  INGENIUM_EMAIL_ENCRYPTION_KEY_FILE=/tmp/email-encryption.key \
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
const databaseValidator = path.join(repoRoot, "scripts/validate-database-integrity.mjs");
const revision = "a".repeat(40);
const imageId = "sha256:test-image";
const containerId = "b".repeat(64);
const fakeDockerDirectory = fs.mkdtempSync(path.join(os.tmpdir(), "ingenium-provenance-docker-"));
const fakeDocker = path.join(fakeDockerDirectory, "docker");
process.on("exit", () => fs.rmSync(fakeDockerDirectory, { recursive: true, force: true }));

fs.writeFileSync(fakeDocker, `#!/usr/bin/env node
const scenario = JSON.parse(process.env.PROVENANCE_SCENARIO);
const args = process.argv.slice(2);
if (args[0] === "ps") {
  if (!args.includes("--filter") || !args.includes("label=com.docker.compose.service=" + scenario.service)) {
    process.exitCode = 91;
  } else {
    process.stdout.write(scenario.containerIds.join("\\n"));
  }
} else if (args[0] === "inspect") {
  process.stdout.write(JSON.stringify([scenario.container]));
} else if (args[0] === "image" && args.includes("{{json .Config.Labels}}")) {
  process.stdout.write(JSON.stringify(scenario.imageLabels));
} else if (args[0] === "exec") {
  if (args[1] !== scenario.container.Id || args[2] !== "node" || args[3] !== "/app/services/ingenium-api/dist/scripts/check-database-integrity.js") {
    process.exitCode = 93;
  } else {
    process.stdout.write(JSON.stringify(scenario.databaseResult));
    process.exitCode = scenario.databaseResult.ok ? 0 : 1;
  }
} else {
  process.exitCode = 92;
}
`, { mode: 0o755 });

function scenario(service, overrides = {}) {
  return {
    service,
    containerIds: [containerId],
    container: {
      Id: containerId,
      Image: imageId,
      State: { Running: true },
      Config: {
        Labels: {
          "com.docker.compose.project": "ingenium",
          "com.docker.compose.service": service,
          "com.docker.compose.project.working_dir": repoRoot,
          "com.docker.compose.project.config_files": path.join(repoRoot, "docker-compose.yml"),
        },
      },
    },
    imageLabels: {
      "org.opencontainers.image.revision": revision,
      "org.opencontainers.image.source": "https://github.com/jtmb/ingenium",
    },
    databaseResult: {
      ok: true,
      integrityViolationCount: 0,
      foreignKeyViolationCount: 0,
    },
    ...overrides,
  };
}

function run(name, executable, expectedStatus, arguments_, value) {
  const environment = {
    ...process.env,
    PATH: `${fakeDockerDirectory}:${process.env.PATH}`,
    PROVENANCE_SCENARIO: JSON.stringify(value),
  };
  delete environment.OPENCODE_SERVER_PASSWORD_FILE;
  delete environment.INGENIUM_RUNTIME_ROOT_DOMAIN;
  const result = spawnSync(process.execPath, [executable, ...arguments_], {
    encoding: "utf8",
    env: environment,
  });
  if (result.status !== expectedStatus) {
    throw new Error(`${name}: expected exit ${expectedStatus}, got ${result.status}; stderr: ${result.stderr}`);
  }
}

run("compatibility defaults to ingenium", validator, 0, [revision], scenario("ingenium"));
run("production selects control-plane", validator, 0, [revision, "--profile", "production"], scenario("control-plane"));
run("missing service fails closed", validator, 1, [revision], scenario("ingenium", { containerIds: [] }));
run("ambiguous service fails closed", validator, 1, [revision], scenario("ingenium", { containerIds: [containerId, "c".repeat(64)] }));
run("mismatched SHA fails closed", validator, 1, [revision], scenario("ingenium", {
  imageLabels: {
    "org.opencontainers.image.revision": "c".repeat(40),
    "org.opencontainers.image.source": "https://github.com/jtmb/ingenium",
  },
}));
const foreign = scenario("ingenium");
foreign.container.Config.Labels["com.docker.compose.project"] = "unrelated-project";
run("foreign project fails closed", validator, 1, [revision], foreign);
const mismatchedRepository = scenario("ingenium");
mismatchedRepository.container.Config.Labels["com.docker.compose.project.working_dir"] = "/foreign/repository";
run("mismatched repository fails closed", validator, 1, [revision], mismatchedRepository);
run("owned control plane runs content-free database check", databaseValidator, 0, [], scenario("control-plane"));
run("database violations fail closed", databaseValidator, 1, [], scenario("control-plane", {
  databaseResult: {
    ok: false,
    integrityViolationCount: 1,
    foreignKeyViolationCount: 2,
  },
}));
NODE

printf 'PASS: OCI image provenance static and Compose config contracts\n'
