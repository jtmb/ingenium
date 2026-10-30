import { createHash } from 'node:crypto';
import { CpuOwnershipError, cpuIdentity, cpuProof } from './cpu-ownership.mjs';

const fail = code => { throw new CpuOwnershipError(code); };
const exact = (value, fields) => value && typeof value === 'object' && !Array.isArray(value) && Object.keys(value).sort().join() === [...fields].sort().join();
const canonical = value => value && typeof value === 'object' ? Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const same = (left, right) => canonical(left) === canonical(right);
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) && value !== '00000000-0000-0000-0000-000000000000';

/** Concrete CPUv2 port over SQL128's EXISTING Core writer/original rows. This
 * object retains only ephemeral request-to-context handles. Every authoritative
 * tuple, revision, transaction ACK, claim and result fingerprint is read/CAS in
 * Core. The actual process supervisor constructs it; no HTTP bootstrap does.
 */
export class CoreCpuOwner {
  #bindings = new Map();
  constructor({ ledger, scope }) {
    if (['privateRead', 'bindWorkerBoot', 'claimCpuDispatch', 'retainCpu', 'recordCpuResult', 'quarantineCpu', 'cas'].some(method => typeof ledger?.[method] !== 'function')
      || !scope || typeof scope.captureOriginal !== 'function' || typeof scope.contextFor !== 'function') fail('CPU_CORE_OWNER_BINDING_REQUIRED');
    Object.assign(this, { ledger, scope });
  }
  registerReserved(context, operation) {
    const identity = cpuIdentity(operation?.original?.cpuIdentity);
    if (operation.original.operationId !== identity.operationId || operation.original.controlOperationId !== this.scope.controlOperationId
      || operation.owner.ownerId !== this.scope.owner.ownerId || operation.owner.bootId !== this.scope.owner.bootId
      || operation.owner.ownerGeneration !== this.scope.owner.ownerGeneration || operation.owner.leaseId !== this.scope.owner.leaseId
      || this.#bindings.has(identity.operationId)) fail('CPU_CORE_ORIGINAL_CONFLICT');
    this.#bindings.set(identity.operationId, { context, identity });
  }
  #original(input) {
    const identity = cpuIdentity(input), binding = this.#bindings.get(identity.operationId);
    if (!binding || !same(identity, binding.identity)) fail('CPU_CORE_ORIGINAL_UNAVAILABLE');
    const context = this.scope.contextFor(binding.context);
    const operation = this.ledger.privateRead(context, { operationId: identity.operationId, owner: this.scope.owner });
    if (!same(cpuIdentity(operation.original.cpuIdentity), identity) || operation.original.controlOperationId !== this.scope.controlOperationId) fail('CPU_CORE_ORIGINAL_CONFLICT');
    return { identity, context, operation };
  }
  async dispatch(method, params, transaction) {
    if (method === 'enroll') {
      if (!exact(params, ['instanceId', 'bootId']) || params.instanceId !== this.scope.owner.instanceId || !uuid(params.bootId)) fail('CPU_CORE_ENROLLMENT_INVALID');
      // Actual original Child and authenticated helper capture, retained BEFORE
      // this private port can acknowledge enrollment and permit model loading.
      const physicalProof = await this.scope.captureOriginal();
      const operation = this.ledger.bindWorkerBoot(this.scope.contextFor(this.scope.context), {
        operationId: this.scope.controlOperationId, owner: this.scope.owner, workerBootId: params.bootId, physicalProof,
      });
      if (operation.control?.workerBootId !== params.bootId) fail('CPU_CORE_BOOT_UNCONFIRMED');
      this.scope.workerBootId = params.bootId;
      return { instanceId: params.instanceId, bootId: params.bootId, ownerId: this.scope.owner.ownerId, ownerGeneration: this.scope.owner.ownerGeneration };
    }
    if (method === 'validate') {
      const expected = { instanceId: this.scope.owner.instanceId, bootId: this.scope.workerBootId,
        ownerId: this.scope.owner.ownerId, ownerGeneration: this.scope.owner.ownerGeneration };
      if (!exact(params, Object.keys(expected)) || Object.keys(expected).some(key => params[key] !== expected[key]) || !this.scope.workerBootId
        || this.scope.processExited || this.scope.physicalRetired) fail('CPU_CORE_OWNER_UNCERTAIN');
      const operation = this.ledger.privateRead(this.scope.contextFor(this.scope.context), { operationId: this.scope.controlOperationId, owner: this.scope.owner });
      if (operation.resourceRetired || operation.control?.workerBootId !== this.scope.workerBootId) fail('CPU_CORE_OWNER_UNCERTAIN');
      return { valid: true };
    }
    if (method === 'ready') {
      const health = params?.health, ownership = health?.ownership;
      if (!exact(params, ['health']) || this.scope.closing || this.scope.ready || this.scope.deadlineAt <= Date.now() || health?.ready !== true || health.backend !== 'cpu-onnx'
        || health.service !== 'veyra-speech' || health.gpuReady !== false || health.instanceId !== this.scope.owner.instanceId || health.stt !== true || health.tts !== true
        || ownership?.protocol !== 'veyra-cpu-ownership-v2' || ownership.bootId !== this.scope.workerBootId || ownership.ownerId !== this.scope.owner.ownerId
        || ownership.ownerGeneration !== this.scope.owner.ownerGeneration || ownership.quarantined !== false
        || !Number.isInteger(ownership.capacity) || ownership.capacity < 1 || ownership.capacity > 1024) fail('CPU_CORE_READY_REFUSED');
      const context = this.scope.contextFor(this.scope.context);
      const original = this.ledger.privateRead(context, { operationId: this.scope.controlOperationId, owner: this.scope.owner });
      // bindWorkerBoot atomically moves the actual control original to running;
      // ready only confirms the fixed CPU Application/model set, never a lease.
      if (original.state !== 'running' || original.control?.workerBootId !== this.scope.workerBootId) fail('CPU_CORE_CONTROL_SPENT');
      this.scope.health = Object.freeze(structuredClone(health)); this.scope.ready = true;
      this.scope.readyOriginal.resolve();
      return { accepted: true };
    }
    if (method === 'retain') {
      if (!exact(params, ['identity', 'transactionId', 'expectedRevision', 'state', 'outcome', 'drained']) || params.transactionId !== transaction || !uuid(transaction)
        || !Number.isSafeInteger(params.expectedRevision) || params.expectedRevision < 0) fail('CPU_CORE_RETENTION_INVALID');
      const { identity, context } = this.#original(params.identity);
      if (!['reserved', 'running', 'uncertain', 'terminal'].includes(params.state)
        || params.state === 'running' && (this.scope.closing || !this.scope.ready)) fail('CPU_CORE_ADMISSION_CLOSED');
      const result = this.ledger.retainCpu(context, { operationId: identity.operationId, owner: this.scope.owner, identity,
        transactionId: transaction, expectedCpuRevision: params.expectedRevision, phase: params.state, outcome: params.outcome, drained: params.drained });
      if (!same(cpuIdentity(result.identity), identity) || result.transactionId !== transaction || result.revision !== params.expectedRevision + 1 || !uuid(result.retentionId)) fail('CPU_CORE_RETENTION_UNCONFIRMED');
      return result;
    }
    if (method === 'result') {
      if (!exact(params, ['identity', 'status', 'contentType', 'sha256', 'bytes'])) fail('CPU_CORE_RESULT_INVALID');
      const { identity, context, operation } = this.#original(params.identity);
      const resultFingerprint = { status: params.status, contentType: params.contentType, sha256: params.sha256, bytes: params.bytes };
      const stored = this.ledger.recordCpuResult(context, { operationId: identity.operationId, owner: this.scope.owner, identity,
        expectedCpuRevision: operation.cpu.revision, resultFingerprint });
      if (!same(stored.cpu?.resultFingerprint, resultFingerprint)) fail('CPU_CORE_RESULT_UNCONFIRMED');
      return { retained: true };
    }
    fail('CPU_CORE_PRIVATE_METHOD_INVALID');
  }
  claimDispatch(input) {
    const { identity, context, operation } = this.#original(input);
    if (this.scope.closing || !this.scope.ready) fail('CPU_CORE_ADMISSION_CLOSED');
    return this.ledger.claimCpuDispatch(context, { operationId: identity.operationId, owner: this.scope.owner, identity, expectedCpuRevision: operation.cpu.revision });
  }
  acceptTerminal(input, candidate) {
    const { identity, operation } = this.#original(input), proof = cpuProof(identity, candidate), retained = operation.cpu;
    if (!proof.drained || retained?.phase !== 'terminal' || retained.drained !== true || retained.outcome !== proof.outcome || retained.retentionId !== proof.retentionId
      || !same(cpuIdentity(retained.identity), identity)) fail('CPU_CORE_TERMINAL_UNCONFIRMED');
    return { identity, retired: true, replayAllowed: false, retentionId: retained.retentionId };
  }
  validateResult(input, { status, contentType, bytes }) {
    const { operation } = this.#original(input), retained = operation.cpu;
    const fingerprint = { status, contentType, sha256: createHash('sha256').update(bytes).digest('hex'), bytes: bytes.length };
    if (retained?.phase !== 'terminal' || !retained.drained || !same(retained.resultFingerprint, fingerprint)) fail('CPU_CORE_RESULT_UNCONFIRMED');
  }
  quarantine(input, reason) {
    const { identity, context, operation } = this.#original(input);
    return this.ledger.quarantineCpu(context, { operationId: identity.operationId, owner: this.scope.owner, identity, expectedCpuRevision: operation.cpu.revision, reason });
  }
}
