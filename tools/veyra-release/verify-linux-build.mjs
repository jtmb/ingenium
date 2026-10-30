import fs from 'node:fs';
import path from 'node:path';
import { pathToFileURL } from 'node:url';
import { sha256, validateBuildLock, readPlain } from './reproducible-linux.mjs';

const requiredSourcePaths = ['Dockerfile', 'package-lock.json', 'config/computer-use.lock.json', 'config/vendor-security.json', 'tools/veyra-release/linux-build.lock.json', 'tools/veyra-release/reproducible-linux.mjs'];

export function verifyLinuxBuild({ lock, lockSha256, sourceManifest, source, builder, runtime, browser }) {
  validateBuildLock(lock);
  if (source?.schemaVersion !== 1 || sourceManifest?.schemaVersion !== 1 || !/^[0-9a-f]{40}$/.test(source?.revision ?? '') || !/^[0-9a-f]{64}$/.test(source?.sourceSha256 ?? '') || !/^[0-9a-f]{64}$/.test(lockSha256 ?? '') || source?.revision !== sourceManifest?.revision || source?.sourceSha256 !== sourceManifest?.sourceSha256
      || !Number.isSafeInteger(sourceManifest?.sourceDateEpoch) || sourceManifest.sourceDateEpoch <= 0 || source.sourceDateEpoch !== sourceManifest.sourceDateEpoch) throw new Error('Built source receipt differs from exact source manifest');
  if (!Array.isArray(source.files) || source.files.length !== requiredSourcePaths.length || new Set(source.files.map(file => file.path)).size !== source.files.length) throw new Error('Built source input closure incomplete');
  for (const name of requiredSourcePaths) {
    const expected = sourceManifest.files?.find(file => file.path === name), actual = source.files.find(file => file.path === name);
    if (!expected || !actual || expected.sha256 !== actual.sha256) throw new Error('Build recipe/dependency input differs from committed source: ' + name);
  }
  if (source.files.find(file => file.path === 'tools/veyra-release/linux-build.lock.json').sha256 !== lockSha256) throw new Error('Build lock bytes differ from exact committed source');
  const packageCounts = {};
  for (const [role, receipt] of Object.entries({ builder, runtime })) {
    if (receipt?.base !== lock.base.reference || receipt.platform !== lock.platform || receipt.lockSha256 !== lockSha256
        || receipt.node !== lock.base.node || !Array.isArray(receipt.indexes) || receipt.indexes.length !== 3) throw new Error('Base/OS provenance differs from lock: ' + role);
    if (role === 'runtime' && receipt.npm !== lock.npm.version) throw new Error('Runtime npm differs from pinned archive');
    for (const repo of lock.apt.repositories) {
      const row = receipt.indexes.find(index => index.suite === repo.suite);
      if (!row || row.sha256 !== repo.inReleaseSha256 || row.bytes !== repo.inReleaseBytes) throw new Error('OS package resolution was not the approved snapshot');
    }
    if (!Array.isArray(receipt.packages) || !receipt.packages.length) throw new Error('Observed OS package closure missing');
    const names = new Set();
    for (const line of receipt.packages) {
      const fields = line.split('\t');
      if (fields.length !== 3 || fields.some(value => !value) || names.has(fields[0])) throw new Error('Invalid observed OS package closure');
      names.add(fields[0]);
    }
    packageCounts[role] = names.size;
  }
  const expectedNames = ['chromium', 'chromium-headless-shell', 'ffmpeg'];
  const browserReady = browser?.packageVersion === lock.browser?.packageVersion
    && lock.browser?.artifacts?.length === 3 && browser?.artifacts?.length === 3
    && new Set(browser.artifacts.map(row => row.name)).size === 3
    && expectedNames.every(name => {
      const expected = lock.browser.artifacts.find(row => row.name === name), actual = browser.artifacts.find(row => row.name === name);
      return expected && /^[0-9a-f]{64}$/.test(expected.sha256 ?? '') && actual && actual.sha256 === expected.sha256 && actual.revision === expected.revision;
    });
  return { schemaVersion: 1, revision: source.revision, sourceSha256: source.sourceSha256, lockSha256,
    status: browserReady ? 'inputs-verified' : 'incomplete', packageCounts,
    remaining: browserReady ? ['Actual integrated package/platform acceptance and independent rebuild comparison'] : ['Qualified browser artifact content lock and matching acquisition receipt', 'Actual integrated package/platform acceptance and independent rebuild comparison'],
    acceptance: 'Build inputs only; not runtime or bit-for-bit rebuild acceptance' };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  try {
    if (process.argv.length !== 5) throw new Error('Usage: node verify-linux-build.mjs BUILD_LOCK EXACT_SOURCE_MANIFEST RECEIPT_DIRECTORY');
    const lockBytes = readPlain(process.argv[2], 1024 * 1024), sourceManifest = JSON.parse(readPlain(process.argv[3], 8 * 1024 * 1024));
    const root = fs.realpathSync(process.argv[4]);
    const read = name => JSON.parse(readPlain(path.join(root, name), 8 * 1024 * 1024));
    const report = verifyLinuxBuild({ lock: JSON.parse(lockBytes), lockSha256: sha256(lockBytes), sourceManifest,
      source: read('source-inputs.json'), builder: read('builder-os-inputs.json'), runtime: read('runtime-os-inputs.json'),
      browser: fs.existsSync(path.join(root, 'browser-inputs.json')) ? read('browser-inputs.json') : undefined });
    console.log(JSON.stringify(report, null, 2));
    if (report.status !== 'inputs-verified') process.exitCode = 2;
  } catch (error) { console.error(error.message); process.exitCode = 1; }
}
