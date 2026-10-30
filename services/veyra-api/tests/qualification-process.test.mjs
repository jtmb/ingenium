import test from 'node:test';
import assert from 'node:assert/strict';
import { fileURLToPath } from 'node:url';
import { dirname } from 'node:path';
import { sha256File, verifyExactSourceArtifact, withOwnedProcess, sampleProcess, measureIdle } from '../compatibility/process-qualification.mjs';
import { measureStarts, waitForReadiness } from '../compatibility/performance-harness.mjs';
import { QualificationError } from '../compatibility/qualification-transport.mjs';

const fixture = fileURLToPath(new URL('./fixtures/qualification-child.mjs', import.meta.url));
const executableHash = await sha256File(process.execPath);
const spec = { file: process.execPath, args: [fixture], cwd: dirname(fixture),
  expectedExecutableSha256: executableHash, ipc: true };

function fixtureOrigin(child) {
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => { cleanup(); reject(new QualificationError('FIXTURE_MESSAGE_TIMEOUT')); }, 3000);
    function cleanup() { clearTimeout(timer); child.off('message', message); child.off('exit', exit); }
    function message(value) { cleanup(); resolve(value.origin); }
    function exit() { cleanup(); reject(new QualificationError('PROCESS_EXITED_BEFORE_READY')); }
    child.once('message', message); child.once('exit', exit);
  });
}

test('owned ephemeral process has real RSS/CPU samples and closes after the callback', async () => {
  let pid;
  const result = await withOwnedProcess(spec, async ({ child }) => {
    pid = child.pid;
    const origin = await fixtureOrigin(child);
    await waitForReadiness({ origin, expectedStatus: 200 });
    const snapshot = await sampleProcess(pid);
    assert.ok(snapshot.rssBytes > 0); assert.ok(snapshot.cpuMs >= 0);
    return await measureIdle(pid, { durationMs: 20 });
  });
  assert.equal(result.ok, true);
  assert.equal(result.cleanup.closed, true);
  assert.ok(result.value.rssAfterBytes > 0);
  assert.ok(result.value.cpuPercentOneCore >= 0);
  assert.equal(result.output.contentsRetained, false);
  assert.throws(() => process.kill(pid, 0));
});

test('callback failure and early process exit still close only the owned child', async () => {
  const callbackFailure = await withOwnedProcess(spec, async ({ child }) => {
    await fixtureOrigin(child);
    throw new Error('private-callback-detail-must-not-be-reported');
  });
  assert.equal(callbackFailure.ok, false);
  assert.equal(callbackFailure.firstFailure, 'PROCESS_CALLBACK_FAILED');
  assert.equal(callbackFailure.cleanup.closed, true);
  assert.equal(JSON.stringify(callbackFailure).includes('private-callback-detail'), false);
  const early = await withOwnedProcess({ ...spec, env: { ...process.env, VEYRA_QUALIFICATION_FIXTURE_EXIT: '1' } },
    async ({ child }) => fixtureOrigin(child));
  assert.equal(early.ok, false); assert.equal(early.cleanup.closed, true);
  assert.equal(early.cleanup.exitCode, 7);
});

test('hash mismatch and malformed exact-source identity refuse before process launch', async () => {
  await assert.rejects(withOwnedProcess({ ...spec, expectedExecutableSha256: '0'.repeat(64) }, () => {}), /ARTIFACT_HASH_MISMATCH/);
  await assert.rejects(verifyExactSourceArtifact({ sourceRoot: '.', expectedCommit: 'not-a-commit' }), /INVALID_SOURCE_IDENTITY/);
  await assert.rejects(sha256File(fixture + '.missing'), /ARTIFACT_UNREADABLE/);
  await assert.rejects(verifyExactSourceArtifact({ sourceRoot: dirname(fixture), expectedCommit: '0'.repeat(40),
    artifactPath: process.execPath, expectedBinarySha256: executableHash }), /SCRIPT_ARTIFACT_REQUIRED/);
});

test('idle sampling refuses a reused PID or decreasing CPU counter', async () => {
  let calls = 0;
  await assert.rejects(measureIdle(123, { durationMs: 10, sample: async () => ({
    pid: 123, identity: ++calls === 1 ? 'first' : 'replacement', rssBytes: 100, cpuMs: 0,
  }) }), /PROCESS_IDENTITY_CHANGED/);
  await assert.rejects(sampleProcess(0), /INVALID_PROCESS_ID/);
});

test('first-process and relaunch samples have explicit uncontrolled-cache labels and guaranteed cleanup', async () => {
  const origins = new Map();
  const result = await measureStarts({ runs: 2,
    launch: callback => withOwnedProcess(spec, callback),
    ready: async child => {
      const origin = await fixtureOrigin(child); origins.set(child.pid, origin);
      await waitForReadiness({ origin, expectedStatus: 200 });
    },
    sampleIdle: pid => measureIdle(pid, { durationMs: 20 }),
  });
  assert.equal(result.accepted, true);
  assert.equal(result.measurements.length, 2);
  assert.equal(result.measurements[0].label, 'first-process-start');
  assert.equal(result.measurements[1].label, 'warm-process-relaunch');
  for (const run of result.measurements) {
    assert.ok(run.value.startupMs > 0);
    assert.equal(run.cacheState, 'OS-cache-uncontrolled');
    assert.equal(run.cleanup.closed, true);
    assert.throws(() => process.kill(run.cleanup.pid, 0));
  }
});

test('a stuck callback has a bounded deadline and still reaps its owned process', async () => {
  const result = await withOwnedProcess({ ...spec, callbackTimeoutMs: 100 },
    async () => new Promise(() => {}));
  assert.equal(result.ok, false);
  assert.equal(result.firstFailure, 'PROCESS_CALLBACK_TIMEOUT');
  assert.equal(result.cleanup.closed, true);
  assert.throws(() => process.kill(result.cleanup.pid, 0));
});

test('startup sequence stops at the first failed launch rather than silently retrying', async () => {
  let launches = 0;
  const result = await measureStarts({ runs: 3,
    launch: async () => { launches++; return { ok: false, firstFailure: 'READINESS_TIMEOUT', cleanup: { closed: true } }; },
    ready: () => {}, sampleIdle: () => {},
  });
  assert.equal(result.accepted, false);
  assert.equal(launches, 1);
  assert.equal(result.measurements.length, 1);
});
