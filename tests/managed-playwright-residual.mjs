import { readdirSync, readFileSync, existsSync } from 'node:fs';
import assert from 'node:assert/strict';

const root = '/home/ingenium-opencode/.ingenium/playwright-runtime';
const records = existsSync(root) ? readdirSync(root).map(name => {
  const directory = `${root}/${name}`;
  const record = JSON.parse(readFileSync(`${directory}/ownership.json`, 'utf8'));
  return { directory, ownerPid: record.ownerPid, project: record.project,
    cleanedAt: record.cleanedAt ?? null, outputExists: existsSync(`${directory}/output`),
    failedCleanup: existsSync(`${directory}/failed-cleanup.json`) };
}) : [];
const children = readdirSync('/proc').filter(name => /^\d+$/.test(name)).flatMap(pid => {
  try {
    const args = readFileSync(`/proc/${pid}/cmdline`, 'utf8').split('\0');
    return args.some(arg => arg.startsWith('--output-dir=') && arg.includes('/playwright-runtime/'))
      ? [{ pid: Number(pid), executable: args[0] }] : [];
  } catch { return []; }
});
console.log(JSON.stringify({ stage: 'MANAGED_PLAYWRIGHT_RESIDUAL', root, records, children }));
assert.ok(records.every(record => record.cleanedAt && !record.outputExists && !record.failedCleanup), 'OUTPUT_OR_OWNERSHIP_RESIDUAL');
assert.equal(children.length, 0, 'MANAGED_CHILD_RESIDUAL');
