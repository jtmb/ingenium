import { createHash } from 'node:crypto';
import { unifiedPatch } from './linux-recipe-patch.mjs';
export const GATE_PREIMAGE = '80fca15c1d42a88a98197e1405133ba56537c92f36f359dbe1a226ca096d38bc';
export const NATIVE_PREIMAGE_TREE = 'a04ab38bd0e0c7b96f40689733cad3f2332b9a0b';
export function proposeNativeCheckGate(bytes) {
  if (!Buffer.isBuffer(bytes) || createHash('sha256').update(bytes).digest('hex') !== GATE_PREIMAGE) throw new Error('Exact a04 gate preimage required');
  const before = bytes.toString('utf8');
  const start = before.indexOf('if (rust) {\n'), end = before.indexOf('\n// This gate checks shipped Source.', start);
  if (start < 0 || end < 0 || before.slice(start, end).at(-1) !== '}') throw new Error('Original Rust gate boundary changed');
  const original = before.slice(start + 'if (rust) {\n'.length, end - 1);
  const replacement = 'if (rust) {\n'
    + "  if (mode === '--staged' && !ci && process.platform === 'win32' && await hasReviewedCargoCheck(environment)) {\n"
    + "    run(process.execPath, ['tools/check-boundaries.mjs']);\n"
    + '    await runReviewedCargoCheck(root, environment, tree, policy);\n'
    + '  } else {\n' + original + '  }\n}';
  let after = before.slice(0, start) + replacement + before.slice(end);
  after = after.replace("import { environment, root } from './process.mjs';", () => "import { environment, root } from './process.mjs';\nimport { hasReviewedCargoCheck, runReviewedCargoCheck } from './reviewed-cargo-check.mjs';");
  if (!after.includes(original)) throw new Error('Generic 4 GiB branch changed');
  return { after, patch: unifiedPatch(before, after, 'tools/feature-gate.mjs'), originalBranch: original };
}
