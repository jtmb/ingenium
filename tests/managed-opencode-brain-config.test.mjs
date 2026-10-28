import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { Config } from '@opencode/schema/config';
import { Schema } from 'effect';

test('managed and image fallback configuration use the pinned OpenCode schema', () => {
  const root = new URL('../', import.meta.url);
  const managed = JSON.parse(readFileSync(new URL('config/opencode-managed/opencode.json', root), 'utf8'));
  const dockerfile = readFileSync(new URL('Dockerfile', root), 'utf8');
  const match = dockerfile.match(/RUN echo '([^'\n]+)' > \/app\/config\/opencode\.container\.json/);
  assert.ok(match, 'Image fallback configuration must be available for schema validation');
  const fallback = JSON.parse(match[1]);
  for (const configuration of [managed, fallback]) {
    Schema.decodeUnknownSync(Config.Info)(configuration);
    assert.ok(configuration.skills.includes('/usr/local/share/veyra/computer-use/.opencode/skills'));
    assert.equal(configuration.plugins.filter(plugin => typeof plugin === 'string' && plugin.endsWith('/goal')).length, 1);
  }
  assert.throws(() => Schema.decodeUnknownSync(Config.Info)({ skills: { paths: ['/external/skills'] } }));
});
