import { readFile } from 'node:fs/promises';
import { evaluateRelease } from './qualification.mjs';

try {
  if (process.argv.length !== 3) throw new Error('Usage: node qualify.mjs CANDIDATE_EVIDENCE_JSON');
  const report = evaluateRelease(JSON.parse(await readFile(process.argv[2], 'utf8')));
  console.log(JSON.stringify(report, null, 2));
  if (report.status !== 'qualified') process.exitCode = 2;
} catch (error) { console.error(error.message); process.exitCode = 1; }
