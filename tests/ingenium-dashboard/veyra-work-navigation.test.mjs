import test from 'node:test';
import assert from 'node:assert/strict';
import { parseWorkRouteParams, workConversationNavigation, workLocationMatches } from '../../services/ingenium-dashboard/src/app/components/veyra-work/work-navigation.ts';

const selected = { search: 'session=ses-a&runtime=runtime-a&project=project-a&settings=general', hash: '#file-reference', sessionId: 'ses-b', runtimeId: 'runtime-a', project: 'project-a', intent: 'select' };
test('route parsing preserves exact identity and rejects repeated or empty explicit fields instead of opening a new conversation', () => {
  assert.deepEqual(parseWorkRouteParams({ session: 'ses-a', runtime: 'runtime-a', project: 'project-a', settings: 'general' }), {
    initialSessionId: 'ses-a', requestedRuntime: 'runtime-a', requestedProject: 'project-a', routeError: null,
  });
  assert.deepEqual(parseWorkRouteParams({}), { initialSessionId: null, requestedRuntime: null, requestedProject: null, routeError: null });
  for (const key of ['session', 'runtime', 'project']) {
    for (const value of ['', ['one', 'two'], ['same', 'same']]) {
      const parsed = parseWorkRouteParams({ session: 'ses-a', runtime: 'runtime-a', project: 'project-a', [key]: value });
      assert.ok(parsed.routeError.includes(key));
      assert.equal(parsed.initialSessionId, null);
    }
  }
});
test('explicit conversation changes retain unrelated query, fragment and normal history', () => {
  assert.deepEqual(workConversationNavigation(selected), { action: 'push', href: '/work?session=ses-b&runtime=runtime-a&project=project-a&settings=general#file-reference' });
  const first = workConversationNavigation({ ...selected, search: 'settings=general' });
  assert.equal(first.action, 'push');
  assert.equal(new URL(first.href, 'https://dashboard.invalid').searchParams.get('session'), 'ses-b');
});
test('same-session selection is inert and missing explicit binding is canonicalized without another history entry', () => {
  assert.equal(workConversationNavigation({ ...selected, sessionId: 'ses-a' }).action, 'none');
  const fixed = workConversationNavigation({ ...selected, search: 'session=ses-b&settings=general', intent: 'canonicalize' });
  assert.equal(fixed.action, 'replace');
  assert.equal(fixed.href, '/work?session=ses-b&settings=general&runtime=runtime-a&project=project-a#file-reference');
});
test('a newer Back/Forward URL is never repaired into the stale rendered session', () => {
  assert.deepEqual(workConversationNavigation({ ...selected, intent: 'canonicalize', sessionId: 'ses-old' }), {
    action: 'none', href: `/work?${selected.search}#file-reference`,
  });
  assert.deepEqual(workConversationNavigation({ ...selected, intent: 'canonicalize', search: '' }), { action: 'none', href: '/work#file-reference' });
});
test('URL construction encodes identity data and rejects missing binding or malformed fragments', () => {
  const special = workConversationNavigation({ ...selected, sessionId: 'ses/original', project: 'A & B' });
  assert.equal(new URL(special.href, 'https://dashboard.invalid').searchParams.get('session'), 'ses/original');
  assert.equal(new URL(special.href, 'https://dashboard.invalid').searchParams.get('project'), 'A & B');
  assert.throws(() => workConversationNavigation({ ...selected, sessionId: '' }));
  assert.throws(() => workConversationNavigation({ ...selected, runtimeId: '' }));
  assert.throws(() => workConversationNavigation({ ...selected, hash: '/another-route' }));
});

test('delayed creation accepts unrelated query changes but cannot redirect a newer session or workspace selection', () => {
  const original = { sessionId: null, runtimeId: 'runtime-a', project: 'project-a' };
  assert.equal(workLocationMatches('settings=general&panel=files', original), true);
  assert.equal(workLocationMatches('runtime=runtime-a&project=project-a&settings=providers', original), true);
  for (const search of ['session=ses-other', 'runtime=runtime-other', 'project=project-other', 'session=', 'runtime=runtime-a&runtime=runtime-other']) {
    assert.equal(workLocationMatches(search, original), false, search);
  }
});
