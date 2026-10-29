import { test } from 'node:test';
import assert from 'node:assert/strict';
import { CurrentAgentVoiceAdapter, nativeVoiceMessageId } from '../lib/voice-v2/current-agent.mjs';

const scope = { actorId: 'human-one', accountId: 'account-one', organizationId: null, projectId: 'repo-one', conversationId: 'ses_working', runtimeId: 'wsl-one', executionBindingId: 'ubuntu-worktree', executionRevision: 'immutable-binding-epoch-7', agentId: 'selected-agent' };
const turn = { sessionId: 'voice-one', turnId: 1, generation: 0, requestId: 'voice:voice-one:1' };
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); return { promise, resolve, reject }; };
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(options = {}) {
  const calls = [], result = deferred(); let observation, inbox = [], running = true, insideBinding = false;
  const binding = { verified: true, scope, sessionId: scope.conversationId, directory: '/workspace/repo-one', protocol: 'opencode-v2.0.11' };
  const adapter = new CurrentAgentVoiceAdapter({
    resolveBinding: async input => { calls.push(['resolve', input.action]); return options.binding ?? binding; },
    withBinding: async (_binding, work) => { insideBinding = true; try { return await work(); } finally { insideBinding = false; } },
    observeTurn: options.noObserver ? undefined : async input => {
      observation = input; calls.push(['observe', input]);
      return { ready: Promise.resolve(), result: result.promise, stop: () => calls.push(['stop-observer']), ownsPermission: id => id === 'per_voice', ownsExecution: () => options.ownsExecution !== false };
    },
    request: async (path, request = {}) => {
      assert.equal(insideBinding, true); calls.push(['request', path, request]);
      if (path.endsWith('/prompt')) return { data: { id: options.wrongAdmission ? 'msg_other' : request.body.id, sessionID: scope.conversationId, delivery: request.body.delivery ?? 'steer' } };
      if (path.endsWith('/inbox')) return { data: inbox };
      if (path.includes('/inbox/')) { if (!options.uncertainCancel) inbox = inbox.filter(item => !path.endsWith('/' + encodeURIComponent(item.id))); return undefined; }
      if (path.endsWith('/interrupt')) { if (!options.staysRunning) running = false; return { interrupted: options.interrupted ?? true }; }
      if (path === '/api/session/active') return { data: running ? { [scope.conversationId]: { type: 'running' } } : {} };
      if (path.endsWith('/permission/per_voice')) return { data: { id: 'per_voice', sessionID: scope.conversationId } };
      if (path.endsWith('/reply')) return undefined;
      return { data: { id: scope.conversationId, location: { directory: binding.directory }, agent: scope.agentId, model: options.modelMissing ? undefined : { id: 'working-model', providerID: 'existing-provider', variant: 'existing-variant' } } };
    },
  });
  return { adapter, calls, result, observation: () => observation, setInbox: items => { inbox = items; }, setRunning: value => { running = value; } };
}
function complete(fixture, text = 'The current task is complete.') {
  fixture.result.resolve({ scope, nativeSessionId: scope.conversationId, promptId: nativeVoiceMessageId(scope, turn.requestId), outcome: 'succeeded', text });
}
test('stable native identity is derived from the full binding and durable operation ID', () => {
  assert.equal(nativeVoiceMessageId(scope, turn.requestId), nativeVoiceMessageId({ ...scope }, turn.requestId));
  assert.notEqual(nativeVoiceMessageId(scope, turn.requestId), nativeVoiceMessageId({ ...scope, executionRevision: 'new-epoch' }, turn.requestId));
  assert.throws(() => nativeVoiceMessageId(scope, ''), /VOICE_OPERATION_INVALID/);
});
test('native prompt subscribes before admission and never switches model, agent or permissions', async () => {
  const fixture = setup(), events = [];
  assert.equal((await fixture.adapter.availability({}, scope)).state, 'available');
  const running = fixture.adapter.submit({ scope, turn, text: 'Continue the current work', delivery: 'prompt', onEvent: event => events.push(event) }); await tick();
  const observeIndex = fixture.calls.findIndex(call => call[0] === 'observe');
  const promptIndex = fixture.calls.findIndex(call => call[0] === 'request' && call[1].endsWith('/prompt'));
  assert(observeIndex < promptIndex);
  const body = fixture.calls[promptIndex][2].body;
  assert.deepEqual(Object.keys(body).sort(), ['id', 'metadata', 'text']);
  assert.equal(body.id, nativeVoiceMessageId(scope, turn.requestId));
  fixture.observation().onEvent({ scope, nativeSessionId: scope.conversationId, promptId: body.id, type: 'tool', callId: 'tool-one', label: 'Inspect change', status: 'running' });
  fixture.observation().onEvent({ scope, nativeSessionId: 'ses_foreign', promptId: body.id, type: 'tool', callId: 'foreign', label: 'Wrong task', status: 'running' });
  assert.equal(events.length, 1); assert.equal(events[0].requestId, turn.requestId);
  complete(fixture); assert.equal((await running).text, 'The current task is complete.');
  assert(fixture.calls.some(call => call[0] === 'stop-observer'));
});
test('native steer and queue preserve delivery plus stable admission ID', async () => {
  const fixture = setup();
  for (const [delivery, sequence] of [['steer', 1], ['queue', 2]]) {
    const operationId = `voice-control:voice-one:${sequence}`;
    const ack = await fixture.adapter.steer({ scope, turn, operationId, delivery, text: 'Use the existing binding' });
    assert.equal(ack.operationId, operationId);
    const request = fixture.calls.filter(call => call[0] === 'request' && call[1].endsWith('/prompt')).at(-1)[2];
    assert.equal(request.body.delivery, delivery); assert.equal(request.body.id, nativeVoiceMessageId(scope, operationId));
    assert.equal(request.body.metadata.veyraVoice.requestId, turn.requestId);
  }
});
test('missing binding, observation or selected native model stays unavailable without fallback', async () => {
  assert.equal((await new CurrentAgentVoiceAdapter({}).availability({}, scope)).state, 'unavailable');
  assert.equal((await setup({ noObserver: true }).adapter.availability({}, scope)).reason, 'VOICE_AGENT_OBSERVER_UNAVAILABLE');
  assert.equal((await setup({ modelMissing: true }).adapter.availability({}, scope)).reason, 'VOICE_AGENT_SESSION_UNAVAILABLE');
  const fixture = setup({ binding: { verified: true, scope: { ...scope, runtimeId: 'other' }, sessionId: scope.conversationId, directory: '/other', protocol: 'opencode-v2.0.11' } });
  await assert.rejects(() => fixture.adapter.submit({ scope, turn, text: 'continue', delivery: 'prompt' }), /BINDING_UNAVAILABLE/);
  assert.equal(fixture.calls.some(call => call[0] === 'request'), false);
});
test('unknown native prompt admission never becomes a successful call', async () => {
  const fixture = setup({ wrongAdmission: true });
  await assert.rejects(() => fixture.adapter.submit({ scope, turn, text: 'continue', delivery: 'prompt' }), /ADMISSION_UNKNOWN/);
});
test('an unrelated native completion cannot become this voice reply or trigger replay', async () => {
  const fixture = setup();
  const running = fixture.adapter.submit({ scope, turn, text: 'continue', delivery: 'prompt' }); await tick();
  fixture.result.resolve({ scope, nativeSessionId: 'ses_elsewhere', promptId: nativeVoiceMessageId(scope, turn.requestId), outcome: 'succeeded', text: 'foreign result' });
  await assert.rejects(() => running, /TURN_OUTCOME_UNKNOWN/);
  assert.equal(fixture.calls.filter(call => call[0] === 'request' && call[1].endsWith('/prompt')).length, 1);
});
test('permission reply requires this observed turn and maps only once/reject', async () => {
  const fixture = setup(); const running = fixture.adapter.submit({ scope, turn, text: 'continue', delivery: 'prompt' }); await tick();
  await assert.rejects(() => fixture.adapter.approve({ scope, turn, approvalId: 'per_foreign', decision: 'allow-once' }), /APPROVAL_INVALID/);
  await fixture.adapter.approve({ scope, turn, approvalId: 'per_voice', decision: 'allow-once' });
  assert.equal(fixture.calls.find(call => call[0] === 'request' && call[1].endsWith('/reply'))[2].body.decision, 'once');
  complete(fixture); await running;
});
function inboxItem(operationId, voiceSessionId = turn.sessionId) {
  return { id: nativeVoiceMessageId(scope, operationId), sessionID: scope.conversationId, payload: { metadata: { veyraVoice: { sessionId: voiceSessionId, requestId: turn.requestId, operationId, executionRevision: scope.executionRevision } } } };
}
test('interrupt cancels only owned inbox records and confirms the native execution is absent', async () => {
  const fixture = setup(); const running = fixture.adapter.submit({ scope, turn, text: 'continue', delivery: 'prompt' }); await tick();
  const own = inboxItem('voice-control:voice-one:1'), foreign = inboxItem('voice-control:another:1', 'another'); fixture.setInbox([own, foreign]);
  const ack = await fixture.adapter.interrupt({ scope, turn }); assert.equal(ack.acknowledged, true);
  const deleted = fixture.calls.filter(call => call[0] === 'request' && call[2].method === 'DELETE'); assert.equal(deleted.length, 1); assert(deleted[0][1].endsWith(own.id));
  const interrupt = fixture.calls.find(call => call[0] === 'request' && call[1].endsWith('/interrupt')); assert.equal(interrupt[2].query.resume, 'false');
  complete(fixture); await running;
});
test('session-level native interrupt never stops an execution the event owner cannot identify', async () => {
  const fixture = setup({ ownsExecution: false });
  await assert.rejects(() => fixture.adapter.interrupt({ scope, turn }), /OWNERSHIP_UNKNOWN/);
  assert.equal(fixture.calls.some(call => call[0] === 'request' && call[1].endsWith('/interrupt')), false);
});
test('a false idle interrupt is acknowledged only after native inactivity is verified', async () => {
  const fixture = setup({ interrupted: false }); fixture.setRunning(false);
  assert.equal((await fixture.adapter.interrupt({ scope, turn })).acknowledged, true);
});
test('native interrupted=true cannot acknowledge a drain that is still active', async () => {
  const fixture = setup({ staysRunning: true });
  const running = fixture.adapter.submit({ scope, turn, text: 'continue', delivery: 'prompt' }); await tick();
  await assert.rejects(() => fixture.adapter.interrupt({ scope, turn }), /VOICE_INTERRUPT_UNKNOWN/);
  complete(fixture); await running;
});
test('forged ownership metadata cannot cause deletion of another native message ID', async () => {
  const fixture = setup(); const item = inboxItem('voice-control:voice-one:1'); item.id = 'msg_unrelated'; fixture.setInbox([item]);
  await assert.rejects(() => fixture.adapter.closeVoice({ scope, sessionId: turn.sessionId }), /VOICE_NATIVE_INBOX_UNKNOWN/);
  assert.equal(fixture.calls.some(call => call[0] === 'request' && call[2].method === 'DELETE'), false);
});
test('uncertain inbox cancellation is retained and not retried or treated as clean', async () => {
  const fixture = setup({ uncertainCancel: true }); fixture.setRunning(false); fixture.setInbox([inboxItem('voice-control:voice-one:1')]);
  await assert.rejects(() => fixture.adapter.closeVoice({ scope, sessionId: turn.sessionId }), /INBOX_UNKNOWN/);
  assert.equal(fixture.calls.filter(call => call[0] === 'request' && call[2].method === 'DELETE').length, 1);
  assert.equal(fixture.calls.some(call => call[0] === 'request' && call[1] === `/api/session/${scope.conversationId}` && call[2].method === 'DELETE'), false);
});
