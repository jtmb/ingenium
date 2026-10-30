import { spawn } from 'node:child_process';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import { CpuOwnershipClient, CpuOwnershipError, cpuIdentity, cpuPayloadDigest } from './cpu-ownership.mjs';
import { SupervisorChannel, privateJson } from './managed-channel.mjs';
import { CoreCpuOwner } from './core-cpu-owner.mjs';
import { sameScope, validateScope, validateTurn } from '../../../../packages/veyra-voice/session.mjs';

const fail = code => { throw new CpuOwnershipError(code); };
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const canonical = value => value && typeof value === 'object' ? Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const equal = (left, right) => canonical(left) === canonical(right);
const deferred = () => { let resolve, reject; const promise = new Promise((yes, no) => { resolve = yes; reject = no; }); promise.catch(() => undefined); return { promise, resolve, reject }; };
const uuidFor = input => { const bytes = Buffer.from(createHash('sha256').update(input).digest().subarray(0, 16)); bytes[6] = bytes[6] & 15 | 128; bytes[8] = bytes[8] & 63 | 128;
  const value = bytes.toString('hex'); return `${value.slice(0, 8)}-${value.slice(8, 12)}-${value.slice(12, 16)}-${value.slice(16, 20)}-${value.slice(20)}`; };

/** Retain actual child wait, stdout/stderr pump completion and first failures.
 * stdout EOF, a PID or a timer never independently reports tree retirement. */
function childOriginal(child, maximum, consume) {
  const exited = deferred(), closed = deferred();
  const original = { child, exit: null, error: null, exited: exited.promise, closed: closed.promise, stdout: null, stderr: null };
  child.once('error', error => { original.error ??= error; exited.reject(error); });
  child.once('exit', (code, signal) => { original.exit = { code, signal }; exited.resolve(original.exit); });
  child.once('close', () => closed.resolve());
  async function pump(stream, kind) {
    let bytes = Buffer.alloc(0);
    try {
      for await (const chunk of stream) {
        if (bytes.length + chunk.length > maximum) fail('CPU_ORIGINAL_OUTPUT_LIMIT');
        bytes = Buffer.concat([bytes, chunk]);
        if (consume) bytes = await consume(bytes, kind);
      }
      return bytes;
    } catch (error) { original.error ??= error; throw error; }
  }
  original.stdout = pump(child.stdout, 'stdout'); original.stderr = pump(child.stderr, 'stderr');
  original.stdout.catch(() => undefined); original.stderr.catch(() => undefined);
  return original;
}

/** One actual Linux hot CPU scope at a time. Core is the sole durable writer.
 * Construction/status start nothing. Root supplies actual API context binding
 * and resource admission; this class has no permissive default authority.
 */
export class ManagedCpuSupervisor {
  #scopes = new Map(); #proofs = new WeakMap(); #prepared = new WeakMap(); #handles = new WeakMap(); #current = null; #opening = null;
  constructor({ profile, ledger, bindContext, admitCpu, requireCpuAdmission, releaseCpu, fetch: request = globalThis.fetch, spawn: launch = spawn }) {
    if (!profile?.helperSource || !profile?.witnessSource || ['reserveControl', 'listControls', 'reserve', 'privateRead', 'retireOriginal', 'settle'].some(method => typeof ledger?.[method] !== 'function')
      || [bindContext, admitCpu, requireCpuAdmission, releaseCpu, request, launch].some(value => typeof value !== 'function')) fail('CPU_SUPERVISOR_BINDING_REQUIRED');
    Object.assign(this, { profile, ledger, bindContext, admitCpu, requireCpuAdmission, releaseCpu, request, launch, nodeBootId: randomUUID() });
  }
  status() { const scope = this.#current; return { ready: Boolean(scope?.ready && !scope.closing), gpuReady: false, backend: 'cpu-onnx', qualified: false,
    instanceId: this.profile.settings.instance_id, voices: scope?.health?.voices ?? [], configuredDefaultVoice: this.profile.value.defaultVoice }; }
  isOwnedScope(scope) { return Boolean(scope && this.#scopes.get(scope.owner?.ownerId) === scope); }
  #scope(context, input, deadlineAt, ownerGeneration = 1) {
    const scope = { context, scope: validateScope(input), deadlineAt, controlOperationId: randomUUID(), owner: Object.freeze({ instanceId: this.profile.settings.instance_id,
      bootId: this.nodeBootId, ownerId: randomUUID(), ownerGeneration, leaseId: randomUUID() }), contextFor: original => this.bindContext(original, scope, this),
      readyOriginal: deferred(), capturedOriginal: deferred(), workerBootId: null, ready: false, closing: false, physicalRetired: false,
      processExited: false, child: null, failure: null, admission: null, operations: new Map(), sessions: new Set(), treeProof: null, started: false, busy: false, stopOriginal: null };
    scope.captureOriginal = async () => { await scope.capturedOriginal.promise; if (!scope.child || scope.processExited || scope.closing) fail('CPU_ACTUAL_SCOPE_UNAVAILABLE');
      const proof = {}; this.#proofs.set(proof, { kind: 'capture', scope }); return proof; };
    this.#scopes.set(scope.owner.ownerId, scope); return scope;
  }
  #fault(scope, error) {
    scope.failure ??= error; scope.closing = true; scope.ready = false;
    scope.readyOriginal.reject(error); scope.capturedOriginal.reject(error);
    if (scope.child && !scope.physicalRetired && !scope.stopOriginal) this.stopScope(scope, Date.now() + 20000);
  }
  /** Exact callback passed to the real Core factory. The opaque resource object
   * must be this manager's actual prepared/live/recovered original, never JSON. */
  requireOriginalResource(_context, operation, action, request) {
    const scope = this.#scopes.get(request.owner?.ownerId);
    if (!scope || !equal(scope.owner, request.owner)) fail('CPU_ORIGINAL_RESOURCE_REQUIRED');
    if (operation && (!equal(operation.owner, scope.owner) || operation.original.operationId !== request.operationId)) fail('CPU_ORIGINAL_RESOURCE_CONFLICT');
    const isControl = request.operationId === scope.controlOperationId || operation?.original?.kind === 'voice-cpu-supervisor';
    if (operation && !isControl && !scope.operations.has(request.operationId)
      && operation.original.controlOperationId !== scope.controlOperationId) fail('CPU_ORIGINAL_RESOURCE_CONFLICT');
    if (action === 'bindWorkerBoot') {
      const proof = this.#proofs.get(request.physicalProof);
      if (proof?.kind !== 'capture' || proof.scope !== scope || !scope.child || scope.processExited) fail('CPU_ACTUAL_SCOPE_UNAVAILABLE');
    }
    if (['claimCpuDispatch'].includes(action) || action === 'retainCpu' && request.phase === 'running') {
      if (!scope.ready || scope.closing || scope.processExited) fail('CPU_ADMISSION_CLOSED');
    }
    if (action === 'reserveControl' || action === 'claimCpuDispatch' || action === 'retainCpu' && request.phase === 'running') this.requireCpuAdmission(scope.admission, scope);
    if (action === 'retireOriginal') {
      const proof = this.#proofs.get(request.physicalProof);
      if (!proof || proof.scope !== scope || proof.kind !== 'physical' && !(proof.kind === 'sealed-no-start' && proof.operationId === request.operationId)) fail('CPU_PHYSICAL_RETIREMENT_REQUIRED');
    }
    return { operationId: operation?.original.operationId ?? (action === 'reserveControl' ? scope.controlOperationId : null), owner: scope.owner, instanceId: scope.owner.instanceId };
  }
  /** Opaque source-produced proof only. Root's Core owner independently matches
   * its exact original tuple and immutable public outcome/fingerprint. */
  verifyRetirement(_context, operation, input) {
    const proof = this.#proofs.get(input), scope = proof?.scope;
    if (!proof || !scope || !equal(operation.owner, scope.owner) || !sameScope(operation.original.scope, scope.scope)
      || operation.original.operationId !== scope.controlOperationId && operation.original.controlOperationId !== scope.controlOperationId) fail('CPU_RETIREMENT_PRODUCER_REQUIRED');
    if (['cpu', 'sealed-no-start'].includes(proof.kind) && proof.operationId !== operation.original.operationId || !['cpu', 'physical', 'sealed-no-start'].includes(proof.kind)) fail('CPU_RETIREMENT_PRODUCER_REQUIRED');
    if (proof.kind === 'physical' && !scope.physicalRetired) fail('CPU_PHYSICAL_RETIREMENT_REQUIRED');
    const privateCpu = operation.cpu;
    if (operation.original.cpuIdentity && operation.original.cpuIdentity.bootId !== scope.workerBootId) fail('CPU_ORIGINAL_BOOT_CONFLICT');
    if (proof.kind === 'cpu' && !equal(proof.identity, operation.original.cpuIdentity)) fail('CPU_ORIGINAL_IDENTITY_CONFLICT');
    // Pure/read-only inside Core's SQL transaction: no joins, random issuance,
    // mutable proof consumption or DB reentry. Seed was captured BEFORE SQL.
    const retentionId = proof.kind === 'cpu' ? proof.retentionId : privateCpu?.phase === 'terminal' && privateCpu.drained ? privateCpu.retentionId
      : uuidFor('VEYRA-CORE-PHYSICAL-RETENTION-V1\0' + proof.retentionSeed + '\0' + operation.original.operationId + '\0' + canonical(scope.owner));
    return { operationId: operation.original.operationId, owner: scope.owner, identity: operation.original.cpuIdentity,
      retentionId, drained: true, outcome: proof.outcome ?? operation.outcome ?? (privateCpu?.phase === 'terminal' ? privateCpu.outcome : 'unknown'),
      resultFingerprint: proof.kind === 'cpu' ? proof.resultFingerprint : operation.resultFingerprint ?? null };
  }
  /** Real Core reservation, exact wire body and one non-reusable local dispatch
   * handle. No raw input is stored in Core or the long-lived operation registry. */
  reserveCpu({ context, scope: requested, turn, requestId, parentOperationId = null, deadlineAt, kind, pcm, text, voice }) {
    const scope = this.#current; requested = validateScope(requested); turn = Object.freeze({ ...validateTurn(turn) });
    if (!scope?.ready || scope.closing || scope.processExited || !sameScope(scope.scope, requested)) fail('CPU_SCOPE_NOT_READY');
    if (scope.busy || scope.preparedHandle) fail('CPU_BUSY_BEFORE_ADMISSION');
    if (typeof requestId !== 'string' || !requestId || requestId.length > 160 || !Number.isSafeInteger(deadlineAt) || deadlineAt <= Date.now()) fail('CPU_ORIGINAL_INVALID');
    deadlineAt = Math.min(deadlineAt, scope.deadlineAt);
    if (deadlineAt <= Date.now()) fail('CPU_ORIGINAL_INVALID');
    const operationId = uuidFor('VEYRA-CORE-VOICE-OPERATION-V1\0' + canonical([requested, requestId, kind]));
    let payload;
    if (kind === 'transcribe') {
      if (!(pcm instanceof Uint8Array) || pcm.length < 8000 || pcm.length > 480000 || pcm.length % 2) fail('CPU_PCM_INVALID');
      payload = Buffer.from(pcm);
    } else if (kind === 'synthesize') {
      if (typeof text !== 'string' || !text.trim() || [...text].length > 600 || Buffer.byteLength(text) > 2400 || Buffer.from(text).toString() !== text
        || typeof voice !== 'string' || !scope.health.voices?.includes(voice)) fail('CPU_TEXT_OR_VOICE_INVALID');
      payload = Buffer.from(JSON.stringify({ requestId: operationId, text, voice }));
    } else fail('CPU_KIND_INVALID');
    const identity = cpuIdentity({ instanceId: scope.owner.instanceId, bootId: scope.workerBootId, ownerId: scope.owner.ownerId,
      ownerGeneration: scope.owner.ownerGeneration, requestId: operationId, operationId,
      generation: uuidFor('VEYRA-CPU-WIRE-GENERATION-V1\0' + canonical([operationId, turn.generation])), kind, digest: cpuPayloadDigest(kind, payload) });
    const original = { operationId, requestId, kind: kind === 'transcribe' ? 'voice-speech-stt' : 'voice-speech-tts', scope: requested,
      turnGeneration: turn.generation, inputSha256: identity.digest, parentOperationId, controlOperationId: scope.controlOperationId, control: null, deadlineAt, cpuIdentity: identity };
    scope.operations.set(operationId, { context, identity });
    const reserved = this.ledger.reserve(scope.contextFor(context), original, scope.owner);
    if (!reserved.accepted || !reserved.fresh) fail('CPU_ORIGINAL_ALREADY_RETAINED');
    scope.coreOwner.registerReserved(context, reserved.operation);
    const handle = Object.freeze({ operationId, requestId, parentOperationId, turnGeneration: turn.generation });
    this.#prepared.set(handle, { scope, context, identity, payload, original }); scope.preparedHandle = handle;
    this.#handles.set(handle, { scope, context, identity });
    return handle;
  }
  inspectCpu(handle) {
    const retained = this.#handles.get(handle); if (!retained) fail('CPU_ORIGINAL_HANDLE_REQUIRED');
    return this.ledger.privateRead(retained.scope.contextFor(retained.context), { operationId: retained.identity.operationId, owner: retained.scope.owner });
  }
  cancelPrepared(handle) {
    const prepared = this.#prepared.get(handle); if (!prepared) fail('CPU_ORIGINAL_DISPATCH_SPENT');
    this.#prepared.delete(handle); const { scope, context, identity } = prepared;
    if (scope.preparedHandle !== handle) fail('CPU_ORIGINAL_HANDLE_CONFLICT'); scope.preparedHandle = null;
    scope.coreOwner.quarantine(identity, 'CPU_CANCELLED_BEFORE_DISPATCH');
    const proof = {}; this.#proofs.set(proof, { kind: 'sealed-no-start', scope, operationId: identity.operationId, outcome: 'cancelled-before-dispatch', retentionSeed: randomBytes(32).toString('hex') });
    this.ledger.retireOriginal(scope.contextFor(context), { operationId: identity.operationId, owner: scope.owner, physicalProof: proof });
  }
  async executeCpu(handle, { signal } = {}) {
    const prepared = this.#prepared.get(handle);
    if (!prepared || prepared.scope.preparedHandle !== handle) fail('CPU_ORIGINAL_DISPATCH_SPENT');
    this.#prepared.delete(handle); const { scope, context, identity, payload } = prepared;
    scope.preparedHandle = null;
    if (scope.busy) fail('CPU_BUSY_BEFORE_ADMISSION'); scope.busy = true;
    let attempts = 0;
    const client = new CpuOwnershipClient({ baseUrl: this.profile.endpoint, token: this.profile.token, owner: scope.coreOwner,
      fetch: (...args) => { attempts++; return this.request(...args); } });
    // Keep the actual request promise/error in its owned operation until its
    // last consumer; no detached result-recovery POST or inferred completion.
    const operation = scope.operations.get(identity.operationId);
    const original = client.start(identity, payload, { signal }); operation.requestOriginal = original;
    try {
      const result = await original;
      const metadata = this.ledger.privateRead(scope.contextFor(context), { operationId: identity.operationId, owner: scope.owner });
      if (!result.retired || metadata.cpu?.drained !== true || metadata.cpu.phase !== 'terminal' || metadata.cpu.retentionId !== result.proof.retentionId) fail('CPU_ORIGINAL_RETIREMENT_UNCONFIRMED');
      const outcome = result.proof.outcome, fingerprint = metadata.cpu.resultFingerprint?.sha256 ?? null;
      const proof = {}; this.#proofs.set(proof, { kind: 'cpu', scope, operationId: identity.operationId, identity, retentionId: metadata.cpu.retentionId, outcome, resultFingerprint: fingerprint });
      this.ledger.settle(scope.contextFor(context), { operationId: identity.operationId, expectedRevision: metadata.revision, owner: scope.owner,
        from: metadata.state, to: 'terminal', outcome, resultFingerprint: fingerprint, proof });
      signal?.throwIfAborted();
      return { ...result, operationId: identity.operationId, requestId: prepared.original.requestId };
    } catch (error) {
      operation.failure ??= error;
      try { scope.coreOwner.quarantine(identity, 'CPU_OUTCOME_UNCERTAIN'); } catch (retentionError) { operation.retentionFailure ??= retentionError; }
      if (attempts === 0) {
        // Actual request promise returned before any HTTP call. Its unique
        // dispatch handle is consumed; Core closes future admission for this
        // exact original. Absence/health/PIDs are not the no-start evidence.
        const proof = {}; this.#proofs.set(proof, { kind: 'sealed-no-start', scope, operationId: identity.operationId, outcome: 'cancelled-before-dispatch', retentionSeed: randomBytes(32).toString('hex') });
        this.ledger.retireOriginal(scope.contextFor(context), { operationId: identity.operationId, owner: scope.owner, physicalProof: proof });
      } else {
        const retained = this.ledger.privateRead(scope.contextFor(context), { operationId: identity.operationId, owner: scope.owner });
        if (!retained.cpu?.drained) {
          try { await this.stopScope(scope, Date.now() + 20000); } catch (cleanupError) { operation.cleanupFailure ??= cleanupError; }
        }
      }
      throw error;
    } finally {
      // This exact request promise has returned; no pending promise/result bytes
      // or original Request context need to live in the hot scope registry.
      delete operation.requestOriginal;
      try { scope.coreOwner.releaseFinished(identity); scope.operations.delete(identity.operationId); }
      catch (retentionError) { if (!scope.physicalRetired) operation.consumerRetentionFailure ??= retentionError; }
      scope.busy = false;
      if (scope.physicalRetired) { scope.operations.clear(); this.#scopes.delete(scope.owner.ownerId); }
    }
  }
  openScope(input) {
    if (this.#opening) return this.#opening.then(() => this.openScope(input));
    const original = this.#open(input); this.#opening = original;
    original.finally(() => { if (this.#opening === original) this.#opening = null; }).catch(() => undefined); return original;
  }
  async #open({ context, scope: requested, sessionId, deadlineAt, signal }) {
    const requestedScope = validateScope(requested); signal?.throwIfAborted();
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 128 || !Number.isSafeInteger(deadlineAt) || deadlineAt <= Date.now()) fail('CPU_SCOPE_DEADLINE_REQUIRED');
    if (this.#current?.ready && !this.#current.closing && sameScope(this.#current.scope, requestedScope)) {
      if (this.#current.sessions.size >= 16 && !this.#current.sessions.has(sessionId)) fail('CPU_SCOPE_CAPACITY');
      this.#current.sessions.add(sessionId); return this.status();
    }
    if (this.#current?.sessions.size && !this.#current.closing) fail('CPU_OTHER_SCOPE_BUSY');
    if (this.#current) await this.stopScope(this.#current, Math.min(deadlineAt, Date.now() + 20000));
    const scope = this.#scope(context, requestedScope, deadlineAt);
    scope.sessions.add(sessionId);
    const controls = this.ledger.listControls(scope.contextFor(context), { instanceId: scope.owner.instanceId, owner: scope.owner });
    for (const control of controls) if (!control.resourceRetired) await this.#recoverControl(context, control, Math.min(deadlineAt, Date.now() + 20000));
    const generation = Math.max(0, ...controls.map(control => control.owner.ownerGeneration)) + 1;
    scope.owner = Object.freeze({ ...scope.owner, ownerGeneration: generation });
    scope.admission = await this.admitCpu({ context, scope: requestedScope, owner: scope.owner, profileDigest: this.profile.profileDigest,
      memoryBytes: this.profile.value.memoryBytes, cpuThreads: this.profile.settings.cpu_threads, deadlineAt, signal });
    try {
    this.requireCpuAdmission(scope.admission, scope);
    if (!Number.isSafeInteger(scope.admission.deadlineAt) || scope.admission.deadlineAt <= Date.now()) fail('CPU_RESOURCE_DEADLINE_REQUIRED');
    deadlineAt = Math.min(deadlineAt, scope.admission.deadlineAt); scope.deadlineAt = deadlineAt;
    const secret = randomBytes(32), key = randomBytes(32), endpoint = 'veyra-cpu-' + hash(scope.owner.ownerId + '\0' + scope.owner.leaseId);
    scope.control = { instanceId: scope.owner.instanceId, profileDigest: this.profile.profileDigest, recoveryEndpointIdentity: endpoint, retirementSecretSha256: hash(secret) };
    const original = { operationId: scope.controlOperationId, requestId: 'voice-cpu-supervisor:' + scope.controlOperationId, kind: 'voice-cpu-supervisor',
      scope: requestedScope, turnGeneration: 0, inputSha256: this.profile.profileDigest, parentOperationId: null, controlOperationId: null, control: scope.control,
      deadlineAt, cpuIdentity: null };
    const reserved = this.ledger.reserveControl(scope.contextFor(context), { original, owner: scope.owner, control: scope.control });
    if (!reserved.accepted || !reserved.fresh) fail('CPU_CONTROL_ALREADY_RETAINED');
    this.#current = scope; scope.coreOwner = new CoreCpuOwner({ ledger: this.ledger, scope });
    const env = this.#environment();
    Object.assign(env, { VEYRA_CPU_ORIGINAL_OWNER: JSON.stringify(scope.owner), VEYRA_CPU_CONTROL_ID: scope.controlOperationId,
      VEYRA_CPU_ORIGINAL_ENDPOINT: endpoint, VEYRA_CPU_ENDPOINT_IDENTITY: endpoint, VEYRA_CPU_RETIREMENT_SECRET: secret.toString('base64'),
      VEYRA_CPU_PIPE_KEY: key.toString('base64'), VEYRA_CPU_PARENT_PID: String(process.pid), VEYRA_CPU_MEMORY_BYTES: String(this.profile.value.memoryBytes) });
    // The real Core row and resource scope are retained before this sole launch.
    scope.started = true;
    scope.child = this.launch(this.profile.value.python, ['-I', '-S', '-B', '-c', this.profile.helperSource], { env, cwd: this.profile.value.workerRoot, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    scope.exitOriginal = deferred(); scope.closeOriginal = deferred();
    scope.child.once('error', error => { scope.exitOriginal.reject(error); this.#fault(scope, error); });
    scope.child.once('exit', (code, exitSignal) => { scope.processExited = true; scope.exit = { code, signal: exitSignal }; scope.exitOriginal.resolve(scope.exit);
      if (!scope.closing) this.#fault(scope, new CpuOwnershipError('CPU_ORIGINAL_EXITED')); });
    scope.child.once('close', () => scope.closeOriginal.resolve());
    scope.channel = new SupervisorChannel({ reader: scope.child.stdout, writer: scope.child.stdin, key,
      dispatch: (...args) => scope.coreOwner.dispatch(...args), onFault: error => this.#fault(scope, error) });
    scope.treeOriginal = this.#readTree(scope, key); scope.treeOriginal.catch(error => this.#fault(scope, error));
    scope.channel.start();
    // Original writer completion is retained independently of EOF/process proof.
    scope.bootstrapOriginal = new Promise((resolve, reject) => scope.child.stdin.write(this.profile.bootstrap(key, scope.owner), error => error ? reject(error) : resolve()));
    scope.bootstrapOriginal.catch(error => this.#fault(scope, error));
    scope.expiryOriginal = setTimeout(() => this.stopScope(scope, Date.now() + 20000), Math.max(1, deadlineAt - Date.now()));
    await this.#deadline(scope.readyOriginal.promise, Math.min(deadlineAt, Date.now() + 30000), signal); return this.status();
    } catch (error) {
      scope.failure ??= error; scope.closing = true;
      if (scope.child) { try { await this.stopScope(scope, Date.now() + 20000); } catch (cleanupError) { scope.cleanupFailure ??= cleanupError; } }
      else if (!scope.started) {
        // This exact launch producer is closed without calling spawn. Core's
        // current row (if a checkpoint ACK was lost) can retain that no-start.
        scope.physicalRetired = true; const proof = {}; this.#proofs.set(proof, { kind: 'physical', scope, outcome: 'cancelled-before-dispatch', retentionSeed: randomBytes(32).toString('hex') });
        try { this.ledger.retireOriginal(scope.contextFor(context), { operationId: scope.controlOperationId, owner: scope.owner, physicalProof: proof }); }
        catch (retentionError) { scope.retentionFailure ??= retentionError; }
        try { await this.releaseCpu(scope.admission, proof, this); } catch (releaseError) { scope.releaseFailure ??= releaseError; }
      }
      throw error;
    }
  }
  #environment() {
    const scratch = this.profile.settings.scratch_root;
    return { PATH: '/usr/bin:/bin', HOME: scratch, TEMP: scratch, TMP: scratch, TMPDIR: scratch, XDG_CACHE_HOME: scratch, HF_HOME: scratch, TORCH_HOME: scratch,
      CUDA_VISIBLE_DEVICES: '', HIP_VISIBLE_DEVICES: '', ROCR_VISIBLE_DEVICES: '', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', OMP_NUM_THREADS: String(this.profile.settings.cpu_threads) };
  }
  releaseSession({ sessionId, scope: requested }) {
    const scope = this.#current;
    if (!scope || !sameScope(scope.scope, validateScope(requested)) || !scope.sessions.has(sessionId)) fail('CPU_SESSION_ORIGINAL_CONFLICT');
    scope.sessions.delete(sessionId);
    return scope.sessions.size ? Promise.resolve() : this.stopScope(scope, Date.now() + 20000);
  }
  async #readTree(scope, key) {
    const domain = Buffer.from('VEYRA-CPU-ORIGINAL-TREE-V1\0'); let bytes = Buffer.alloc(0), sequence = 0;
    const { createHmac, timingSafeEqual } = await import('node:crypto');
    for await (const chunk of scope.child.stderr) {
      bytes = Buffer.concat([bytes, chunk]); if (bytes.length > 16384) fail('CPU_TREE_FRAME_LIMIT');
      while (bytes.length >= 4) {
        const length = bytes.readUInt32BE(0); if (!length || length > 4096) fail('CPU_TREE_FRAME_LIMIT'); if (bytes.length < length + 44) break;
        const frame = bytes.subarray(0, length + 44); bytes = bytes.subarray(length + 44);
        if (frame.readBigUInt64BE(4) !== BigInt(++sequence)) fail('CPU_TREE_SEQUENCE_INVALID');
        const expected = createHmac('sha256', key).update(domain).update(frame.subarray(4, 12)).update(frame.subarray(44)).digest();
        if (!timingSafeEqual(expected, frame.subarray(12, 44))) fail('CPU_TREE_FRAME_AUTHORITY');
        const value = privateJson(frame.subarray(44));
        const fields = ['event', 'ownerId', 'ownerGeneration', 'treeEmpty', 'pipeEof', 'leaderWaited', 'reaped', 'controlOperationId', 'leaseId', 'parentBootId', 'recoveryEndpointIdentity', 'socketDevice', 'socketInode'];
        if (Object.keys(value).sort().join() !== fields.sort().join()
          || !Number.isSafeInteger(value.reaped) || value.reaped < 0 || !Number.isSafeInteger(value.socketDevice) || value.socketDevice < 0
          || !Number.isSafeInteger(value.socketInode) || value.socketInode < 1) fail('CPU_TREE_FIELDS_INVALID');
        if (value.ownerId !== scope.owner.ownerId || value.ownerGeneration !== scope.owner.ownerGeneration || value.parentBootId !== scope.owner.bootId
          || value.leaseId !== scope.owner.leaseId || value.controlOperationId !== scope.controlOperationId || value.recoveryEndpointIdentity !== scope.control.recoveryEndpointIdentity) fail('CPU_TREE_ORIGINAL_CONFLICT');
        if (value.event === 'tree-prepared' && sequence === 1 && value.treeEmpty === false && value.leaderWaited === false && value.pipeEof === false) scope.capturedOriginal.resolve();
        else if (!scope.treeProof && ['tree-retired', 'tree-no-start'].includes(value.event) && value.treeEmpty === true && value.pipeEof === true
          && (value.event === 'tree-retired' ? sequence === 2 && value.leaderWaited === true && value.reaped > 0 : sequence === 1 && value.leaderWaited === false && value.reaped === 0)) { scope.treeProof = value; }
        else fail('CPU_TREE_PHASE_INVALID');
      }
    }
    if (bytes.length) fail('CPU_TREE_FRAME_TRUNCATED');
  }
  async #deadline(promise, deadlineAt, signal) {
    let timer, abort;
    try { return await Promise.race([promise, new Promise((_, reject) => { timer = setTimeout(() => reject(new CpuOwnershipError('CPU_ORIGINAL_PENDING')), Math.max(1, deadlineAt - Date.now()));
      if (signal) { abort = () => reject(signal.reason ?? new CpuOwnershipError('CPU_CANCEL_REQUESTED')); signal.addEventListener('abort', abort, { once: true }); if (signal.aborted) abort(); } })]); }
    finally { clearTimeout(timer); signal?.removeEventListener('abort', abort); }
  }
  async #witness(scope, deadlineAt, requireParentExit) {
    const child = this.launch(this.profile.value.python, ['-I', '-S', '-B', '-c', this.profile.witnessSource], { env: this.#environment(), cwd: this.profile.value.workerRoot, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    scope.witnessChild = child;
    scope.witness = childOriginal(child, 8192);
    const request = { version: 1, controlOperationId: scope.controlOperationId, owner: scope.owner,
      recoveryEndpointIdentity: scope.control.recoveryEndpointIdentity, retirementSecretSha256: scope.control.retirementSecretSha256,
      requireParentExit, deadlineMs: Math.max(1, Math.min(60000, deadlineAt - Date.now())) };
    scope.witnessInput = new Promise((resolve, reject) => child.stdin.end(JSON.stringify(request) + '\n', error => error ? reject(error) : resolve()));
    const result = await this.#deadline(Promise.all([scope.witness.exited, scope.witness.closed, scope.witness.stdout, scope.witness.stderr, scope.witnessInput]), deadlineAt);
    if (result[0].code !== 0 || result[0].signal || result[3].length) fail('CPU_RECOVERY_WITNESS_UNCONFIRMED');
    const proof = privateJson(result[2]);
    if (proof.controlOperationId !== scope.controlOperationId || !equal(proof.owner, scope.owner) || proof.recoveryEndpointIdentity !== scope.control.recoveryEndpointIdentity
      || proof.retirementSecretSha256 !== scope.control.retirementSecretSha256 || proof.helperKernelExited !== true || proof.helperPipeEOF !== true
      || proof.treeEmpty !== true || proof.pipeEof !== true || requireParentExit && proof.parentExited !== true && proof.noStartSealed !== true) fail('CPU_RECOVERY_WITNESS_CONFLICT');
    return proof;
  }
  async #recoverControl(context, operation, deadlineAt) {
    const scope = this.#scope(context, operation.original.scope, deadlineAt, operation.owner.ownerGeneration);
    this.#scopes.delete(scope.owner.ownerId); scope.owner = Object.freeze(structuredClone(operation.owner)); scope.controlOperationId = operation.original.operationId;
    scope.control = operation.control; scope.workerBootId = operation.control.workerBootId; scope.closing = true; scope.recovered = true; this.#scopes.set(scope.owner.ownerId, scope);
    await this.#witness(scope, deadlineAt, true); scope.physicalRetired = true;
    const proof = {}; this.#proofs.set(proof, { kind: 'physical', scope, retentionSeed: randomBytes(32).toString('hex') });
    this.ledger.retireOriginal(scope.contextFor(context), { operationId: scope.controlOperationId, owner: scope.owner, physicalProof: proof });
  }
  stopScope(scope = this.#current, deadlineAt = Date.now() + 20000) {
    if (!scope) return Promise.resolve(); if (scope.stopOriginal) return scope.stopOriginal;
    scope.closing = true; scope.ready = false;
    clearTimeout(scope.expiryOriginal);
    const original = this.#stop(scope, deadlineAt); scope.stopOriginal = original; original.catch(error => { scope.failure ??= error; }); return original;
  }
  async #stop(scope, deadlineAt) {
    // Consume the only unpublished dispatch gate before physical shutdown.
    // Release its raw payload even if Core metadata retention is unavailable;
    // the original control cascade remains the durable finalizer.
    if (scope.preparedHandle) {
      this.#prepared.delete(scope.preparedHandle);
      scope.preparedHandle = null;
    }
    if (!scope.child) fail('CPU_ORIGINAL_LAUNCH_UNCONFIRMED');
    void scope.channel.send({ event: 'shutdown' }).catch(error => { scope.failure ??= error; });
    // Close this exact inherited input after the grace interval. Linux helper
    // owns cancellation/pidfds; never kill it or signal a PID/process group.
    const closingInput = new Promise(resolve => setTimeout(() => { scope.channel.closeInput(); resolve(); }, 500));
    await closingInput;
    await this.#witness(scope, deadlineAt, false);
    await this.#deadline(Promise.all([scope.exitOriginal.promise, scope.closeOriginal.promise, scope.treeOriginal, scope.bootstrapOriginal.catch(() => undefined), scope.channel.joinOriginals()]), deadlineAt);
    if (scope.exit?.code !== 0 || scope.exit.signal || !scope.treeProof) fail('CPU_ACTUAL_ORIGINAL_RETIREMENT_UNCONFIRMED');
    scope.physicalRetired = true; const proof = {}; this.#proofs.set(proof, { kind: 'physical', scope, retentionSeed: randomBytes(32).toString('hex') });
    this.ledger.retireOriginal(scope.contextFor(scope.context), { operationId: scope.controlOperationId, owner: scope.owner, physicalProof: proof });
    scope.coreOwner.releasePhysicallyRetired();
    await this.releaseCpu(scope.admission, proof, this); if (this.#current === scope) this.#current = null;
    if (!scope.busy) { scope.operations.clear(); this.#scopes.delete(scope.owner.ownerId); }
  }
}
