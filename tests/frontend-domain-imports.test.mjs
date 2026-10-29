import test from 'node:test';
import assert from 'node:assert/strict';
import { rewriteFrontendDomainImports } from './frontend-domain-imports.mjs';

test('fixture resolves shared browser code and types without rewriting source data or local modules', () => {
  const root = '/owned/repository';
  const source = root + '/services/ingenium-dashboard/src/app/components/voice-v2/client.tsx';
  const original = `import { value } from '../../../../../../packages/veyra-voice/audio.mjs';
import type { DotScope } from '../../../../../../packages/veyra-automation/contracts.js';
export { local } from './local';
const untouched = '../../../../../../packages/veyra-voice/audio.mjs';`;
  const emitted = rewriteFrontendDomainImports(original, source, root);
  assert.ok(emitted.includes('from "/owned/repository/packages/veyra-voice/audio.mjs"'));
  assert.ok(emitted.includes('from "/owned/repository/packages/veyra-automation/contracts.js"'));
  assert.ok(emitted.includes("from './local'"));
  assert.ok(emitted.includes("const untouched = '../../../../../../packages/veyra-voice/audio.mjs'"));
});

test('fixture leaves imports outside the explicit domain source allowlist unchanged', () => {
  const source = '/owned/repository/services/ingenium-dashboard/src/app/components/test.ts';
  const input = "import value from '../../../../../packages/unreviewed/value.mjs';";
  assert.equal(rewriteFrontendDomainImports(input, source, '/owned/repository'), input);
});