import test from 'node:test';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { CpuOwnershipClient, cpuIdentity, cpuPayloadDigest, cpuProof } from '../../services/ingenium-api/lib/voice-v2/cpu-ownership.mjs';

const json = (value, status = 200) => new Response(JSON.stringify(value), { status, headers: { 'content-type': 'application/json' } });
function fixture() {
  const payload = new Uint8Array(8000);
  const request = randomUUID();
  const identity = cpuIdentity({ instanceId: 'fixture', bootId: randomUUID(), ownerId: randomUUID(), ownerGeneration: 1,
    requestId: request, operationId: request, generation: randomUUID(), kind: 'transcribe', digest: cpuPayloadDigest('transcribe', payload) });
  let state = 'reserved', outcome = null, drained = false, retentionId = randomUUID(), claimed = false;
  const calls = [], quarantined = [], accepted = []; let executions = 0;
  let lost = false, missing = false, wrongBoot = false, oversized = false, running = false, falseAuthority = false, wrongRetention = false;
  const proof = () => ({ identity: wrongBoot ? { ...identity, bootId: randomUUID() } : identity, state, outcome, drained,
    retentionId: wrongRetention ? randomUUID() : retentionId });
  // A test-only stand-in for the supervisor's original capability/durable ledger.
  // This is not an actual process retirement proof or a production port.
  const owner = {
    async claimDispatch(value) { if (claimed) return null; claimed = true; return { identity: value, permitId: randomUUID() }; },
    async quarantine(value, reason) { quarantined.push({ value, reason }); },
    async acceptTerminal(value, receipt) {
      if (falseAuthority) return true;
      assert.equal(receipt.retentionId, retentionId); assert.deepEqual(value, identity); assert.equal(drained, true);
      accepted.push(receipt); return { identity, retentionId, retired: true, replayAllowed: false };
    },
  };
  const requestPort = async (url, options) => {
    calls.push({ path: url.pathname, options });
    if (url.pathname === '/v2/operations/reserve') return json(proof());
    if (url.pathname === '/v2/transcriptions') {
      executions++; state = running ? 'running' : 'terminal'; outcome = running ? null : 'completed'; drained = !running;
      if (lost || running) throw new TypeError('fixture dropped original HTTP response');
      return json({ text: 'fixture', language: 'en', durationMs: 250 });
    }
    if (url.pathname === '/v2/operations/observe' || url.pathname === '/v2/operations/cancel') {
      if (missing) return json({ error: { code: 'ORIGINAL_UNAVAILABLE' } }, 404);
      if (oversized) return new Response('x'.repeat(8193));
      return json({ ...proof(), ...(url.pathname.endsWith('cancel') ? { accepted: true } : {}) });
    }
    throw new Error('Unexpected test endpoint');
  };
  return { identity, payload, owner, calls, quarantined, accepted,
    client: new CpuOwnershipClient({ baseUrl: 'http://127.0.0.1:9090', token: 'fixture-only-no-real-secret', owner, fetch: requestPort }),
    executions: () => executions, proof,
    configure(value) { ({ lost = lost, missing = missing, wrongBoot = wrongBoot, oversized = oversized, running = running,
      falseAuthority = falseAuthority, wrongRetention = wrongRetention } = value); },
    finish(value = 'cancelled') { state = 'terminal'; outcome = value; drained = true; retentionId = randomUUID(); },
  };
}

test('CPU protocol exact identity and payload digest are closed and immutable', () => {
  const f = fixture();
  assert(Object.isFrozen(f.identity));
  assert.throws(() => cpuIdentity({ ...f.identity, unexpected: true }));
  assert.throws(() => cpuIdentity({ ...f.identity, ownerGeneration: true }));
  assert.throws(() => cpuIdentity({ ...f.identity, operationId: randomUUID() }));
  assert.notEqual(cpuPayloadDigest('transcribe', new Uint8Array([1])), cpuPayloadDigest('synthesize', new Uint8Array([1])));
  assert.equal(cpuPayloadDigest('transcribe', new TextEncoder().encode('fixture')), '510701dc62875afbcb25e60d5329d7af23278177905e9742fd600f0a92aa79ee');
});
test('normal v2 completion requires both the exact worker terminal and supervisor retention', async () => {
  const f = fixture(), result = await f.client.start(f.identity, f.payload);
  assert.equal(result.retired, true); assert.equal(result.resultAvailable, true);
  assert.equal(f.executions(), 1); assert.equal(f.accepted.length, 1);
  assert.deepEqual(f.calls.map(call => call.path), ['/v2/operations/reserve', '/v2/transcriptions', '/v2/operations/observe']);
  assert.equal(f.calls[1].options.headers['X-Veyra-Identity'], JSON.stringify(f.identity));
});
test('lost response reconnects only through the original terminal proof and never reexecutes', async () => {
  const f = fixture(); f.configure({ lost: true });
  await assert.rejects(f.client.start(f.identity, f.payload), { code: 'CPU_OUTCOME_UNCERTAIN' });
  assert.equal(f.quarantined.length, 1);
  const result = await f.client.reconcile(f.identity);
  assert.equal(result.retired, true); assert.equal(result.resultAvailable, false); assert.equal(result.bytes, undefined);
  await assert.rejects(f.client.start(f.identity, f.payload), { code: 'CPU_OUTCOME_UNCERTAIN' });
  assert.equal(f.executions(), 1);
});
test('running cancel ACK does not retire; later exact terminal can reconcile', async () => {
  const f = fixture(); f.configure({ running: true });
  await assert.rejects(f.client.start(f.identity, f.payload));
  const ack = await f.client.cancel(f.identity);
  assert.equal(ack.retired, false); assert.equal(ack.proof.drained, false); assert.equal(f.accepted.length, 0);
  f.finish(); const terminal = await f.client.reconcile(f.identity);
  assert.equal(terminal.retired, true); assert.equal(terminal.proof.outcome, 'cancelled');
  assert.equal(f.executions(), 1);
});
test('every worker identity/generation/digest mismatch refuses retirement', () => {
  const f = fixture(); f.finish('completed');
  for (const [key, value] of Object.entries({ instanceId: 'other', bootId: randomUUID(), ownerId: randomUUID(),
    ownerGeneration: 2, generation: randomUUID(), digest: '0'.repeat(64), kind: 'synthesize' })) {
    assert.throws(() => cpuProof(f.identity, { ...f.proof(), identity: { ...f.identity, [key]: value } }));
  }
  assert.throws(() => cpuProof(f.identity, { ...f.proof(), drained: false }));
  assert.throws(() => cpuProof(f.identity, { ...f.proof(), retentionId: null }));
  assert.throws(() => cpuProof(f.identity, { ...f.proof(), outcome: 'idle' }));
});
test('missing state, oversized evidence and a replacement boot preserve quarantine', async () => {
  for (const setting of [{ missing: true }, { oversized: true }, { wrongBoot: true }]) {
    const f = fixture(); f.configure(setting);
    await assert.rejects(f.client.reconcile(f.identity), { code: 'CPU_OUTCOME_UNCERTAIN' });
    assert.equal(f.accepted.length, 0); assert.equal(f.quarantined.length, 1);
    assert(!f.calls.some(call => call.path === '/health'));
  }
});
test('a bare supervisor success boolean cannot replace a retained original proof', async () => {
  const f = fixture(); f.finish('completed'); f.configure({ falseAuthority: true });
  await assert.rejects(f.client.reconcile(f.identity), { code: 'CPU_OUTCOME_UNCERTAIN' });
  assert.equal(f.quarantined.length, 1);
});
test('a structurally valid terminal still requires the exact supervisor-retained transition', async () => {
  const f = fixture(); f.finish('completed'); f.configure({ wrongRetention: true });
  await assert.rejects(f.client.reconcile(f.identity), { code: 'CPU_OUTCOME_UNCERTAIN' });
  assert.equal(f.accepted.length, 0); assert.equal(f.quarantined.length, 1);
});
test('local payload refusal happens before any dispatch claim or HTTP effect', async () => {
  const f = fixture();
  await assert.rejects(f.client.start(f.identity, new Uint8Array(8002)), { code: 'CPU_PAYLOAD_INVALID' });
  assert.equal(f.calls.length, 0); assert.equal(f.quarantined.length, 0);
});
test('failed quarantine retention propagates a sanitized error without terminal fallback', async () => {
  const f = fixture(); f.configure({ missing: true });
  f.owner.quarantine = async () => { throw new Error('fixture-private-path-or-token'); };
  await assert.rejects(f.client.reconcile(f.identity), { code: 'CPU_QUARANTINE_RETENTION_UNCONFIRMED' });
  assert.equal(f.accepted.length, 0);
});
