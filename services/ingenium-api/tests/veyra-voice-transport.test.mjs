import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceService } from '../lib/voice-v2/service.mjs';
import { createVoiceHttp } from '../lib/voice-v2/http.mjs';
import { createHttpVoicePorts } from '../../ingenium-dashboard/src/app/components/voice-v2/http-ports.mjs';

const scope = { actorId: 'actor-a', accountId: 'a', organizationId: 'org', projectId: 'p', conversationId: 'c', runtimeId: 'wsl', executionBindingId: 'ubuntu-p', executionRevision: 'revision-1', agentId: 'agent' };
const turn = { sessionId: 'transport-a', turnId: 1, generation: 0, requestId: 'voice:transport-a:1' };
function setup({ authenticated = true, now = Date.now, ttlMs = 1800000 } = {}) {
  const calls = [], ledger = new Set();
  const service = new VoiceService({ now, ttlMs, authorize: async (_context, value) => ({ allowed: true, scope: value }),
    speech: { health: async () => undefined, transcribe: async () => ({ text: 'hello' }) },
    agent: { submit: async request => { request.onEvent({ scope, requestId: request.turn.requestId, type: 'tool', callId: 'tool-1', label: 'Inspect tests', status: 'running' }); return { scope, requestId: request.turn.requestId, text: 'The test is running.' }; }, interrupt: async request => ({ acknowledged: true, requestId: request.turn.requestId, scope }), closeVoice: async () => calls.push('close') },
    operations: { reserve: async request => { if (ledger.has(request.requestId)) return { accepted: false }; ledger.add(request.requestId); return { accepted: true }; }, settle: async request => calls.push(request.outcome) },
  });
  const handle = createVoiceHttp({ service, authenticate: async () => authenticated ? { subject: 'trusted' } : null });
  const request = (path, options) => handle(new Request(new URL(path, 'http://veyra.local'), options));
  return { service, calls, handle, ports: createHttpVoicePorts({ request, dictation: async () => undefined }) };
}
test('real HTTP consumer and handler stream scoped tool events and final result', async () => {
  const { ports, calls } = setup(), controller = new AbortController(), signal = controller.signal;
  await ports.connect({ scope, sessionId: turn.sessionId, mode: 'agent-call', signal });
  const events = [], result = await ports.submit({ scope, turn, text: 'inspect', delivery: 'prompt', signal, onEvent: event => events.push(event) });
  assert.equal(events.length, 1); assert.equal(events[0].executionBindingId, undefined); assert.equal(events[0].scope.executionBindingId, 'ubuntu-p'); assert.equal(events[0].generation, 0);
  assert.equal(result.text, 'The test is running.'); assert.deepEqual(calls, ['completed']);
  await ports.complete({ scope, turn, signal }); await ports.disconnect({ scope, sessionId: turn.sessionId }); assert(calls.includes('close'));
});
test('HTTP adapter rejects unauthenticated calls and unknown authority fields', async () => {
  const denied = setup({ authenticated: false });
  const rejected = await denied.handle(new Request('http://veyra.local/api/voice/v2/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}' })); assert.equal(rejected.status, 401);
  const { handle } = setup();
  const invalid = await handle(new Request('http://veyra.local/api/voice/v2/open', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ scope, sessionId: turn.sessionId, mode: 'agent-call', allowAll: true }) })); assert.equal(invalid.status, 400);
  const get = await handle(new Request('http://veyra.local/api/voice/v2/open')); assert.equal(get.status, 405);
});
test('binary transcription wire is bounded and exact scoped; replay is rejected', async () => {
  const { ports } = setup(), signal = new AbortController().signal;
  await ports.connect({ scope, sessionId: turn.sessionId, mode: 'dictation', signal });
  assert.equal((await ports.transcribe({ scope, turn, pcm: new Uint8Array(9600), signal })).text, 'hello');
  await assert.rejects(() => ports.transcribe({ scope, turn, pcm: new Uint8Array(9600), signal }), /VOICE_TURN_CONFLICT/);
});
test('unknown open outcome is not blindly retried', async () => {
  let requests = 0;
  const ports = createHttpVoicePorts({ dictation: async () => undefined, request: async () => { requests++; throw new Error('connection lost after send'); } });
  await assert.rejects(() => ports.connect({ scope, sessionId: turn.sessionId, mode: 'agent-call' }), /connection lost/);
  await assert.rejects(() => ports.connect({ scope, sessionId: turn.sessionId, mode: 'agent-call' }), /VOICE_OPEN_OUTCOME_UNKNOWN/); assert.equal(requests, 1);
});
test('truncated event stream preserves an unknown turn outcome', async () => {
  const ports = createHttpVoicePorts({ dictation: async () => undefined, request: async () => new Response('{"kind":"event","event":{}}\n', { headers: { 'Content-Type': 'application/x-ndjson' } }) });
  await assert.rejects(() => ports.submit({ scope, turn, text: 'inspect', delivery: 'prompt', onEvent: () => undefined }), /VOICE_AGENT_OUTCOME_UNKNOWN/);
});
test('expired sessions require native voice cleanup', async () => {
  let now = 1000;
  const { service } = setup({ now: () => now, ttlMs: 1000 });
  await service.open({}, { scope, mode: 'agent-call', sessionId: turn.sessionId }); now = 3000;
  await assert.rejects(() => service.submit({}, { scope, turn, text: 'expired', delivery: 'prompt' }), /VOICE_SCOPE_EXPIRED/);
  assert.deepEqual(await service.expire(), [{ sessionId: turn.sessionId, closed: true }]);
});
test('failed expiry cleanup is retained for reconciliation and cannot admit new work', async () => {
  let now = 1000;
  const service = new VoiceService({ now: () => now, ttlMs: 1000,
    authorize: async () => ({ allowed: true, scope }), speech: { health: async () => undefined },
    agent: { closeVoice: async () => { throw new Error('native cleanup unknown'); } }, operations: { reserve: async () => ({ accepted: true }), settle: async () => undefined },
  });
  await service.open({}, { scope, mode: 'agent-call', sessionId: turn.sessionId }); now = 3000;
  assert.deepEqual(await service.expire(), [{ sessionId: turn.sessionId, closed: false, code: 'VOICE_CLEANUP_UNKNOWN' }]);
  await assert.rejects(() => service.open({}, { scope, mode: 'agent-call', sessionId: turn.sessionId }), /VOICE_SESSION_CONFLICT/);
});
