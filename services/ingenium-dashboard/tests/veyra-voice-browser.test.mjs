import { test } from 'node:test';
import assert from 'node:assert/strict';
import { BrowserAudio } from '../src/app/components/voice-v2/browser-audio.mjs';
import { VoiceClient } from '../src/app/components/voice-v2/voice-client.mjs';

const deferred = () => { let resolve; const promise = new Promise(yes => { resolve = yes; }); return { promise, resolve }; };
const scope = { actorId: 'actor-a', accountId: 'a', organizationId: null, projectId: null, conversationId: 'c', runtimeId: 'native', executionBindingId: 'native-projectless', executionRevision: 'revision-1', agentId: 'agent' };
const tick = () => new Promise(resolve => setImmediate(resolve));
test('pending device permission resolved after stop immediately releases tracks', async () => {
  const permission = deferred(); let stopped = 0;
  const media = new BrowserAudio({ navigator: { mediaDevices: { getUserMedia: () => permission.promise } } });
  const starting = media.startCapture({ onPcm: () => assert.fail('must never capture') });
  media.stopCapture(); permission.resolve({ getTracks: () => [{ stop: () => stopped++ }] });
  assert.equal(await starting, false); assert.equal(stopped, 1);
});
test('capture failure closes resources and a retry never reuses the stopped stream', async () => {
  let stopped = 0;
  const media = new BrowserAudio({ navigator: { mediaDevices: { getUserMedia: async () => ({ getTracks: () => [{ stop: () => stopped++ }] }) } }, AudioContext: class { constructor() { throw new Error('device failed'); } } });
  await assert.rejects(() => media.startCapture({ onPcm: () => undefined }), /device failed/);
  assert(stopped >= 1);
});
function clientHarness({ microphoneFails = false, speechGate } = {}) {
  const calls = []; let capture;
  const reply = deferred();
  const media = {
    startCapture: async options => { calls.push('capture'); capture = options; if (microphoneFails) throw new Error('denied'); return { echoCancellation: true }; },
    stopCapture: () => calls.push('stopCapture'), stopPlayback: () => calls.push('stopPlayback'), play: async () => calls.push('play'), dispose: () => calls.push('dispose'),
  };
  const client = new VoiceClient({ scope, mode: 'agent-call', sessionId: 'browser-session', media, speechGate, onError: code => calls.push(code), ports: {
    connect: async request => ({ allowed: true, scope, sessionId: request.sessionId }),
    transcribe: async () => ({ text: 'hello' }), submit: () => reply.promise,
    interrupt: async request => ({ acknowledged: true, scope, requestId: request.turn.requestId }),
    synthesize: async () => new Uint8Array(44), complete: async () => undefined, disconnect: async () => calls.push('disconnect'),
  } });
  return { client, calls, reply, pcm: pcm => capture.onPcm(pcm) };
}
test('client acquires microphone only on explicit start and permission failure stays muted', async () => {
  const { client, calls } = clientHarness({ microphoneFails: true }); assert.equal(calls.length, 0);
  await client.start(); assert.equal(client.session.getSnapshot().muted, true); assert(calls.includes('VOICE_MICROPHONE_UNAVAILABLE'));
  assert.equal(client.session.getSnapshot().error, 'VOICE_MICROPHONE_UNAVAILABLE');
  await client.end(); assert(calls.includes('dispose')); assert(calls.includes('disconnect'));
});
test('half duplex blocks room echo; qualified speech gate barge-in stops the current turn', async () => {
  let inspected = 0;
  const { client, calls, reply, pcm } = clientHarness({ speechGate: { inspect: () => { inspected++; return { echoCancelled: true, speechConfirmed: true }; } } });
  await client.start(); const running = client.session.sendText('inspect'); await tick();
  pcm(new Uint8Array(640)); await tick();
  assert.equal(inspected, 1); assert(calls.includes('stopPlayback')); assert.equal(client.session.getSnapshot().phase, 'ready');
  reply.resolve({ scope, requestId: 'voice:browser-session:1', text: 'late' }); await running;
  assert.equal(calls.includes('play'), false); await client.end();
});
test('unqualified input during agent work cannot invoke barge-in or playback', async () => {
  const { client, calls, reply, pcm } = clientHarness(); await client.start();
  const running = client.session.sendText('inspect'); await tick(); pcm(new Uint8Array(640));
  assert.equal(calls.includes('stopPlayback'), false); assert.equal(client.session.getSnapshot().phase, 'thinking');
  await client.end(); reply.resolve({ scope, requestId: 'voice:browser-session:1', text: 'late' }); await running;
});
