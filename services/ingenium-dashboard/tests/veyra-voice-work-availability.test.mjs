import { test } from 'node:test';
import assert from 'node:assert/strict';
import { voiceWorkAvailability } from '../src/app/components/voice-v2/work-availability.mjs';
import { createDeferredDisposal } from '../src/app/components/voice-v2/deferred-disposal.mjs';
const scope = { actorId: 'actor', accountId: 'account', organizationId: null, projectId: null, conversationId: 'ses_existing', runtimeId: 'native', executionBindingId: 'binding', executionRevision: 'epoch', agentId: 'agent' };
const readiness = { gateway: true, speech: true, draft: true, agent: true };
test('Work voice is unavailable without exact scope, supplied ports or speech readiness', () => {
  assert.equal(voiceWorkAvailability({ scope: null, readiness, portsPresent: true }).state, 'unavailable');
  assert.equal(voiceWorkAvailability({ scope, readiness, portsPresent: false }).state, 'unavailable');
  assert.equal(voiceWorkAvailability({ scope, readiness: { ...readiness, speech: false }, portsPresent: true }).state, 'unavailable');
});
test('dictation can be offered independently of an unavailable working agent; duplex stays half', () => {
  const available = voiceWorkAvailability({ scope, readiness: { ...readiness, agent: false }, portsPresent: true });
  assert.deepEqual(available.modes, ['dictation']); assert.equal(available.duplex, 'half-duplex');
  assert.deepEqual(voiceWorkAvailability({ scope, readiness, portsPresent: true }).modes, ['dictation', 'agent-call', 'conversation']);
});
test('setup/cleanup/setup probes do not dispose a still-mounted voice client', () => {
  const tasks = []; let stopped = 0;
  const lifetime = createDeferredDisposal(() => stopped++, task => tasks.push(task));
  const firstRelease = lifetime.attach(); firstRelease();
  const realRelease = lifetime.attach(); tasks.splice(0).forEach(task => task()); assert.equal(stopped, 0);
  realRelease(); realRelease(); tasks.splice(0).forEach(task => task()); assert.equal(stopped, 1);
});
test('a real unmount disposes its own client without stopping a replacement scope', () => {
  const tasks = []; let oldStopped = 0, newStopped = 0;
  createDeferredDisposal(() => oldStopped++, task => tasks.push(task)).attach()();
  createDeferredDisposal(() => newStopped++, task => tasks.push(task)).attach();
  tasks.splice(0).forEach(task => task()); assert.equal(oldStopped, 1); assert.equal(newStopped, 0);
});
