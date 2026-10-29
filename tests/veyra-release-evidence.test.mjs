import assert from 'node:assert/strict';
import test from 'node:test';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { digest } from '../tools/veyra-release/source-manifest.mjs';
import { evaluateRelease } from '../tools/veyra-release/qualification.mjs';
import { verifyReceiptBytes, verifyEvidenceFiles } from '../tools/veyra-release/verify-evidence.mjs';

const fixtureUrl = new URL('./veyra-release-fixtures/receipt.json', import.meta.url);
const root = fileURLToPath(new URL('../', import.meta.url));
const fixture = await readFile(fixtureUrl);
const receipt = JSON.parse(fixture);
const descriptor = { ...receipt, receiptSha256: digest(fixture), receiptPath: 'tests/veyra-release-fixtures/receipt.json' };

function encoded(delta) {
  const bytes = Buffer.from(JSON.stringify({ ...receipt, ...delta }));
  return { bytes, descriptor: { ...descriptor, ...delta, receiptSha256: digest(bytes) } };
}

test('receipt bytes bind candidate, gate, kind, status and explicit fixture classification', () => {
  const actual = verifyReceiptBytes(descriptor, fixture);
  assert.equal(actual.gate, 'source-provenance');
  assert.equal(actual.fixture, true);
  assert.equal(actual.receiptSha256, descriptor.receiptSha256);
  assert.ok(!Object.hasOwn(actual, 'receiptPath'));
});

test('absent receipts, fabricated hashes, altered bytes and invalid JSON refuse', () => {
  assert.throws(() => verifyReceiptBytes(descriptor, Buffer.concat([fixture, Buffer.from(' ')])), /hash/);
  assert.throws(() => verifyReceiptBytes({ ...descriptor, receiptSha256: '0'.repeat(64) }, fixture), /hash/);
  const bytes = Buffer.from('not json');
  assert.throws(() => verifyReceiptBytes({ ...descriptor, receiptSha256: digest(bytes) }, bytes), /JSON/);
  assert.throws(() => verifyReceiptBytes(descriptor, Buffer.alloc(4 * 1024 * 1024 + 1)), /bound/);
});

test('descriptor cannot upgrade failures, alter candidate, hide fixture status or change evidence class', () => {
  for (const delta of [{ status: 'fail' }, { fixture: false }, { kind: 'runtime' }, { gate: 'windows-lifecycle' },
    { subject: { ...receipt.subject, artifactSha256: 'e'.repeat(64) } }]) {
    assert.throws(() => verifyReceiptBytes({ ...descriptor, ...delta }, fixture), /contradicts/);
  }
});

test('receipt schema requires an explicit fixture decision and known result', () => {
  for (const delta of [{ fixture: undefined }, { schemaVersion: 2 }, { status: 'green' }, { subject: {} }]) {
    const input = encoded(delta);
    assert.throws(() => verifyReceiptBytes(input.descriptor, input.bytes), /Invalid/);
  }
});

test('filesystem evidence reader verifies the real fixture without creating scratch', async () => {
  const actual = await verifyEvidenceFiles(root, [descriptor]);
  assert.equal(actual.length, 1); assert.equal(actual[0].fixture, true);
  const report = evaluateRelease({ candidate: receipt.subject, evidence: actual, acceptance: {
    featureDispositions: 74, views: 47, settings: 20, windowsRows: 11,
    originalContractSha256: 'a'.repeat(64), retainedContractSha256: 'a'.repeat(64),
  } });
  assert.equal(report.status, 'incomplete');
  assert.equal(report.gates.find(row => row.gate === 'source-provenance').status, 'incomplete');
});

test('filesystem evidence reader refuses escaping, missing and malformed inputs', async () => {
  for (const receiptPath of ['../receipt.json', '/receipt.json', 'C:/receipt.json', 'missing-receipt.json']) {
    await assert.rejects(verifyEvidenceFiles(root, [{ ...descriptor, receiptPath }]));
  }
  await assert.rejects(verifyEvidenceFiles('relative', [descriptor]), /absolute/);
  await assert.rejects(verifyEvidenceFiles(root, [{ ...descriptor, receiptPath: 'tools/veyra-release/qualify.mjs', receiptSha256: '0'.repeat(64) }]), /hash/);
});

test('invalid UTF-8 cannot be accepted after replacement-character decoding', () => {
  const bytes = Buffer.concat([Buffer.from('{"details":"'), Buffer.from([255]), Buffer.from('"}')]);
  assert.throws(() => verifyReceiptBytes({ ...descriptor, receiptSha256: digest(bytes) }, bytes), /UTF-8/);
});

test('CLI reads real receipt files and leaves fixture-only release incomplete', async () => {
  const { spawnSync } = await import('node:child_process');
  const cli = fileURLToPath(new URL('../tools/veyra-release/qualify.mjs', import.meta.url));
  const input = fileURLToPath(new URL('./veyra-release-fixtures/candidate.json', import.meta.url));
  const result = spawnSync(process.execPath, [cli, input, root], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.equal(result.status, 2, result.stderr);
  const report = JSON.parse(result.stdout);
  assert.equal(report.status, 'incomplete');
  assert.equal(report.gates.find(row => row.gate === 'source-provenance').reason, 'evidence does not qualify this gate');
  const missing = spawnSync(process.execPath, [cli, input], { encoding: 'utf8', maxBuffer: 1024 * 1024 });
  assert.equal(missing.status, 1); assert.ok(missing.stderr.includes('CANONICAL_EVIDENCE_ROOT'));
});
