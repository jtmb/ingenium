import { readFile } from 'node:fs/promises';
import { evaluateRelease } from './qualification.mjs';
import { verifyEvidenceFiles } from './verify-evidence.mjs';

try {
  if (process.argv.length !== 4) throw new Error('Usage: node qualify.mjs CANDIDATE_EVIDENCE_JSON CANONICAL_EVIDENCE_ROOT');
  const input = JSON.parse(await readFile(process.argv[2], 'utf8'));
  const evidence = await verifyEvidenceFiles(process.argv[3], input.evidence);
  const report = evaluateRelease({ ...input, evidence });
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'qualified') process.exitCode = 2;
} catch (error) { console.error(error.message); process.exitCode = 1; }
