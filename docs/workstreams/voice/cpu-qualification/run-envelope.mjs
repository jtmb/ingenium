/** Root-only future execution. Importing this file starts nothing. */
import { runRetainedKernelOwner } from './retained-kernel-owner.mjs';
import { createHash } from 'node:crypto';
import { readFileSync, openSync, closeSync, readSync, fstatSync, lstatSync, realpathSync, mkdirSync, writeFileSync, chmodSync, chownSync, constants } from 'node:fs';
import { resolve, dirname, relative, isAbsolute } from 'node:path';
import { requireStorageHeadroom } from './storage-budget.mjs';
const fail = code => { throw Object.assign(new Error(code), { code }); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const uuid = value => /^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/.test(value ?? '') && value !== '00000000-0000-0000-0000-000000000000';
function custody(path, uid, privateFile = false) {
  if (!isAbsolute(path)) fail('QUAL_PATH');
  const facts = lstatSync(path);
  if (!facts.isFile() || facts.isSymbolicLink() || facts.nlink !== 1 || facts.uid !== uid || facts.mode & (privateFile ? 0o077 : 0o022)) fail('QUAL_CUSTODY');
  return facts;
}
function digestFile(path, expected, maximum) {
  const fd = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_CLOEXEC);
  try {
    const before = fstatSync(fd); if (!before.isFile() || before.size > maximum) fail('QUAL_FILE_BOUND');
    const digest = createHash('sha256'), buffer = Buffer.alloc(65536); let count = 0;
    for (;;) { const n = readSync(fd, buffer, 0, buffer.length, null); if (!n) break; count += n; if (count > maximum) fail('QUAL_FILE_BOUND'); digest.update(buffer.subarray(0, n)); }
    const after = fstatSync(fd); if (before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || count !== before.size) fail('QUAL_FILE_CHANGED');
    const sha256 = digest.digest('hex'); if (sha256 !== expected) fail('QUAL_FILE_HASH'); return { path, sha256, bytes: count, device: String(before.dev), inode: String(before.ino) };
  } finally { closeSync(fd); }
}
export async function runEnvelope(grantPath) {
  if (process.platform !== 'linux' || process.getuid?.() !== 0) fail('QUAL_ROOT_LINUX_REQUIRED');
  const grantFacts = custody(grantPath, 0, true); if (grantFacts.size > 65536) fail('QUAL_GRANT_BOUND');
  const rawGrant = readFileSync(grantPath), grant = JSON.parse(rawGrant);
  if (grant.kind !== 'root-qualification-envelope-v1' || grant.productionApproval !== false || grant.templateOnly === true || !uuid(grant.runId)
    || !['inert-kernel', 'install', 'abi', 'model-cold-hot', 'helper', 'witness', 'probe', 'production-wire'].includes(grant.case)
    || !Number.isSafeInteger(grant.expiresAt) || grant.expiresAt <= Date.now()) fail('QUAL_OPERATOR_GRANT_REQUIRED');
  const limits = grant.hardLimits;
  if (!limits || !['memoryBytes', 'pids', 'quotaUsec', 'periodUsec', 'timeoutMs'].every(k => Number.isSafeInteger(limits[k]) && limits[k] > 0)
    || limits.memoryBytes < 268435456 || limits.timeoutMs > 1800000 || !Number.isSafeInteger(grant.hostReserveBytes) || grant.hostReserveBytes < 1
    || !Number.isSafeInteger(grant.uid) || grant.uid <= 0 || !Number.isSafeInteger(grant.gid) || grant.gid <= 0) fail('QUAL_HARD_LIMITS_REQUIRED');
  const root = resolve(grant.qualificationRoot), run = resolve(root, grant.runId);
  if (!grant.registeredOwnershipPath || !grant.rootStoragePreflightPath || relative(root, run) !== grant.runId) fail('QUAL_REGISTERED_STORAGE_REQUIRED');
  const ownershipRaw = readFileSync(grant.registeredOwnershipPath), ownership = JSON.parse(ownershipRaw);
  if (hash(ownershipRaw) !== grant.registeredOwnershipSha256 || ownership.ceilingBytes !== 20 * 1024 ** 3
    || root !== resolve(ownership.root, 'real-gmail-ui/veyra-phase-1/coordination/voice/cpu-qualification')
    || realpathSync(root) !== root || realpathSync(ownership.root) !== resolve(ownership.root)
    || lstatSync(root).dev !== lstatSync(ownership.root).dev) fail('QUAL_EXISTING_PHYSICAL_ROOT_REQUIRED');
  function storageGate() {
    const facts = custody(grant.rootStoragePreflightPath, 0); if (facts.size < 1 || facts.size > 65536) fail('QUAL_STORAGE_FACT_BOUND');
    const raw = readFileSync(grant.rootStoragePreflightPath), fact = JSON.parse(raw);
    if (hash(raw) !== grant.rootStoragePreflightSha256 || fact.kind !== 'root-paired-storage-preflight-v1'
      || !Number.isSafeInteger(fact.observedAt) || Date.now() - fact.observedAt > 60000 || fact.observedAt > Date.now()
      || fact.nativeBuildLeaseActive !== false) fail('QUAL_FRESH_ACTUAL_STORAGE_PREFLIGHT_REQUIRED');
    requireStorageHeadroom(fact);
  }
  storageGate();
  if (!Array.isArray(grant.command) || grant.command.length < 1 || !grant.command.every(s => typeof s === 'string' && !s.includes('\0')) || !isAbsolute(grant.command[0])) fail('QUAL_FIXED_COMMAND_REQUIRED');
  if (!Array.isArray(grant.readonlyInputs) || !grant.readonlyInputs.length) fail('QUAL_EXACT_INPUTS_REQUIRED');
  if (!Array.isArray(grant.readonlyMounts) || !grant.readonlyMounts.length || grant.readonlyMounts.length > 16
    || grant.readonlyMounts.some(path => !isAbsolute(path) || path === '/' || path.includes('\n') || !lstatSync(path).isDirectory() || lstatSync(path).isSymbolicLink())) fail('QUAL_READONLY_INPUT_VIEW_REQUIRED');
  const inputFacts = grant.readonlyInputs.map(input => { custody(input.path, input.ownerUid); return digestFile(input.path, input.sha256, input.maxBytes); });
  const executable = inputFacts.find(input => input.path === grant.command[0]);
  if (!executable || !inputFacts.some(input => input.path === grant.kernelOwner)) fail('QUAL_EXECUTABLE_NOT_BOUND');
  storageGate(); // Hashing inputs never extends an old capacity observation.
  mkdirSync(run, { mode: 0o750 }); chownSync(run, 0, grant.gid);
  const scratch = resolve(run, 'tmp'); mkdirSync(scratch, { mode: 0o700 }); chownSync(scratch, grant.uid, grant.gid);
  const args = [grant.runId, String(limits.memoryBytes), String(limits.pids), String(limits.quotaUsec), String(limits.periodUsec), String(limits.timeoutMs), String(grant.uid), String(grant.gid), scratch, '--', ...grant.command];
  const ownerInput = grant.readonlyInputs.find(input => input.path === grant.kernelOwner);
  // Verify and retain the exact root-owned ELF descriptor through all original
  // Child exit/close/pipe joins. A mutable ancestor cannot redirect this exec.
  const ownerRun = await runRetainedKernelOwner({ ...ownerInput,
    originalFact: inputFacts.find(input => input.path === grant.kernelOwner) }, args,
    { cwd: run, env: { PATH: '/usr/bin:/bin', TMPDIR: scratch, TMP: scratch, TEMP: scratch,
      VEYRA_QUAL_HOST_RESERVE_BYTES: String(grant.hostReserveBytes), VEYRA_QUAL_READONLY_PATHS: grant.readonlyMounts.join('\n') } });
  const { joined, exitValue, buffers } = ownerRun; let { firstError } = ownerRun;
  try {
    for (let i = 0; i < grant.readonlyInputs.length; i++) {
      const input = grant.readonlyInputs[i], after = digestFile(input.path, input.sha256, input.maxBytes);
      if (after.device !== inputFacts[i].device || after.inode !== inputFacts[i].inode) fail('QUAL_ORIGINAL_INPUT_REPLACED');
    }
  } catch (error) { firstError ??= error; }
  for (const name of ['stdout', 'stderr']) { const path = resolve(run, name + '.log'); writeFileSync(path, Buffer.concat(buffers[name]), { flag: 'wx', mode: 0o440 }); chownSync(path, 0, grant.gid); }
  const stderr = Buffer.concat(buffers.stderr).toString('utf8');
  const owners = stderr.split('\n').filter(line => line.startsWith('{"qualificationKernelOwner":1,')).map(line => JSON.parse(line));
  const kernelOwner = owners.length === 1 ? owners[0] : null;
  const successful = !firstError && joined.every(p => p.status === 'fulfilled') && exitValue?.code === 0 && !exitValue.signal
    && kernelOwner?.runId === grant.runId && kernelOwner.waited === true && kernelOwner.populated === false
    && kernelOwner.stdoutEOF === true && kernelOwner.stderrEOF === true && kernelOwner.leafRemoved === true && kernelOwner.deadlineKilled === false;
  const receipt = { version: 1, successful, case: grant.case, runId: grant.runId, grantSha256: hash(rawGrant),
    bindings: grant.bindings, hardLimits: limits, inputFacts, command: grant.command, kernelOwner, exit: exitValue ?? null,
    ownerExitJoined: joined[0].status === 'fulfilled', ownerCloseJoined: joined[1].status === 'fulfilled',
    stdoutJoined: joined[2].status === 'fulfilled', stderrJoined: joined[3].status === 'fulfilled',
    stdoutSha256: hash(Buffer.concat(buffers.stdout)), stderrSha256: hash(Buffer.concat(buffers.stderr)),
    productionApproval: false, failure: firstError?.code ?? (firstError ? 'QUAL_OWNER_FAILURE' : null) };
  const path = resolve(run, 'receipt.json'); writeFileSync(path, JSON.stringify(receipt, null, 2) + '\n', { flag: 'wx', mode: 0o440 }); chownSync(path, 0, grant.gid); chmodSync(path, 0o440);
  if (!successful) fail('QUALIFICATION_FAILED_RETAIN_EVIDENCE'); return { run, receipt };
}
