import test from 'node:test';
import assert from 'node:assert/strict';
import { workControlBindingMatches } from '../../services/ingenium-dashboard/src/app/components/veyra-work/work-context.ts';

const binding = { ownerId: 'owner-a', organizationId: 'org-a', runtimeId: 'runtime-a', workspaceId: 'workspace-a', sessionId: 'ses-a' };
test('context controls match every explicit actor/runtime/workspace/session field', () => {
  assert.equal(workControlBindingMatches(binding, { ...binding }), true);
  for (const field of Object.keys(binding)) {
    assert.equal(workControlBindingMatches(binding, { ...binding, [field]: `${binding[field]}-other` }), false, field);
  }
});
test('compatibility and new-session controls do not alias isolated or selected-session controls', () => {
  assert.equal(workControlBindingMatches({ ...binding, runtimeId: null, sessionId: null }, { ...binding, runtimeId: null, sessionId: null }), true);
  assert.equal(workControlBindingMatches({ ...binding, runtimeId: null }, binding), false);
  assert.equal(workControlBindingMatches({ ...binding, sessionId: null }, binding), false);
});
