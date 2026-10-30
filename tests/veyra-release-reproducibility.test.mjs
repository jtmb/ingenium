import assert from 'node:assert/strict';
import test from 'node:test';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { sha256, validateBuildLock, renderAptSources, renderAptConfig, verifyIndexBytes, verifyNpmArchive, sourceProvenance } from '../tools/veyra-release/reproducible-linux.mjs';
import { prepareDockerfile, unifiedPatch, recipeRunScripts } from '../tools/veyra-release/linux-recipe-patch.mjs';

const lock = JSON.parse(readFileSync(new URL('../tools/veyra-release/linux-build.lock.json', import.meta.url), 'utf8'));
const clone = () => structuredClone(lock);
const base = `# Compile workspace artifacts\nFROM node:22-slim AS builder\nWORKDIR /app\n\n# Native modules such as better-sqlite3\nRUN apt-get update && apt-get install -y --no-install-recommends \\\n    python3 make g++ ca-certificates && \\\n    rm -rf /var/lib/apt/lists/*\nCOPY . .\nRUN npm run build --workspaces --if-present\nFROM node:22-slim AS runtime-base\nRUN apt-get update && apt-get install -y --no-install-recommends \\\n    supervisor nginx curl ca-certificates tzdata git acl libcap2-bin libssl3 openssl && \\\n    rm -rf /var/lib/apt/lists/*\nRUN NPM_CONFIG_CACHE=/tmp/ingenium-runtime-npm-cache \\\n    APPDATA=/tmp/ingenium-runtime-build-appdata LOCALAPPDATA=/tmp/ingenium-runtime-build-localappdata \\\n    npm install --global --ignore-scripts npm@12.2.1 && \\\n    rm -rf /tmp/ingenium-runtime-npm-cache /tmp/ingenium-runtime-npm-logs /tmp/ingenium-runtime-build-appdata /tmp/ingenium-runtime-build-localappdata\nWORKDIR /app\nRUN playwright_cli="reviewed-cli" && \\\n    PLAYWRIGHT_BROWSERS_PATH=/opt/ingenium-playwright/browsers node "$playwright_cli" install --with-deps chromium && \\\n    test -x "$browser_path"\n# Fail the image build if the copied native binding cannot load on the runtime\nRUN node -e 'require("better-sqlite3")'\nARG IMAGE_SOURCE_SHA256=""\nRUN test -z "$IMAGE_SOURCE_SHA256" || { test "\u0024{#IMAGE_SOURCE_SHA256}" -eq 64 && printf '%s' "$IMAGE_SOURCE_SHA256" | grep -Eq '^[0-9a-f]{64}$'; }\nFROM runtime-base AS compatibility\nENTRYPOINT ["/app/entrypoint.sh"]\n`;
const recipeLock = () => ({ ...clone(), sourceRecipe: { dockerfileSha256: sha256(Buffer.from(base)) } });

function syntheticIndexes() {
  const input = clone(), files = {};
  for (const row of input.apt.repositories) {
    const bytes = Buffer.from('Signed fixture index: ' + row.suite);
    row.inReleaseSha256 = sha256(bytes); row.inReleaseBytes = bytes.length;
    files[`snapshot.debian.org_archive_${row.archive}_${input.apt.timestamp}_dists_${row.suite}_InRelease`] = bytes;
  }
  return { input, files };
}

test('manifest binds an immutable amd64 bookworm base and all snapshot suites', () => {
  assert.equal(validateBuildLock(lock).base.node, '22.23.4');
  for (const mutate of [row => { row.base.reference = 'node:22-slim'; }, row => { row.platform = 'linux/arm64'; }, row => { row.apt.repositories.pop(); }, row => { row.apt.repositories[0].archive = 'untrusted'; }]) {
    const input = clone(); mutate(input); assert.throws(() => validateBuildLock(input));
  }
});

test('historical source expiry is isolated while signature checks and three suites remain', () => {
  const sources = renderAptSources(lock), config = renderAptConfig();
  assert.equal(sources.trim().split('\n').length, 3);
  assert.ok(sources.includes('signed-by=/usr/share/keyrings/debian-archive-keyring.gpg'));
  assert.ok(sources.includes('bookworm-security main'));
  assert.ok(!sources.includes('trusted=yes'));
  assert.ok(config.includes('sourceparts "/etc/apt/veyra/empty"'));
  assert.ok(config.includes('AllowUnauthenticated "false"'));
  assert.ok(!config.includes('Check-Valid-Until'));
});

test('apt index proof rejects modified bytes, missing suites and extra live indexes', () => {
  const { input, files } = syntheticIndexes();
  assert.equal(verifyIndexBytes(input, files).length, 3);
  const name = Object.keys(files)[0];
  assert.throws(() => verifyIndexBytes(input, { ...files, [name]: Buffer.from('altered') }), /changed/);
  const missing = { ...files }; delete missing[name]; assert.throws(() => verifyIndexBytes(input, missing), /missing/);
  assert.throws(() => verifyIndexBytes(input, { ...files, 'deb.debian.org_live_InRelease': Buffer.from('live') }), /Unexpected/);
});

test('npm archive must match exact SHA512 bytes instead of only a version string', () => {
  const input = clone(), bytes = Buffer.from('explicit archive fixture');
  input.npm.integrity = 'sha512-' + createHash('sha512').update(bytes).digest('base64');
  assert.equal(verifyNpmArchive(input, bytes).sha256, sha256(bytes));
  assert.throws(() => verifyNpmArchive(input, Buffer.from('other artifact')), /mismatch/);
  input.npm.tarball = 'https://untrusted.example/npm.tgz'; assert.throws(() => verifyNpmArchive(input, bytes), /pinned/);
});

test('source provenance rejects abbreviated revisions, absent hashes and fabricated epochs', () => {
  const input = { revision: 'a'.repeat(40), sourceSha256: 'b'.repeat(64), epoch: '1793304000', files: [{ path: 'package-lock.json', sha256: 'c'.repeat(64) }] };
  assert.equal(sourceProvenance(input).sourceDateEpoch, 1793304000);
  for (const delta of [{ revision: 'a'.repeat(7) }, { sourceSha256: '' }, { epoch: '' }, { epoch: '-1' }, { files: [] }]) assert.throws(() => sourceProvenance({ ...input, ...delta }));
});

test('recipe preserves package/browser/application targets while adding immutable acquisition controls', () => {
  const after = prepareDockerfile(Buffer.from(base), recipeLock());
  for (const capability of ['python3 make g++ ca-certificates', 'supervisor nginx curl ca-certificates tzdata git acl libcap2-bin libssl3 openssl', 'install --with-deps chromium', 'require("better-sqlite3")', 'npm run build --workspaces --if-present', 'FROM runtime-base AS compatibility', 'ENTRYPOINT ["/app/entrypoint.sh"]']) assert.ok(after.includes(capability), capability);
  assert.equal(after.split(lock.base.reference).length - 1, 2);
  assert.ok(after.includes('verify-indexes'));
  assert.ok(after.includes('npm install --offline --global --ignore-scripts'));
  assert.ok(after.includes('capture-source'));
  assert.ok(!after.includes('test -z "$IMAGE_SOURCE_SHA256"'));
  assert.ok(!after.includes('VEYRA_IMAGE_BUILD_CONTEXT=1\nENV'));
});

test('recipe refuses a drifted coordinator source or ambiguous anchor instead of rewriting it', () => {
  assert.throws(() => prepareDockerfile(Buffer.from(base + '# changed\n'), recipeLock()), /differs/);
  const altered = base.replace('COPY . .\n', 'COPY . .\nCOPY . .\n');
  assert.throws(() => prepareDockerfile(Buffer.from(altered), { ...recipeLock(), sourceRecipe: { dockerfileSha256: sha256(Buffer.from(altered)) } }), /exactly one/);
});

test('unified patch has bounded context and records actual additions/deletions', () => {
  assert.equal(unifiedPatch('a\nb\n', 'a\nb\n'), '');
  const patch = unifiedPatch('one\ntwo\nthree\n', 'one\nnew\nthree\n');
  assert.ok(patch.includes('--- a/Dockerfile\n+++ b/Dockerfile'));
  assert.ok(patch.includes('-two\n+new'));
  assert.ok(patch.includes('@@ -1,3 +1,3 @@'));
});

test('shell dollar-apostrophe sequences survive replacement without suffix expansion', () => {
  const after = prepareDockerfile(Buffer.from(base), recipeLock());
  assert.equal(after.split('FROM runtime-base AS compatibility').length - 1, 1);
  assert.ok(after.includes("grep -Eq '^[0-9a-f]{64}$'"));
});

const inputPaths = ['Dockerfile', 'package-lock.json', 'config/computer-use.lock.json', 'config/vendor-security.json', 'tools/veyra-release/linux-build.lock.json', 'tools/veyra-release/reproducible-linux.mjs'];
async function provenanceFixture() {
  const { verifyLinuxBuild } = await import('../tools/veyra-release/verify-linux-build.mjs');
  const input = clone();
  input.browser.artifacts = input.browser.artifacts.map(row => ({ ...row, sha256: '9'.repeat(64) }));
  const files = inputPaths.map(name => ({ path: name, sha256: 'e'.repeat(64) }));
  const sourceManifest = { schemaVersion: 1, revision: 'a'.repeat(40), sourceSha256: 'b'.repeat(64), sourceDateEpoch: 1793304000, files };
  const source = { ...sourceManifest, files: structuredClone(files) };
  const os = { base: input.base.reference, platform: input.platform, lockSha256: 'e'.repeat(64), node: input.base.node, npm: input.npm.version,
    indexes: input.apt.repositories.map(row => ({ suite: row.suite, sha256: row.inReleaseSha256, bytes: row.inReleaseBytes })), packages: ['libc6\t2.36-fixture\tamd64', 'ca-certificates\tfixture\tall'] };
  const browser = { packageVersion: input.browser.packageVersion, artifacts: structuredClone(input.browser.artifacts) };
  return { verifyLinuxBuild, values: { lock: input, lockSha256: 'e'.repeat(64), sourceManifest, source, builder: structuredClone(os), runtime: structuredClone(os), browser } };
}

test('all candidate/source/OS/browser identities bind before build-input verification', async () => {
  const { verifyLinuxBuild, values } = await provenanceFixture();
  assert.equal(verifyLinuxBuild(values).status, 'inputs-verified');
  values.source.revision = 'c'.repeat(40);
  assert.throws(() => verifyLinuxBuild(values), /differs/);
});

test('unqualified browser payloads remain an explicit gate, including missing headless/ffmpeg', async () => {
  for (const mutate of [value => { value.browser = undefined; }, value => { value.lock.browser.artifacts[0].sha256 = null; },
    value => { value.browser.artifacts.pop(); }, value => { value.browser.artifacts[2].sha256 = '0'.repeat(64); }, value => { value.browser.artifacts[1].hashKind = 'binary-only'; }]) {
    const { verifyLinuxBuild, values } = await provenanceFixture(); mutate(values);
    assert.equal(verifyLinuxBuild(values).status, 'incomplete');
  }
});

test('provenance rejects lock, recipe, installed-npm and observed-package mismatches', async () => {
  for (const mutate of [value => { value.runtime.npm = 'unlocked'; }, value => { value.builder.lockSha256 = '0'.repeat(64); },
    value => { value.runtime.indexes[0].sha256 = '0'.repeat(64); }, value => { value.source.files[0].sha256 = '0'.repeat(64); },
    value => { value.builder.packages.push(value.builder.packages[0]); }]) {
    const { verifyLinuxBuild, values } = await provenanceFixture(); mutate(values);
    assert.throws(() => verifyLinuxBuild(values));
  }
});

test('bounded descriptor reader checks actual lock bytes and rejects directory/oversize inputs', async () => {
  const { readPlain } = await import('../tools/veyra-release/reproducible-linux.mjs');
  const { fileURLToPath } = await import('node:url');
  const name = fileURLToPath(new URL('../tools/veyra-release/linux-build.lock.json', import.meta.url));
  assert.deepEqual(readPlain(name, 1024 * 1024), readFileSync(name));
  assert.throws(() => readPlain(name, 1), /Unsafe/);
  assert.throws(() => readPlain(fileURLToPath(new URL('../tools/veyra-release/', import.meta.url)), 1024 * 1024), /Unsafe/);
});

test('recipe syntax audit groups shell continuations without executing them', () => {
  const scripts = recipeRunScripts('FROM base\nRUN printf safe && \\\n    printf continuation\nARG next\nRUN printf final\n');
  assert.equal(scripts.length, 2);
  assert.ok(scripts[0].includes('printf continuation'));
  assert.ok(!scripts[0].includes('ARG next'));
  assert.equal(scripts[1], 'printf final');
});
