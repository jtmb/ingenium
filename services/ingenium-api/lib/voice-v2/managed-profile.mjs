import { createHash } from 'node:crypto';
import { constants, closeSync, fstatSync, lstatSync, openSync, readFileSync, readSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, sep } from 'node:path';
import { CpuOwnershipError } from './cpu-ownership.mjs';

const fail = code => { throw new CpuOwnershipError(code); };
const digest = bytes => createHash('sha256').update(bytes).digest('hex');
const codeFiles = Object.freeze(['managed_bootstrap.py', 'managed_entry.py', 'managed_pipe.py', 'managed_linux_tree.py', 'managed_api_tree.py',
  'managed_recovery_witness.py', 'cpu_ownership.py', 'veyra_worker.py', 'cpu_models.py', 'inference_control.py', 'requirements-cpu.lock']);
const canonical = value => value && typeof value === 'object' ? Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const stripEntry = text => text.split('\nif __name__ == "__main__":')[0].replace(/^from __future__ import annotations\r?\n/gm, '');
const freeze = value => { if (value && typeof value === 'object') { for (const child of Object.values(value)) freeze(child); Object.freeze(value); } return value; };

function ancestors(path, privateLeafDirectory) {
  if (!isAbsolute(path) || path.split(sep).some(value => value === '..' || value === '.')) fail('CPU_PROFILE_PATH_INVALID');
  let current = parse(path).root;
  const parts = path.slice(current.length).split(sep).filter(Boolean);
  for (const part of parts) {
    current = join(current, part); const facts = lstatSync(current);
    if (!facts.isDirectory() || facts.isSymbolicLink() || ![0, process.getuid()].includes(facts.uid) || (facts.mode & 0o022)) fail('CPU_PROFILE_DIRECTORY_CUSTODY');
  }
  if (privateLeafDirectory) { const facts = lstatSync(current); if (facts.uid !== process.getuid() || facts.mode & 0o077) fail('CPU_PROFILE_DIRECTORY_CUSTODY'); }
}
function protectedBytes(path, limit) {
  ancestors(dirname(path), true);
  const descriptor = openSync(path, constants.O_RDONLY | constants.O_NOFOLLOW | constants.O_CLOEXEC);
  try {
    const before = fstatSync(descriptor);
    if (!before.isFile() || before.uid !== process.getuid() || before.mode & 0o077 || before.nlink !== 1 || before.size < 1 || before.size > limit) fail('CPU_PROFILE_FILE_CUSTODY');
    const buffer = Buffer.alloc(limit + 1); let count = 0;
    while (count < buffer.length) { const next = readSync(descriptor, buffer, count, buffer.length - count, null); if (!next) break; count += next; }
    const after = fstatSync(descriptor);
    if (count !== before.size || count > limit || before.dev !== after.dev || before.ino !== after.ino || before.size !== after.size || before.mtimeMs !== after.mtimeMs || before.ctimeMs !== after.ctimeMs) fail('CPU_PROFILE_FILE_CHANGED');
    return buffer.subarray(0, count);
  } finally { closeSync(descriptor); }
}

/** Fixed server profile; no renderer URL/token/path, package download or fallback.
 * Loading verifies source/config only. It starts no child, models or devices.
 * Root owns interpreter/environment/model packaging and the actual resource lease.
 */
export class ManagedCpuProfile {
  static load(path) {
    if (process.platform !== 'linux' || typeof process.getuid !== 'function') fail('CPU_LINUX_PROFILE_REQUIRED');
    const value = JSON.parse(protectedBytes(path, 65536).toString('utf8'));
    return new ManagedCpuProfile(value);
  }
  constructor(value) {
    const fields = ['version', 'enableInference', 'python', 'pythonSha256', 'workerRoot', 'bundle', 'pythonPaths', 'settings', 'memoryBytes', 'defaultVoice', 'recoveryTransport'];
    if (!value || Object.keys(value).sort().join() !== fields.sort().join() || value.version !== 1 || value.enableInference !== true
      || !Number.isSafeInteger(value.memoryBytes) || value.memoryBytes < 268435456 || !/^[A-Za-z0-9_]{1,64}$/.test(value.defaultVoice ?? '')
      || value.recoveryTransport !== 'abstract-unix' || !Array.isArray(value.pythonPaths) || !value.pythonPaths.length || value.pythonPaths.length > 32 || !value.bundle
      || Object.keys(value.bundle).sort().join() !== [...codeFiles].sort().join()) fail('CPU_PROFILE_INVALID');
    const settings = value.settings;
    const settingsFields = ['version', 'backend', 'instance_id', 'host', 'port', 'private_network', 'model_root', 'model_manifest', 'token_file', 'scratch_root', 'cpu_threads'];
    if (!settings || Object.keys(settings).sort().join() !== settingsFields.sort().join() || settings.version !== 1 || settings.backend !== 'cpu-onnx' || settings.host !== '127.0.0.1' || settings.private_network !== false
      || !Number.isInteger(settings.port) || settings.port < 1024 || settings.port > 65535
      || !Number.isInteger(settings.cpu_threads) || settings.cpu_threads < 1 || settings.cpu_threads > 64
      || !/^[A-Za-z0-9:_-]{1,160}$/.test(settings.instance_id ?? '')) fail('CPU_PROFILE_INVALID');
    for (const path of [value.python, value.workerRoot, ...value.pythonPaths, settings.model_root, settings.token_file, settings.scratch_root]) {
      if (typeof path !== 'string' || !isAbsolute(path)) fail('CPU_PROFILE_PATH_INVALID');
    }
    ancestors(value.workerRoot, false);
    for (const path of value.pythonPaths) ancestors(path, false);
    const source = {};
    for (const name of codeFiles) {
      const path = join(value.workerRoot, name), facts = lstatSync(path);
      if (!facts.isFile() || facts.isSymbolicLink() || facts.size > 1048576 || facts.mode & 0o022) fail('CPU_PROFILE_CODE_CUSTODY');
      const bytes = readFileSync(path); if (digest(bytes) !== value.bundle[name]) fail('CPU_PROFILE_CODE_HASH'); source[name] = bytes.toString('utf8');
    }
    if (digest(readFileSync(value.python)) !== value.pythonSha256) fail('CPU_PROFILE_INTERPRETER_HASH');
    const token = protectedBytes(settings.token_file, 258).toString('utf8').trim();
    if (!/^[\x21-\x7e]{32,192}$/.test(token)) fail('CPU_PROFILE_TOKEN_INVALID');
    const base = stripEntry(source['managed_linux_tree.py']).replace('BOOTSTRAP_SOURCE = "__VEYRA_EMBEDDED_BOOTSTRAP__"', 'BOOTSTRAP_SOURCE = ' + JSON.stringify(source['managed_bootstrap.py']));
    if (base.includes('__VEYRA_EMBEDDED_BOOTSTRAP__')) fail('CPU_PROFILE_BOOTSTRAP_INVALID');
    Object.assign(this, { value: freeze(structuredClone(value)), settings: freeze(structuredClone(settings)), token,
      profileDigest: digest(canonical(value)), endpoint: `http://127.0.0.1:${settings.port}`,
      helperSource: base + '\n' + stripEntry(source['managed_api_tree.py']) + '\ntry:\n    run_api()\nexcept BaseException:\n    os._exit(75)\n',
      witnessSource: stripEntry(source['managed_recovery_witness.py']) + '\ntry:\n    run_witness()\nexcept BaseException:\n    os._exit(75)\n' });
    Object.freeze(this);
  }
  bootstrap(key, owner) {
    const payload = Buffer.from(JSON.stringify({ version: 1, enableInference: true, capability: key.toString('base64'), instanceId: owner.instanceId,
      ownerId: owner.ownerId, ownerGeneration: owner.ownerGeneration, workerRoot: this.value.workerRoot, pythonPaths: this.value.pythonPaths, settings: this.settings }));
    if (!payload.length || payload.length > 65536) fail('CPU_PROFILE_BOOTSTRAP_LIMIT');
    const header = Buffer.alloc(4); header.writeUInt32BE(payload.length); return Buffer.concat([header, payload]);
  }
}
