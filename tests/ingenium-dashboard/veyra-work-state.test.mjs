import test from 'node:test';
import assert from 'node:assert/strict';
import { canSendWork, emptyWorkDraft, initialWorkDraft, workAttachmentError, workDraftKey } from '../../services/ingenium-dashboard/src/app/components/veyra-work/work-state.ts';

const identity = { instanceId: 'installation-a', ownerId: 'owner-a', organizationId: 'org-a', projectId: 'project-a', runtimeId: 'runtime-a', workspaceId: 'workspace-a', sessionId: 'session-a' };

test('draft identity isolates every authority dimension and new conversation', () => {
  const original = workDraftKey(identity);
  for (const field of Object.keys(identity)) {
    assert.notEqual(workDraftKey({ ...identity, [field]: `${identity[field]}-other` }), original, field);
  }
  assert.notEqual(workDraftKey({ ...identity, sessionId: null }), original);
  assert.notEqual(workDraftKey({ ...identity, projectId: null }), workDraftKey({ ...identity, projectId: 'global-default' }));
  assert.notEqual(workDraftKey({ ...identity, projectId: 'a,b', workspaceId: 'c' }), workDraftKey({ ...identity, projectId: 'a', workspaceId: 'b,c' }));
});

test('new drafts have independent attachment and skill collections', () => {
  const a = emptyWorkDraft();
  a.skillIds.push('explicit-skill');
  a.attachments.push({ id: 'file', name: 'notes.txt', mime: 'text/plain', url: 'data:text/plain,notes' });
  assert.deepEqual(emptyWorkDraft().skillIds, []);
  assert.deepEqual(emptyWorkDraft().attachments, []);
});

test('sending requires hydrated session, available selection, content and idle operation', () => {
  const draft = { ...emptyWorkDraft(), providerId: 'provider', modelId: 'model', text: 'Build a keyboard accessible view' };
  assert.equal(canSendWork({ ready: true, pending: false, draft }), true);
  assert.equal(canSendWork({ ready: false, pending: false, draft }), false);
  assert.equal(canSendWork({ ready: true, pending: true, draft }), false);
  assert.equal(canSendWork({ ready: true, pending: false, draft: { ...draft, providerId: '' } }), false);
  assert.equal(canSendWork({ ready: true, pending: false, draft: { ...draft, modelId: '' } }), false);
  assert.equal(canSendWork({ ready: true, pending: false, draft: { ...draft, text: ' \n ' } }), false);
  assert.equal(canSendWork({ ready: true, pending: false, draft: { ...draft, text: '', attachments: [{ id: 'image', name: 'reference.png', mime: 'image/png', url: 'data:image/png;base64,AA==' }] } }), true);
});

test('attachments enforce limits and reject executable/unknown formats before reading', () => {
  assert.equal(workAttachmentError(0, [{ size: 100, type: 'image/png' }]), null);
  assert.equal(workAttachmentError(4, [{ size: 100, type: 'application/pdf' }]), null);
  assert.match(workAttachmentError(5, [{ size: 100, type: 'text/plain' }]), /five/);
  assert.match(workAttachmentError(0, [{ size: 10 * 1024 * 1024 + 1, type: 'image/png' }]), /10 MiB/);
  assert.match(workAttachmentError(0, [{ size: 100, type: 'text/html' }]), /Choose/);
  assert.match(workAttachmentError(0, [{ size: 100, type: '' }]), /Choose/);
});

test('existing native session model and effort survive different installation defaults', () => {
  const defaults = { providerId: 'new-provider', modelId: 'new-model', variant: 'medium' };
  const existing = initialWorkDraft('session-a', { providerID: 'original-provider', id: 'original-model', variant: 'high' }, defaults);
  assert.equal(existing.providerId, 'original-provider');
  assert.equal(existing.modelId, 'original-model');
  assert.equal(existing.variant, 'high');
  const fresh = initialWorkDraft(null, undefined, defaults);
  assert.equal(fresh.providerId, 'new-provider');
  assert.equal(fresh.modelId, 'new-model');
  assert.equal(fresh.variant, 'medium');
  const unknown = initialWorkDraft('session-without-metadata', undefined, defaults);
  assert.equal(unknown.providerId, '');
  assert.equal(unknown.modelId, '');
  assert.equal(unknown.variant, '');
});
