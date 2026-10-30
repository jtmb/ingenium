import test from 'node:test';
import assert from 'node:assert/strict';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { createHash } from 'node:crypto';
import { qualifyExactSource } from '../compatibility/exact-source-harness.mjs';
import { sha256File, withOwnedProcess, measureIdle, verifyExactSourceArtifact } from '../compatibility/process-qualification.mjs';
import { listenOwned, QualificationError } from '../compatibility/qualification-transport.mjs';
import { waitForReadiness } from '../compatibility/performance-harness.mjs';

const execute = promisify(execFile);
const sourceRoot = process.env.VEYRA_QUALIFICATION_SOURCE_ROOT
  ?? fileURLToPath(new URL('../../../', import.meta.url));
const gitCommand = process.env.VEYRA_QUALIFICATION_GIT_WSL === '1'
  ? { file: process.env.SystemRoot + '/System32/wsl.exe', prefix: ['-d', 'Ubuntu', '-u', 'brajam', '--', 'git'] }
  : { file: 'git', prefix: [] };
const head = (await execute(gitCommand.file, [...gitCommand.prefix, '-C', sourceRoot, 'rev-parse', 'HEAD'])).stdout.trim();
const fixture = fileURLToPath(new URL('./fixtures/qualification-child.mjs', import.meta.url));
const hash = await sha256File(process.execPath);
const scriptArtifact = { path: fixture, sha256: await sha256File(fixture) };
const artifact = { sourceRoot, expectedCommit: head, artifactPath: process.execPath,
  expectedBinarySha256: hash, scriptArtifact, gitCommand };
const spec = { file: process.execPath, args: [fixture], cwd: dirname(fixture),
  expectedExecutableSha256: hash, scriptArtifact, ipc: true };
const provenance = { sourceCommit: head, artifactSha256: hash,
  receiptSha256: createHash('sha256').update('synthetic fixture receipt, not real platform evidence').digest('hex') };
const credentials = {
  session: { cookie: '__Host-ingenium_session=synthetic-valid' },
  bearer: { authorization: 'Bearer synthetic-valid' },
  validCookieInvalidBearer: { cookie: '__Host-ingenium_session=synthetic-valid', authorization: 'Bearer synthetic-invalid' },
  invalidCookieValidBearer: { cookie: '__Host-ingenium_session=synthetic-invalid', authorization: 'Bearer synthetic-valid' },
  expiredSession: { cookie: '__Host-ingenium_session=synthetic-expired' },
  revokedSession: { cookie: '__Host-ingenium_session=synthetic-revoked' },
};

function originMessage(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { clean(); reject(new QualificationError('FIXTURE_MESSAGE_TIMEOUT')); }, 3000);
    function clean() { clearTimeout(timer); child.off('message', message); child.off('exit', exit); }
    function message(value) { clean(); resolve(value.origin); }
    function exit() { clean(); reject(new QualificationError('PROCESS_EXITED_BEFORE_READY')); }
    child.once('message', message); child.once('exit', exit);
  });
}

test('clean committed fixture source, executable and entrypoint bind the full metadata-only pipeline', async () => {
  const authority = await listenOwned((req, res) => {
    const valid = req.headers.cookie ? req.headers.cookie.endsWith('=synthetic-valid')
      : req.headers.authorization === 'Bearer synthetic-valid';
    res.writeHead(valid ? 200 : 401, { 'content-type': 'application/json', 'cache-control': 'no-store' });
    res.end(valid ? '{"data":[]}' : '{"error":{"code":"UNAUTHORIZED"}}');
  });
  const startup = { runs: 2, launch: callback => withOwnedProcess(spec, callback),
    ready: async child => {
      const origin = await originMessage(child);
      await waitForReadiness({ origin, expectedStatus: 200 });
    }, sampleIdle: pid => measureIdle(pid, { durationMs: 10 }) };
  try {
    const result = await qualifyExactSource({ artifact, authorityProvenance: provenance,
      evidenceClass: 'fixture', authorityOrigin: authority.origin, credentials,
      withEdge: (upstream, exercise) => withOwnedProcess({ ...spec,
        env: { ...process.env, VEYRA_QUALIFICATION_FIXTURE_UPSTREAM: upstream } },
      async ({ child }) => exercise(await originMessage(child))),
      latency: { iterations: 2, warmup: 0 },
      startupSubjects: [{ name: 'authority', artifact, options: startup }, { name: 'edge', artifact, options: startup }],
    });
    assert.equal(result.allRequiredMeasurementsPassed, true);
    assert.equal(result.evidenceClass, 'fixture');
    assert.equal(result.identity.sourceCommit, head);
    assert.equal(result.identity.scriptSha256, scriptArtifact.sha256);
    assert.equal(result.compatibility.cases.length, 12);
    assert.equal(result.apiLatency.authority.count, 2);
    assert.ok(result.lifecycle.every(item => item.closed));
    assert.equal(JSON.stringify(result).includes('__Host-ingenium_session'), false);
    assert.equal(JSON.stringify(result).includes('synthetic-valid'), false);
  } finally { await authority.close(); }
});

test('source binding refuses another commit, missing authority provenance and unexecuted script entrypoints', async () => {
  await assert.rejects(verifyExactSourceArtifact({ ...artifact, expectedCommit: '0'.repeat(40) }), /SOURCE_NOT_EXACT/);
  await assert.rejects(qualifyExactSource({ artifact, evidenceClass: 'fixture' }), /AUTHORITY_PROVENANCE_REQUIRED/);
  await assert.rejects(withOwnedProcess({ ...spec, args: [] }, () => {}), /SCRIPT_ENTRYPOINT_NOT_EXECUTED/);
  await assert.rejects(withOwnedProcess({ ...spec, args: ['--eval', '0', fixture] }, () => {}), /SCRIPT_ENTRYPOINT_NOT_EXECUTED/);
  await assert.rejects(withOwnedProcess({ ...spec, scriptArtifact: { ...scriptArtifact, sha256: '0'.repeat(64) } }, () => {}), /SCRIPT_HASH_MISMATCH/);
});

test('a launcher that does not return verified artifact and closure proof cannot qualify the exact-source edge', async () => {
  let invoked = false;
  await assert.rejects(qualifyExactSource({ artifact, authorityProvenance: provenance, evidenceClass: 'fixture',
    authorityOrigin: 'http://127.0.0.1:1', credentials,
    withEdge: async () => { invoked = true; return { ok: true, cleanup: { closed: true } }; },
  }), /EDGE_PROCESS_BINDING_OR_CLEANUP_FAILED/);
  assert.equal(invoked, true);
});
