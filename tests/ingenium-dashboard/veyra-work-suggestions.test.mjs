import test from 'node:test';
import assert from 'node:assert/strict';
import { workSuggestions } from '../../services/ingenium-dashboard/src/app/components/veyra-work/work-suggestions.ts';

test('new-workspace suggestions contain draft prompts, with no inferred files or changes', () => {
  const suggestions = workSuggestions({ hasSession: false, hasFiles: false, hasChanges: false, hasError: false });
  assert.deepEqual(suggestions.map((item) => item.id), ['explore', 'plan']);
  assert.ok(suggestions.every((item) => item.prompt.length > 0 && item.reason === 'No conversation is selected.'));
});

test('suggestions use only observed file/change/error state and prioritize current failure', () => {
  assert.deepEqual(workSuggestions({ hasSession: true, hasFiles: false, hasChanges: false, hasError: false }).map((item) => item.id), ['continue']);
  assert.deepEqual(workSuggestions({ hasSession: true, hasFiles: true, hasChanges: true, hasError: false }).map((item) => item.id), ['review', 'files', 'continue']);
  const failed = workSuggestions({ hasSession: true, hasFiles: true, hasChanges: true, hasError: true });
  assert.deepEqual(failed.map((item) => item.id), ['diagnose']);
  assert.match(failed[0].prompt, /Preserve the first failure/);
});
