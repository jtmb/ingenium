import { test } from 'node:test';
import assert from 'node:assert/strict';
import { VoiceSession, validateScope } from '../../../packages/veyra-voice/session.mjs';
import { PcmNormalizer, UtteranceSegmenter, validateWav } from '../../../packages/veyra-voice/audio.mjs';
import { VoiceService } from '../lib/voice-v2/service.mjs';
import { SpeechWorker } from '../lib/voice-v2/speech-worker.mjs';

const scope = Object.freeze({ actorId: 'actor-a', accountId: 'account-a', organizationId: null, projectId: 'repo-one', conversationId: 'working-chat', runtimeId: 'wsl', executionBindingId: 'ubuntu-repo-one', executionRevision: 'workspace-hash-epoch-instance-revision-1', agentId: 'working-agent' });
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function wav() {
  const bytes = new Uint8Array(364), view = new DataView(bytes.buffer);
  for (const [offset, text] of [[0, 'RIFF'], [8, 'WAVE'], [12, 'fmt '], [36, 'data']]) bytes.set(new TextEncoder().encode(text), offset);
  view.setUint32(4, 356, true); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true); view.setUint32(24, 16000, true); view.setUint32(28, 32000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true); view.setUint32(40, 320, true); return bytes;
}
function harness(overrides = {}, mode = 'agent-call') {
  const calls = [];
  const ports = {
    connect: async request => ({ allowed: true, scope: request.scope, sessionId: request.sessionId }),
    transcribe: async () => ({ text: 'Check the failing tests' }),
    dictation: async request => { calls.push(['draft', request.text, request.scope]); },
    submit: async request => { calls.push(['submit', request]); return { scope, requestId: request.turn.requestId, text: 'I will inspect the failure.' }; },
    synthesize: async () => wav(), play: async request => { calls.push(['play', request]); },
    complete: async request => { calls.push(['complete', request]); },
    approve: async request => { calls.push(['approve', request]); },
    steer: async request => { calls.push(['steer', request]); return { scope, requestId: request.turn.requestId, operationId: request.operationId, accepted: true }; },
    interrupt: async request => { calls.push(['interrupt', request]); return { acknowledged: true, requestId: request.turn.requestId, scope }; },
    stopCapture: () => calls.push(['stopCapture']), stopPlayback: () => calls.push(['stopPlayback']), disconnect: async () => calls.push(['disconnect']), ...overrides,
  };
  return { session: new VoiceSession({ scope, mode, sessionId: 'session-a', ports }), ports, calls };
}

test('scope requires exact runtime, conversation and account; no extra authority fields', () => {
  assert.equal(validateScope(scope).projectId, 'repo-one');
  assert.throws(() => validateScope({ ...scope, token: 'forged' }), /VOICE_SCOPE_INVALID/);
  assert.throws(() => validateScope({ ...scope, executionBindingId: '' }), /VOICE_SCOPE_INVALID/);
  assert.throws(() => validateScope({ ...scope, executionRevision: '' }), /VOICE_SCOPE_INVALID/);
});
test('dictation inserts only into the bound draft and never submits or plays', async () => {
  const { session, calls } = harness({}, 'dictation'); await session.connect(); await session.receive(new Uint8Array(9600));
  assert.deepEqual(calls.map(call => call[0]), ['draft']); assert.equal(calls[0][2].conversationId, scope.conversationId);
  await assert.rejects(() => session.receive(new Uint8Array(480002)), /VOICE_PCM_INVALID/);
});
test('call uses exact working-agent scope and records playback completion', async () => {
  const { session, calls } = harness(); await session.connect(); await session.receive(new Uint8Array(9600));
  assert.equal(calls[0][1].scope.executionBindingId, scope.executionBindingId);
  assert.deepEqual(calls.map(call => call[0]), ['submit', 'play', 'complete']); assert.equal(session.getSnapshot().phase, 'ready');
});
test('speech request preserves the exact confirmed reply including surrounding whitespace', async () => {
  let synthesized;
  const rawReply = '  The targeted tests passed.\n';
  const { session } = harness({ submit: async request => ({ scope, requestId: request.turn.requestId, text: rawReply }), synthesize: async request => { synthesized = request.text; return wav(); } });
  await session.connect(); await session.sendText('run tests');
  assert.equal(synthesized, rawReply); assert.equal(session.getSnapshot().reply, rawReply.trim());
  assert.equal(session.getSnapshot().error, null);
});
test('native adapter ignoring abort cannot keep interruption pending indefinitely', async () => {
  const pending = deferred(); let interruptSignal;
  const { ports, calls } = harness({ submit: () => pending.promise, interrupt: request => { interruptSignal = request.signal; return new Promise(() => undefined); } });
  const session = new VoiceSession({ scope, mode: 'agent-call', sessionId: 'session-a', ports, interruptDeadlineMs: 5 });
  await session.connect(); const running = session.sendText('inspect'); await tick(); await session.interrupt();
  assert.equal(interruptSignal.aborted, true); assert.equal(session.getSnapshot().phase, 'ended');
  assert.equal(session.getSnapshot().error, 'VOICE_INTERRUPT_UNKNOWN'); assert(calls.some(call => call[0] === 'stopCapture'));
  pending.resolve({ scope, requestId: 'voice:session-a:1', text: 'stale' }); await running;
  assert.equal(calls.some(call => call[0] === 'play'), false);
});
test('scope-mismatched result cannot be synthesized or played', async () => {
  const { session, calls } = harness({ submit: async request => ({ scope: { ...scope, runtimeId: 'native' }, requestId: request.turn.requestId, text: 'foreign reply' }) });
  await session.connect(); await session.sendText('inspect');
  assert.equal(session.getSnapshot().error, 'VOICE_RESULT_SCOPE_MISMATCH'); assert.equal(calls.some(call => call[0] === 'play'), false);
});
test('interrupt invalidates late transcription before any model admission', async () => {
  const pending = deferred(), { session, calls } = harness({ transcribe: () => pending.promise });
  await session.connect(); const turn = session.receive(new Uint8Array(9600)); await session.interrupt(); pending.resolve({ text: 'stale' }); await turn;
  assert.equal(calls.some(call => call[0] === 'submit'), false); assert.equal(session.getSnapshot().phase, 'ready');
  await session.sendText('fresh'); assert.equal(calls.filter(call => call[0] === 'play').length, 1);
});
test('interrupt waits for native acknowledgement and suppresses late model reply', async () => {
  const reply = deferred(), ack = deferred();
  const { session, calls } = harness({ submit: () => reply.promise, interrupt: () => ack.promise });
  await session.connect(); const running = session.sendText('inspect'); await tick();
  const stopping = session.interrupt(); assert.equal(session.getSnapshot().phase, 'interrupting');
  await assert.rejects(() => session.sendText('too early'), /VOICE_NOT_READY/);
  ack.resolve({ acknowledged: true, requestId: 'voice:session-a:1', scope }); await stopping;
  reply.resolve({ scope, requestId: 'voice:session-a:1', text: 'late' }); await running;
  assert.equal(calls.some(call => call[0] === 'play'), false); assert.equal(session.getSnapshot().phase, 'ready');
});
test('unknown native interruption retires scope and stops capture', async () => {
  const reply = deferred(), { session, calls } = harness({ submit: () => reply.promise, interrupt: async () => ({ acknowledged: false }) });
  await session.connect(); const running = session.sendText('inspect'); await tick(); await session.interrupt();
  assert.equal(session.getSnapshot().phase, 'ended'); assert.equal(session.getSnapshot().error, 'VOICE_INTERRUPT_UNKNOWN'); assert(calls.some(call => call[0] === 'stopCapture'));
  reply.resolve({ scope, requestId: 'voice:session-a:1', text: 'late' }); await running;
  await assert.rejects(() => session.sendText('reuse'), /VOICE_NOT_READY/);
});
test('tool and permission events are fenced; steering/queue do not stop working agent', async () => {
  const reply = deferred(); let request;
  const { session, calls } = harness({ submit: value => { request = value; return reply.promise; } });
  await session.connect(); const running = session.sendText('inspect'); await tick();
  const event = { ...request.turn, scope, type: 'approval', approvalId: 'approval-1', label: 'Run the targeted tests?' };
  assert.equal(session.acceptEvent({ ...event, scope: { ...scope, conversationId: 'elsewhere' } }), false);
  assert.equal(session.acceptEvent(event), true); await session.decideApproval('allow-once');
  assert.equal(calls.find(call => call[0] === 'approve')[1].approvalId, 'approval-1');
  await session.sendText('Use the Windows runner', 'steer'); await session.sendText('Then report results', 'queue');
  assert.equal(calls.filter(call => call[0] === 'steer').length, 2); assert.equal(calls.some(call => call[0] === 'interrupt'), false);
  assert.notEqual(calls.filter(call => call[0] === 'steer')[0][1].operationId, calls.filter(call => call[0] === 'steer')[1][1].operationId);
  reply.resolve({ scope, requestId: request.turn.requestId, text: 'Done' }); await running;
  assert.equal(session.acceptEvent(event), false);
});
test('uncertain steering is fenced locally instead of automatically admitting another intervention', async () => {
  const pending = deferred(); let requests = 0;
  const { session } = harness({ submit: () => pending.promise, steer: async () => { requests++; throw new Error('connection lost after send'); } });
  await session.connect(); const running = session.sendText('inspect'); await tick();
  await assert.rejects(() => session.sendText('Change runner', 'steer'), /VOICE_STEERING_OUTCOME_UNKNOWN/);
  await assert.rejects(() => session.sendText('Change runner', 'steer'), /VOICE_STEERING_OUTCOME_UNKNOWN/); assert.equal(requests, 1);
  assert.equal(session.getSnapshot().error, 'VOICE_STEERING_OUTCOME_UNKNOWN');
  await session.interrupt(); pending.resolve({ scope, requestId: 'voice:session-a:1', text: 'late' }); await running;
});
test('barge-in rejects unqualified echo evidence; qualified signal cancels', async () => {
  const { session, calls } = harness(); await session.connect();
  assert.equal(await session.bargeIn({ echoCancelled: false, speechConfirmed: true }), false);
  assert.equal(await session.bargeIn({ echoCancelled: true, speechConfirmed: true }), true);
  assert(calls.some(call => call[0] === 'stopPlayback'));
});
test('end during connection cannot reopen microphone', async () => {
  const grant = deferred(), { session } = harness({ connect: () => grant.promise });
  const connecting = session.connect(); await session.end(); grant.resolve({ allowed: true, scope, sessionId: 'session-a' });
  assert.equal(await connecting, false); assert.equal(session.getSnapshot().phase, 'ended'); assert.equal(session.getSnapshot().muted, true);
});
test('mute clears capture and reconnect reauthorizes exact scope', async () => {
  let connections = 0;
  const { session, calls } = harness({ connect: async request => { connections++; return { allowed: true, scope, sessionId: request.sessionId }; } });
  await session.connect(); await session.mute(true); assert.equal(session.getSnapshot().muted, true);
  assert(calls.some(call => call[0] === 'stopCapture')); assert.equal(await session.reconnect(), true); assert.equal(connections, 2);
});
test('FIR resampling preserves chunk boundaries and rejects invalid input', () => {
  const signal = Float32Array.from({ length: 4800 }, (_, i) => Math.sin(i / 20));
  const one = new PcmNormalizer(48000).push(signal), split = new PcmNormalizer(48000);
  assert.deepEqual(one, new Uint8Array([...split.push(signal.subarray(0, 2000)), ...split.push(signal.subarray(2000))])); assert.equal(one.length, 3200);
  assert.throws(() => new PcmNormalizer(12345), /UNSUPPORTED/); assert.throws(() => split.push(new Float32Array([NaN])), /INVALID/);
  const high = Float32Array.from({ length: 4800 }, (_, i) => Math.sin(2 * Math.PI * 12000 * i / 48000));
  const filtered = new PcmNormalizer(48000).push(high), view = new DataView(filtered.buffer); let energy = 0;
  for (let i = 200; i < filtered.length; i += 2) energy += view.getInt16(i, true) ** 2;
  assert(Math.sqrt(energy / ((filtered.length - 200) / 2)) < 100);
});
test('segmentation suppresses noise, keeps pre-roll and bounds speech to 15 seconds', () => {
  const utterances = [], segmenter = new UtteranceSegmenter(pcm => utterances.push(pcm));
  const silence = new Uint8Array(6400), voice = new Uint8Array(6400), view = new DataView(voice.buffer);
  for (let i = 0; i < voice.length; i += 2) view.setInt16(i, 1000, true);
  for (let i = 0; i < 100; i++) segmenter.push(silence); assert.equal(utterances.length, 0); assert.equal(segmenter.preRoll.length, 6400);
  segmenter.push(voice); segmenter.push(voice); for (let i = 0; i < 4; i++) segmenter.push(silence);
  assert.equal(utterances.length, 1); assert(utterances[0].length <= 480000);
  for (let i = 0; i < 100; i++) segmenter.push(voice); assert(utterances.every(pcm => pcm.length <= 480000));
  assert.throws(() => segmenter.push(new Uint8Array(3)), /INVALID/);
});
test('WAV validation catches forged format, duration and truncated chunks', () => {
  assert.equal(validateWav(wav()).rate, 16000);
  const broken = wav(); new DataView(broken.buffer).setUint32(40, 99999999, true); assert.throws(() => validateWav(broken), /WAV_INVALID/);
  const rate = wav(); new DataView(rate.buffer).setUint32(24, 1, true); assert.throws(() => validateWav(rate), /WAV_INVALID/);
});

function serviceHarness(overrides = {}) {
  const calls = [], ledger = new Set();
  const service = new VoiceService({ authorize: async (_context, requested) => ({ allowed: true, scope: requested }),
    speech: { health: async () => undefined, transcribe: async () => ({ text: 'hello' }), synthesize: async () => wav() },
    agent: { submit: async request => { calls.push(['submit', request]); return { scope, requestId: request.turn.requestId, text: 'hello', usage: 4 }; }, interrupt: async request => ({ scope, requestId: request.turn.requestId, acknowledged: true }), closeVoice: async () => calls.push(['close']) },
    operations: { reserve: async request => { if (ledger.has(request.requestId)) return { accepted: false }; ledger.add(request.requestId); return { accepted: true }; }, settle: async request => calls.push(['settle', request]) }, ...overrides });
  const turn = { sessionId: 'service-a', turnId: 1, generation: 0, requestId: 'voice:service-a:1' };
  const envelope = { scope, turn, text: 'hello', delivery: 'prompt', signal: new AbortController().signal };
  return { service, calls, envelope };
}
test('API uses durable admission once and closes only voice resources', async () => {
  const { service, calls, envelope } = serviceHarness(); await service.open({}, { scope, sessionId: 'service-a', mode: 'agent-call' });
  await service.submit({}, envelope); await assert.rejects(() => service.submit({}, envelope), /CONFLICT/);
  await service.synthesize({}, envelope); await service.complete({}, envelope); await service.close({}, { scope, sessionId: 'service-a' });
  assert.equal(calls.filter(call => call[0] === 'submit').length, 1); assert.equal(calls.find(call => call[0] === 'settle')[1].outcome, 'completed');
});
test('API denied access reserves no operation and cross-runtime calls fail', async () => {
  const denied = serviceHarness({ authorize: async () => ({ allowed: false }) });
  await assert.rejects(() => denied.service.open({}, { scope, sessionId: 'service-a', mode: 'agent-call' }), /FORBIDDEN/); assert.equal(denied.calls.length, 0);
  const { service, envelope } = serviceHarness(); await service.open({}, { scope, sessionId: 'service-a', mode: 'agent-call' });
  await assert.rejects(() => service.submit({}, { ...envelope, scope: { ...scope, runtimeId: 'native' } }), /SCOPE_EXPIRED/);
  await assert.rejects(() => service.submit({}, { ...envelope, scope: { ...scope, executionRevision: 'new-epoch' } }), /SCOPE_EXPIRED/);
  await assert.rejects(() => service.submit({}, { ...envelope, scope: { ...scope, actorId: 'other-person' } }), /SCOPE_EXPIRED/);
});
test('early completion cannot release an agent still generating; speech must match its actual result', async () => {
  const pending = deferred();
  const { service, envelope } = serviceHarness({ agent: { submit: () => pending.promise } });
  await service.open({}, { scope, sessionId: 'service-a', mode: 'agent-call' });
  const running = service.submit({}, envelope); await tick();
  await assert.rejects(() => service.complete({}, envelope), /CONFLICT/);
  await assert.rejects(() => service.synthesize({}, envelope), /CONFLICT/);
  pending.resolve({ scope, requestId: envelope.turn.requestId, text: 'actual answer' }); await running;
  await assert.rejects(() => service.synthesize({}, { ...envelope, text: 'forged answer' }), /CONFLICT/);
});
test('API checks revocation at each boundary and blocks duplicate after cold recreation', async () => {
  let allowed = true;
  const { service, envelope } = serviceHarness({ authorize: async () => ({ allowed, scope }), operations: { reserve: async () => ({ accepted: false }), settle: async () => assert.fail('duplicate must not settle') } });
  await service.open({}, { scope, sessionId: 'service-a', mode: 'agent-call' }); allowed = false;
  await assert.rejects(() => service.transcribe({}, envelope), /FORBIDDEN/); allowed = true;
  await assert.rejects(() => service.submit({}, envelope), /DUPLICATE_OR_UNKNOWN/);
});
test('steer and queue have durable operation IDs; duplicate and unknown controls never replay native work', async () => {
  const pending = deferred(); let nativeControls = 0;
  const { service, envelope, calls } = serviceHarness({ agent: {
    submit: () => pending.promise,
    steer: async request => { nativeControls++; if (request.delivery === 'queue') throw new Error('unknown native control outcome'); return { accepted: true, scope, requestId: request.turn.requestId }; },
  } });
  await service.open({}, { scope, sessionId: 'service-a', mode: 'agent-call' }); const running = service.submit({}, envelope); await tick();
  const steer = { ...envelope, delivery: 'steer', operationId: 'voice-control:service-a:1' };
  assert.equal((await service.steer({}, steer)).operationId, steer.operationId);
  await assert.rejects(() => service.steer({}, steer), /VOICE_DUPLICATE_OR_UNKNOWN/);
  const queue = { ...envelope, delivery: 'queue', operationId: 'voice-control:service-a:2' };
  await assert.rejects(() => service.steer({}, queue), /unknown native control outcome/);
  await assert.rejects(() => service.steer({}, queue), /VOICE_DUPLICATE_OR_UNKNOWN/); assert.equal(nativeControls, 2);
  assert.equal(calls.find(call => call[0] === 'settle' && call[1].requestId === queue.operationId)[1].outcome, 'unknown');
  pending.resolve({ scope, requestId: envelope.turn.requestId, text: 'done' }); await running;
});
test('concurrent health checks reserve capacity before model readiness', async () => {
  const health = deferred(), { service } = serviceHarness({ maxSessions: 1, speech: { health: () => health.promise } });
  const first = service.open({}, { scope, sessionId: 'service-a', mode: 'agent-call' }); await tick();
  await assert.rejects(() => service.open({}, { scope, sessionId: 'second', mode: 'agent-call' }), /CAPACITY/); health.resolve(); await first;
});
test('closing during worker health cannot issue a late ready grant', async () => {
  const health = deferred(), { service } = serviceHarness({ speech: { health: () => health.promise } });
  const opening = service.open({}, { scope, sessionId: 'service-a', mode: 'agent-call' }); await tick();
  await service.close({}, { scope, sessionId: 'service-a' }); health.resolve();
  await assert.rejects(() => opening, /VOICE_SCOPE_EXPIRED/);
});
test('server will not admit a new agent turn before native interrupt acknowledgement', async () => {
  const reply = deferred(), ack = deferred();
  const { service, envelope } = serviceHarness({ agent: { submit: () => reply.promise, interrupt: () => ack.promise } });
  await service.open({}, { scope, sessionId: 'service-a', mode: 'agent-call' });
  const running = service.submit({}, envelope); await tick();
  const stopping = service.interrupt({}, envelope); await tick();
  const next = { ...envelope, turn: { ...envelope.turn, turnId: 2, requestId: 'voice:service-a:2', generation: 1 } };
  await assert.rejects(() => service.submit({}, next), /VOICE_SCOPE_EXPIRED/);
  ack.resolve({ acknowledged: true, scope, requestId: envelope.turn.requestId }); await stopping;
  reply.resolve({ scope, requestId: envelope.turn.requestId, text: 'late' }); await assert.rejects(() => running, /VOICE_TURN_CANCELLED/);
});
test('speech protocol enforces GPU readiness, bounded transcription and authenticated wire', async () => {
  const calls = [];
  const worker = new SpeechWorker({ baseUrl: 'http://speech:8092', token: 'fixture-secret', voice: 'af_heart', redactSpeech: text => text,
    fetch: async (url, options) => { calls.push([url.pathname, options]); return new Response(JSON.stringify(url.pathname === '/health' ? { ready: true, stt: true, tts: true, gpuReady: true, voices: ['af_heart'] } : { text: 'hello', language: 'en', durationMs: 300 }), { status: 200 }); } });
  await worker.health(); assert.equal((await worker.transcribe({ pcm: new Uint8Array(9600), turn: { requestId: 'voice:fixture:1' } })).text, 'hello');
  assert.equal(calls[1][1].headers.Authorization, 'Bearer fixture-secret'); assert.equal(calls[1][1].redirect, 'error');
  const unavailable = new SpeechWorker({ baseUrl: 'http://speech:8092', token: 'fixture', voice: 'af_heart', redactSpeech: x => x, fetch: async () => new Response(JSON.stringify({ ready: true, stt: true, tts: true, gpuReady: false, voice: 'af_heart' })) });
  await assert.rejects(() => unavailable.health(), /NOT_QUALIFIED/);
});
test('worker rejects oversize responses and validates actual WAV before playback', async () => {
  const worker = new SpeechWorker({ baseUrl: 'http://speech:8092', token: 'fixture', voice: 'af_heart', redactSpeech: x => x, fetch: async () => new Response('x'.repeat(20000)) });
  await assert.rejects(() => worker.transcribe({ pcm: new Uint8Array(9600), turn: { requestId: 'voice:fixture:1' } }), /RESPONSE_LIMIT/);
  const audio = new SpeechWorker({ baseUrl: 'http://speech:8092', token: 'fixture', voice: 'af_heart', redactSpeech: () => 'safe words', fetch: async () => new Response(wav()) });
  assert.equal(validateWav(await audio.synthesize({ text: 'private tool text', turn: { requestId: 'voice:fixture:2' } })).durationMs, 10);
});
