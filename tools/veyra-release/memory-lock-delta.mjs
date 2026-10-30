import { createHash } from 'node:crypto';
export const lockSha256 = bytes => createHash('sha256').update(bytes).digest('hex');
/** Exact textual allowed graph delta, not a Cargo resolver and never a writer. */
export function projectMemoryLock(beforeBytes) {
  const before = Buffer.isBuffer(beforeBytes) ? beforeBytes.toString('utf8') : beforeBytes;
  if (typeof before !== 'string' || before.includes('\r') || !/^version = 4$/m.test(before)) throw new Error('Reviewed LF Cargo lock v4 required');
  const pieces = before.split('[[package]]\n');
  if (pieces.length < 2) throw new Error('Package records required');
  const prefix = pieces.shift(), records = pieces.map(raw => {
    const name = /^name = "([a-zA-Z0-9_-]+)"\n/.exec(raw)?.[1];
    const version = /^version = "([^"\n]+)"$/m.exec(raw)?.[1];
    if (!name || !version) throw new Error('Unsupported package record');
    return { name, version, raw };
  });
  const unique = name => { const found = records.filter(row => row.name === name); if (found.length !== 1) throw new Error(`Missing/ambiguous ${name}`); return found[0]; };
  for (const [name, version] of Object.entries({ serde: '1.0.229', serde_json: '1.0.151', sha2: '0.10.9' })) {
    const row = unique(name); if (row.version !== version || !/^source = "registry\+/m.test(row.raw)) throw new Error('Reviewed registry resolution changed');
  }
  if (records.some(row => row.name === 'veyra-memory')) throw new Error('Memory package already present; reviewed baseline required');
  for (const consumer of ['veyra-adapters', 'veyra-service']) {
    const row = unique(consumer);
    if (row.version !== '0.3.0-preview.1' || /^source =|^checksum =/m.test(row.raw)) throw new Error('Consumer package identity changed');
    const match = /^dependencies = \[\n((?: "[^"\n]+",\n)*)\]/m.exec(row.raw);
    if (!match) throw new Error('Canonical consumer dependency array required');
    const dependencies = [...match[1].matchAll(/^ "([^"\n]+)",$/gm)].map(value => value[1]);
    if (dependencies.includes('veyra-memory')) throw new Error('Unexpected existing Memory edge');
    dependencies.push('veyra-memory'); dependencies.sort();
    row.raw = row.raw.replace(match[0], () => 'dependencies = [\n' + dependencies.map(name => ` "${name}",\n`).join('') + ']');
  }
  const memory = { name: 'veyra-memory', version: '0.1.0', raw: 'name = "veyra-memory"\nversion = "0.1.0"\ndependencies = [\n "serde",\n "serde_json",\n "sha2",\n]\n\n' };
  const index = records.findIndex(row => row.name > memory.name);
  if (index < 0) records.push(memory); else records.splice(index, 0, memory);
  return Buffer.from(prefix + records.map(row => '[[package]]\n' + row.raw).join(''));
}
export function verifyMemoryLockDelta(before, actual) {
  const expected = projectMemoryLock(before), observed = Buffer.isBuffer(actual) ? actual : Buffer.from(actual);
  if (!expected.equals(observed)) throw new Error('Lock delta exceeds the one Memory workspace package and two consumer edges; resolve/review independently');
  return { expectedSha256: lockSha256(expected), actualSha256: lockSha256(observed), registryRecordsUnchanged: true };
}
