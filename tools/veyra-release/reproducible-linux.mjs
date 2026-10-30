import fs from 'node:fs';
import path from 'node:path';
import { createHash } from 'node:crypto';
import { execFileSync } from 'node:child_process';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const sha256 = bytes => createHash('sha256').update(bytes).digest('hex');
const hex = (value, length) => typeof value === 'string' && value.length === length && [...value].every(c => '0123456789abcdef'.includes(c));
const imagePattern = /^node:22-bookworm-slim@sha256:[0-9a-f]{64}$/;
const snapshotPattern = /^[0-9]{8}T[0-9]{6}Z$/;
const indexName = (lock, repo) => `snapshot.debian.org_archive_${repo.archive}_${lock.apt.timestamp}_dists_${repo.suite}_InRelease`;

export function validateBuildLock(lock) {
  if (lock?.schemaVersion !== 1 || lock.platform !== 'linux/amd64' || !imagePattern.test(lock.base?.reference ?? '')
      || lock.base.manifestDigest !== lock.base.reference.split('@')[1] || lock.base.distribution !== 'bookworm'
      || !snapshotPattern.test(lock.apt?.timestamp ?? '') || lock.apt.architecture !== 'amd64'
      || lock.apt.keyring !== '/usr/share/keyrings/debian-archive-keyring.gpg') throw new Error('Invalid immutable Linux build lock');
  const expected = [['debian', 'bookworm'], ['debian', 'bookworm-updates'], ['debian-security', 'bookworm-security']];
  if (lock.apt.repositories?.length !== expected.length || expected.some(([archive, suite], i) => {
    const row = lock.apt.repositories[i];
    return row.archive !== archive || row.suite !== suite || !hex(row.inReleaseSha256, 64)
      || !Number.isSafeInteger(row.inReleaseBytes) || row.inReleaseBytes < 1 || row.inReleaseBytes > 2 * 1024 * 1024;
  })) throw new Error('Expected all three authenticated snapshot suites');
  if (lock.npm?.version !== '12.2.1' || lock.npm.tarball !== 'https://registry.npmjs.org/npm/-/npm-12.2.1.tgz'
      || !/^sha512-[A-Za-z0-9+/]{86}==$/.test(lock.npm.integrity ?? '')) throw new Error('Invalid pinned npm distribution');
  return lock;
}

export function renderAptSources(lock) {
  validateBuildLock(lock);
  // HTTP bootstraps CA installation; apt still requires the archive signature
  // and hash chain. Only historical expiry is disabled for these frozen suites.
  return lock.apt.repositories.map(repo => `deb [arch=amd64 check-valid-until=no signed-by=${lock.apt.keyring}] http://snapshot.debian.org/archive/${repo.archive}/${lock.apt.timestamp}/ ${repo.suite} main`).join('\n') + '\n';
}

export function renderAptConfig() {
  return 'Dir::Etc::sourcelist "/etc/apt/veyra/sources.list";\nDir::Etc::sourceparts "/etc/apt/veyra/empty";\nAPT::Get::AllowUnauthenticated "false";\nAcquire::AllowInsecureRepositories "false";\nAcquire::AllowDowngradeToInsecureRepositories "false";\n';
}

export function verifyIndexBytes(lock, files) {
  validateBuildLock(lock);
  const expected = lock.apt.repositories.map(repo => indexName(lock, repo));
  const actual = Object.keys(files).filter(name => name.endsWith('_InRelease'));
  if (actual.length !== expected.length || actual.some(name => !expected.includes(name))) throw new Error('Unexpected or missing apt snapshot index');
  return lock.apt.repositories.map(repo => {
    const name = indexName(lock, repo), bytes = files[name];
    if (!Buffer.isBuffer(bytes) || bytes.length !== repo.inReleaseBytes || sha256(bytes) !== repo.inReleaseSha256) throw new Error('Authenticated apt snapshot bytes changed: ' + repo.suite);
    return { suite: repo.suite, sha256: repo.inReleaseSha256, bytes: bytes.length };
  });
}

export function verifyNpmArchive(lock, bytes) {
  validateBuildLock(lock);
  if (!Buffer.isBuffer(bytes) || `sha512-${createHash('sha512').update(bytes).digest('base64')}` !== lock.npm.integrity) throw new Error('Pinned npm archive integrity mismatch');
  return { version: lock.npm.version, integrity: lock.npm.integrity, sha256: sha256(bytes), bytes: bytes.length };
}

export function readPlain(filename, maximumBytes) {
  const stat = fs.lstatSync(filename);
  if (!stat.isFile() || stat.isSymbolicLink() || stat.nlink !== 1 || stat.size > maximumBytes || fs.realpathSync(filename) !== path.resolve(filename)) throw new Error('Unsafe build input');
  const fd = fs.openSync(filename, fs.constants.O_RDONLY | (process.platform === 'win32' ? 0 : fs.constants.O_NOFOLLOW | fs.constants.O_NONBLOCK));
  try {
    const opened = fs.fstatSync(fd);
    if (opened.dev !== stat.dev || opened.ino !== stat.ino || opened.size !== stat.size || opened.nlink !== 1 || !opened.isFile() || opened.mtimeMs !== stat.mtimeMs || opened.ctimeMs !== stat.ctimeMs) throw new Error('Build input changed before reading');
    const bytes = Buffer.alloc(opened.size);
    let offset = 0;
    while (offset < bytes.length) {
      const read = fs.readSync(fd, bytes, offset, bytes.length - offset, offset);
      if (!read) throw new Error('Build input truncated');
      offset += read;
    }
    const after = fs.fstatSync(fd), current = fs.lstatSync(filename);
    if (fs.readSync(fd, Buffer.alloc(1), 0, 1, offset) !== 0 || after.dev !== current.dev || after.ino !== current.ino
        || after.size !== opened.size || current.size !== after.size || after.mtimeMs !== current.mtimeMs || after.ctimeMs !== current.ctimeMs || after.nlink !== 1 || current.nlink !== 1 || !current.isFile()
        || after.mtimeMs !== opened.mtimeMs || after.ctimeMs !== opened.ctimeMs || fs.realpathSync(filename) !== path.resolve(filename)) throw new Error('Build input changed while reading');
    return bytes;
  } finally { fs.closeSync(fd); }
}

function requireImageBuild(lock) {
  if (process.env.VEYRA_IMAGE_BUILD_CONTEXT !== '1' || process.platform !== 'linux' || process.getuid() !== 0) throw new Error('Image-only command requires explicit Linux root build context');
  if (execFileSync('dpkg', ['--print-architecture'], { encoding: 'utf8' }).trim() !== lock.apt.architecture || process.versions.node !== lock.base.node) throw new Error('Actual base architecture/Node version differs from lock');
}

function verifyIndexesOnDisk(lock) {
  const directory = '/var/lib/apt/lists';
  const files = Object.fromEntries(fs.readdirSync(directory).filter(name => name.endsWith('_InRelease')).map(name => [name, readPlain(path.join(directory, name), 2 * 1024 * 1024)]));
  return verifyIndexBytes(lock, files);
}

export function sourceProvenance({ revision, sourceSha256, epoch, files }) {
  if (!hex(revision, 40) || !hex(sourceSha256, 64) || !/^[0-9]{1,12}$/.test(epoch ?? '') || Number(epoch) <= 0 || !Array.isArray(files) || files.length === 0) throw new Error('Exact source revision/hash/commit epoch and file identities required');
  if (files.some(file => !file.path || !hex(file.sha256, 64))) throw new Error('Invalid source input inventory');
  return { schemaVersion: 1, revision, sourceSha256, sourceDateEpoch: Number(epoch), files,
    acceptance: 'Build-input evidence only; package/platform/runtime/rebuild comparison remains required' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    const [mode, lockPath, output] = process.argv.slice(2);
    const lockBytes = readPlain(lockPath, 1024 * 1024), lock = validateBuildLock(JSON.parse(lockBytes));
    if (mode === 'sources') process.stdout.write(renderAptSources(lock));
    else {
      requireImageBuild(lock);
      if (mode === 'configure') {
        fs.mkdirSync('/etc/apt/veyra/empty', { recursive: true });
        fs.writeFileSync('/etc/apt/veyra/sources.list', renderAptSources(lock), { flag: 'wx' });
        fs.writeFileSync('/etc/apt/apt.conf.d/99veyra-snapshot', renderAptConfig(), { flag: 'wx' });
      } else if (mode === 'verify-indexes') console.log(JSON.stringify({ indexes: verifyIndexesOnDisk(lock) }));
      else if (mode === 'verify-npm') console.log(JSON.stringify(verifyNpmArchive(lock, readPlain(output, 64 * 1024 * 1024))));
      else if (mode === 'capture-os') {
        if (!['/usr/local/share/veyra/builder-os-inputs.json', '/usr/local/share/veyra/runtime-os-inputs.json'].includes(output)) throw new Error('Undeclared image provenance output');
        const packages = execFileSync('dpkg-query', ['-W', '-f=${binary:Package}\t${Version}\t${Architecture}\n'], { encoding: 'utf8', maxBuffer: 8 * 1024 * 1024 }).trim().split('\n').sort();
        const npm = JSON.parse(readPlain('/usr/local/lib/node_modules/npm/package.json', 1024 * 1024)).version;
        fs.mkdirSync(path.dirname(output), { recursive: true });
        fs.writeFileSync(output, JSON.stringify({ schemaVersion: 1, base: lock.base.reference, platform: lock.platform, lockSha256: sha256(lockBytes), node: process.versions.node, npm, indexes: verifyIndexesOnDisk(lock), packages }, null, 2) + '\n', { flag: 'wx' });
      } else if (mode === 'capture-source') {
        if (output !== '/usr/local/share/veyra/source-inputs.json') throw new Error('Undeclared image source receipt');
        const names = ['Dockerfile', 'package-lock.json', 'config/computer-use.lock.json', 'config/vendor-security.json', 'tools/veyra-release/linux-build.lock.json', 'tools/veyra-release/reproducible-linux.mjs'];
        const files = names.map(name => ({ path: name, sha256: sha256(readPlain(path.join('/app', name), 8 * 1024 * 1024)) }));
        const receipt = sourceProvenance({ revision: process.env.IMAGE_REVISION, sourceSha256: process.env.IMAGE_SOURCE_SHA256, epoch: process.env.SOURCE_DATE_EPOCH, files });
        fs.writeFileSync(output, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx' });
      } else throw new Error('Unsupported image build provenance command');
    }
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
