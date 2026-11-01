import { spawn } from 'node:child_process';
import { ManagedCpuProfile } from './managed-profile.mjs';
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
  #attachmentBootstraps = new WeakMap();
  #attachmentLeases = new WeakMap(); #originalProfile; #originalLedger;
  #scopes = new Map(); #proofs = new WeakMap(); #prepared = new WeakMap(); #handles = new WeakMap(); #current = null; #opening = null;
  constructor({ profile, ledger, bindContext, admitCpu, requireCpuAdmission, releaseCpu, admitCpuWitness, releaseCpuWitness, fetch: request = globalThis.fetch, spawn: launch = spawn }) {
    if (!profile?.helperSource || !profile?.witnessSource || ['reserveControl', 'listControls', 'reserve', 'privateRead', 'retireOriginal', 'settle'].some(method => typeof ledger?.[method] !== 'function')
      || [bindContext, admitCpu, requireCpuAdmission, releaseCpu, admitCpuWitness, releaseCpuWitness, request, launch].some(value => typeof value !== 'function')) fail('CPU_SUPERVISOR_BINDING_REQUIRED');
    this.#originalProfile = profile;
    this.#originalLedger = ledger;
    Object.assign(this, { profile, ledger, bindContext, admitCpu, requireCpuAdmission, releaseCpu, admitCpuWitness, releaseCpuWitness, request, launch, nodeBootId: randomUUID() });
  }
  status() { const scope = this.#current; return { ready: Boolean(scope?.ready && !scope.closing), gpuReady: false, backend: 'cpu-onnx', qualified: false,
    instanceId: this.profile.settings.instance_id, voices: scope?.health?.voices ?? [], configuredDefaultVoice: this.profile.value.defaultVoice }; }
  isOwnedScope(scope) { return Boolean(scope && this.#scopes.get(scope.owner?.ownerId) === scope); }
  /** Read-only actual proof registry. Never accepts serialized booleans/PID/health/timeout evidence. */
  inspectResourceRetirement(input) {
    const proof=this.#proofs.get(input),scope=proof?.scope;
    if(!proof||!scope)fail('CPU_RESOURCE_RETIREMENT_PRODUCER_REQUIRED');
    if(proof.kind==='physical'&&scope.physicalRetired) return Object.freeze({manager:this,scope,owner:scope.owner,admission:scope.admission,
      retired:true,kind:!scope.recovered&&!scope.started&&scope.child===null?'sealed-before-fork':'physical'});
    if(proof.kind==='witness-retired'||proof.kind==='witness-before-fork') return Object.freeze({manager:this,scope,owner:scope.owner,
      admission:proof.admission,retired:true,kind:proof.kind});
    fail('CPU_RESOURCE_RETIREMENT_PRODUCER_REQUIRED');
  }
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
    const scope = action === 'retireOriginal' ? this.#proofs.get(request.physicalProof)?.scope : this.#scopes.get(request.owner?.ownerId);
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
  reserveCpu(input) { return this.#reserveCpu(input); }
  #sourceLedger() {
    const ledger=this.#originalLedger;
    if(this.ledger!==ledger||['reserveOriginalAssistantSource','reserveAttachedAssistantTts','spendOriginalAssistantSource','fenceOriginalAssistantSources','requireOriginalAssistantCpuLive'].some(name=>typeof ledger[name]!=='function'))fail('CPU_ASSISTANT_SOURCE_LEDGER_UNAVAILABLE');
    return ledger;
  }
  reserveOriginalAssistantSource(context,actualPrivatePlan) { return this.#sourceLedger().reserveOriginalAssistantSource(context,actualPrivatePlan); }
  reserveAttachedAssistantCpu(input,sourceClaim) {
    if(input.kind!=='synthesize'||Object.hasOwn(input,'parentOperationId'))fail('CPU_ASSISTANT_INPUT_INVALID');
    return this.#reserveCpu(input,sourceClaim);
  }
  spendOriginalAssistantSource(context,sourceClaim,actualOpaqueDispatch) { this.#sourceLedger().spendOriginalAssistantSource(context,sourceClaim,actualOpaqueDispatch); }
  fenceOriginalAssistantSources(actualOriginalCall,reason) { this.#sourceLedger().fenceOriginalAssistantSources(actualOriginalCall,reason); }
  #reserveCpu({ context, scope: requested, turn, requestId, parentOperationId = null, deadlineAt, kind, pcm, text, voice },sourceClaim=null) {
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
    if(sourceClaim!==null){this.#sourceLedger();parentOperationId=scope.controlOperationId;}
    const assistantSource=sourceClaim===null?null:Object.freeze({sourceClaim,segmentIndex:sourceClaim.segmentIndex,requestId,textSha256:hash(Buffer.from(text)),voice});
    const original = { operationId, requestId, kind: kind === 'transcribe' ? 'voice-speech-stt' : 'voice-speech-tts', scope: requested,
      turnGeneration: turn.generation, inputSha256: identity.digest, parentOperationId, controlOperationId: scope.controlOperationId, control: null, deadlineAt, cpuIdentity: identity };
    scope.operations.set(operationId, { context, identity });
    const reserved = sourceClaim===null?this.ledger.reserve(scope.contextFor(context), original, scope.owner):this.#sourceLedger().reserveAttachedAssistantTts(scope.contextFor(context),sourceClaim,original,scope.owner);
    if (!reserved.accepted || !reserved.fresh) fail('CPU_ORIGINAL_ALREADY_RETAINED');
    scope.coreOwner.registerReserved(context, reserved.operation);
    const handle = Object.freeze({ operationId, requestId, parentOperationId, turnGeneration: turn.generation });
    this.#prepared.set(handle, { scope, context, identity, payload, original, assistantSource }); scope.preparedHandle = handle;
    this.#handles.set(handle, { scope, context, identity, assistantSource });
    return handle;
  }
  inspectCpu(handle) {
    const retained = this.#handles.get(handle); if (!retained) fail('CPU_ORIGINAL_HANDLE_REQUIRED');
    return this.ledger.privateRead(retained.scope.contextFor(retained.context), { operationId: retained.identity.operationId, owner: retained.scope.owner });
  }
  inspectOriginalAssistantCpuDispatch(context,handle) {
    this.#sourceLedger();
    const held=this.#handles.get(handle),prepared=this.#prepared.get(handle);
    if(!held?.assistantSource)fail('CPU_ASSISTANT_ORIGINAL_REQUIRED');
    const {scope,identity,assistantSource:s}=held;this.#assertAttachmentScope(context,scope);
    if(this.#current!==scope||!scope.operations.has(identity.operationId)||identity.kind!=='synthesize'||identity.bootId!==scope.workerBootId
      ||identity.instanceId!==scope.owner.instanceId||identity.ownerId!==scope.owner.ownerId||identity.ownerGeneration!==scope.owner.ownerGeneration
      ||handle.operationId!==identity.operationId||handle.requestId!==s.requestId)fail('CPU_ASSISTANT_ORIGINAL_CHANGED');
    if(prepared){
      if(prepared.scope!==scope||prepared.assistantSource!==s||!equal(prepared.identity,identity)||scope.preparedHandle!==handle
        ||prepared.original.parentOperationId!==scope.controlOperationId||prepared.original.controlOperationId!==scope.controlOperationId||prepared.original.requestId!==s.requestId
        ||cpuPayloadDigest('synthesize',prepared.payload)!==identity.digest)fail('CPU_ASSISTANT_ORIGINAL_CHANGED');
      const payload=JSON.parse(prepared.payload.toString('utf8'));
      if(payload.requestId!==identity.operationId||payload.voice!==s.voice||typeof payload.text!=='string'||hash(Buffer.from(payload.text))!==s.textSha256)fail('CPU_ASSISTANT_ORIGINAL_CHANGED');
    }
    return {scope:scope.scope,owner:scope.owner,controlOperationId:scope.controlOperationId,operationId:identity.operationId,identity,textSha256:s.textSha256,voice:s.voice,requestId:s.requestId,segmentIndex:s.segmentIndex,sourceClaim:s.sourceClaim,prepared:!!prepared};
  }
  cancelPrepared(handle) {
    const prepared = this.#prepared.get(handle); if (!prepared) fail('CPU_ORIGINAL_DISPATCH_SPENT');
    const { scope, context, identity } = prepared;
    if (scope.preparedHandle !== handle) fail('CPU_ORIGINAL_HANDLE_CONFLICT');
    if (prepared.cancelFailure) throw prepared.cancelFailure;
    if (prepared.cancelStarted) fail('CPU_CANCEL_PREPARED_UNCONFIRMED');
    // Publish negative custody BEFORE any external Core step. A failed or
    // uncertain quarantine/retirement keeps this exact dispatch and blocks
    // execute/new reservation; a later missing handle cannot erase the failure.
    prepared.cancelStarted = true;
    try {
      scope.coreOwner.quarantine(identity, 'CPU_CANCELLED_BEFORE_DISPATCH');
      const proof = {}; prepared.cancelProof = proof;
      this.#proofs.set(proof, { kind: 'sealed-no-start', scope, operationId: identity.operationId, outcome: 'cancelled-before-dispatch', retentionSeed: randomBytes(32).toString('hex') });
      this.ledger.retireOriginal(scope.contextFor(context), { operationId: identity.operationId, owner: scope.owner, physicalProof: proof });
    } catch (error) { prepared.cancelFailure = error; throw error; }
    this.#prepared.delete(handle); scope.preparedHandle = null;
  }
  async executeCpu(handle, { signal } = {}) {
    const prepared = this.#prepared.get(handle);
    if (!prepared || prepared.scope.preparedHandle !== handle) fail('CPU_ORIGINAL_DISPATCH_SPENT');
    if (prepared.cancelStarted) fail('CPU_CANCEL_PREPARED_UNCONFIRMED');
    if(prepared.assistantSource)this.#sourceLedger().requireOriginalAssistantCpuLive(prepared.scope.contextFor(prepared.context),prepared.identity.operationId,prepared.scope.owner);
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
  openScope(input) { try { return this.#queueScope(input); } catch(error) { return Promise.reject(error); } }
  #queueScope(input, bootstrap = null) {
    input.signal?.throwIfAborted();
    if (this.#opening) return this.#opening.then(() => this.#queueScope(input, bootstrap));
    const original = this.#open(input, bootstrap); this.#opening = original;
    original.finally(() => { if (this.#opening === original) this.#opening = null; }).catch(() => undefined); return original;
  }
  async #open({ context, scope: requested, sessionId, deadlineAt, signal }, bootstrap = null) {
    const requestedScope = validateScope(requested); signal?.throwIfAborted();
    if (typeof sessionId !== 'string' || !sessionId || sessionId.length > 128 || !Number.isSafeInteger(deadlineAt) || deadlineAt <= Date.now()) fail('CPU_SCOPE_DEADLINE_REQUIRED');
    if (this.#current?.ready && !this.#current.closing && sameScope(this.#current.scope, requestedScope)) {
      this.requireCpuAdmission(this.#current.admission,this.#current);
      if (this.#current.sessions.size >= 16 && !this.#current.sessions.has(sessionId)) fail('CPU_SCOPE_CAPACITY');
      this.#current.sessions.add(sessionId); if(bootstrap)bootstrap.scope=this.#current; return this.status();
    }
    if (this.#current?.sessions.size && !this.#current.closing) fail('CPU_OTHER_SCOPE_BUSY');
    if (this.#current) await this.stopScope(this.#current, Math.min(deadlineAt, Date.now() + 20000));
    signal?.throwIfAborted();
    const scope = this.#scope(context, requestedScope, deadlineAt);
    if(bootstrap)bootstrap.scope=scope; // publish exact original before any recovery/admission await
    scope.sessions.add(sessionId);
    let openingPhase="unallocated";
    try {
    const controls = this.ledger.listControls(scope.contextFor(context), { instanceId: scope.owner.instanceId, owner: scope.owner });
    for (const control of controls) if (!control.resourceRetired) {
      signal?.throwIfAborted(); openingPhase="recovering";
      await this.#recoverControl(context, control, Math.min(deadlineAt, Date.now() + 20000));
      openingPhase="unallocated"; signal?.throwIfAborted();
    }
    const generation = Math.max(0, ...controls.map(control => control.owner.ownerGeneration)) + 1;
    scope.owner = Object.freeze({ ...scope.owner, ownerGeneration: generation });
    signal?.throwIfAborted(); openingPhase="admitting";
    scope.admission = await this.admitCpu({ context, scope: requestedScope, owner: scope.owner, profileDigest: this.profile.profileDigest,
      memoryBytes: this.profile.value.memoryBytes, cpuThreads: this.profile.settings.cpu_threads, deadlineAt, signal });
    openingPhase="admitted"; signal?.throwIfAborted();
    this.requireCpuAdmission(scope.admission, scope);
    if (!Number.isSafeInteger(scope.admission.deadlineAt) || scope.admission.deadlineAt <= Date.now()) fail('CPU_RESOURCE_DEADLINE_REQUIRED');
    deadlineAt = Math.min(deadlineAt, scope.admission.deadlineAt); scope.deadlineAt = deadlineAt;
    const secret = randomBytes(32), key = randomBytes(32), endpoint = 'veyra-cpu-' + hash(scope.owner.ownerId + '\0' + scope.owner.leaseId);
    scope.control = { instanceId: scope.owner.instanceId, profileDigest: this.profile.profileDigest, recoveryEndpointIdentity: endpoint, retirementSecretSha256: hash(secret) };
    const original = { operationId: scope.controlOperationId, requestId: 'voice-cpu-supervisor:' + scope.controlOperationId, kind: 'voice-cpu-supervisor',
      scope: requestedScope, turnGeneration: 0, inputSha256: this.profile.profileDigest, parentOperationId: null, controlOperationId: null, control: scope.control,
      deadlineAt, cpuIdentity: null };
    signal?.throwIfAborted(); const controlContext=scope.contextFor(context); scope.controlReservationAttempted=true;
    const reserved = this.ledger.reserveControl(controlContext, { original, owner: scope.owner, control: scope.control });
    if (!reserved.accepted || !reserved.fresh) fail('CPU_CONTROL_ALREADY_RETAINED');
    this.#current = scope; scope.coreOwner = new CoreCpuOwner({ ledger: this.ledger, scope });
    const env = this.#environment();
    Object.assign(env, { VEYRA_CPU_ORIGINAL_OWNER: JSON.stringify(scope.owner), VEYRA_CPU_CONTROL_ID: scope.controlOperationId,
      VEYRA_CPU_ORIGINAL_ENDPOINT: endpoint, VEYRA_CPU_ENDPOINT_IDENTITY: endpoint, VEYRA_CPU_RETIREMENT_SECRET: secret.toString('base64'),
      VEYRA_CPU_PIPE_KEY: key.toString('base64'), VEYRA_CPU_PARENT_PID: String(process.pid), VEYRA_CPU_MEMORY_BYTES: String(this.profile.value.memoryBytes) });
    // The real Core row and resource scope are retained before this sole launch.
    signal?.throwIfAborted();
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
      else if (!scope.started && ["recovering","admitting"].includes(openingPhase)) {
        // A rejecting external original may retain an effect without returning
        // its handle. Keep this exact scope unknown; do not invent retirement.
        scope.cleanupFailure=Object.assign(Error("CPU_OPEN_EXTERNAL_CLEANUP_UNKNOWN"),{code:"CPU_OPEN_EXTERNAL_CLEANUP_UNKNOWN",cause:error});
      }
      else if (!scope.started) {
        // This exact launch producer is closed without calling spawn. Core's
        // current row (if a checkpoint ACK was lost) can retain that no-start.
        scope.physicalRetired = true; const proof = {}; this.#proofs.set(proof, { kind: 'physical', scope, outcome: 'cancelled-before-dispatch', retentionSeed: randomBytes(32).toString('hex') });
        if(scope.controlReservationAttempted) {
          try { this.ledger.retireOriginal(scope.contextFor(context), { operationId: scope.controlOperationId, owner: scope.owner, physicalProof: proof }); }
          catch (retentionError) { scope.retentionFailure ??= retentionError; }
        } // No attempt means no Core row and no manufactured no-start receipt.
        if(scope.admission && !scope.retentionFailure) {
          try { await this.releaseCpu(scope.admission, proof, this); } catch (releaseError) { scope.releaseFailure ??= releaseError; }
        }
      }
      if(scope.physicalRetired && !scope.cleanupFailure && !scope.retentionFailure && !scope.releaseFailure) {
        if(this.#current===scope)this.#current=null;
        if(!scope.busy && !scope.sessions.size)this.#scopes.delete(scope.owner.ownerId);
      }
      throw error;
    }
  }
  #environment() {
    const scratch = this.profile.settings.scratch_root;
    return { PATH: '/usr/bin:/bin', HOME: scratch, TEMP: scratch, TMP: scratch, TMPDIR: scratch, XDG_CACHE_HOME: scratch, HF_HOME: scratch, TORCH_HOME: scratch,
      CUDA_VISIBLE_DEVICES: '', HIP_VISIBLE_DEVICES: '', ROCR_VISIBLE_DEVICES: '', HF_HUB_OFFLINE: '1', TRANSFORMERS_OFFLINE: '1', OMP_NUM_THREADS: String(this.profile.settings.cpu_threads),
      OPENBLAS_NUM_THREADS: String(this.profile.settings.cpu_threads), MKL_NUM_THREADS: String(this.profile.settings.cpu_threads), NUMEXPR_NUM_THREADS: String(this.profile.settings.cpu_threads) };
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
    const admission=await this.admitCpuWitness({context:scope.context,scope,profileDigest:this.profile.profileDigest,deadlineAt});
    scope.witnessAdmission=admission;let launchCalled=false;
    try {
    this.requireCpuAdmission(admission,scope);
    if(!Number.isSafeInteger(admission.deadlineAt)||admission.deadlineAt<=Date.now())fail('CPU_RESOURCE_DEADLINE_REQUIRED');
    deadlineAt=Math.min(deadlineAt,admission.deadlineAt);launchCalled=true;
    const child = this.launch(this.profile.value.python, ['-I', '-S', '-B', '-c', this.profile.witnessSource], { env: this.#environment(), cwd: this.profile.value.workerRoot, stdio: ['pipe', 'pipe', 'pipe'], windowsHide: true });
    scope.witnessChild = child;
    scope.witness = childOriginal(child, 8192);
    const request = { version: 1, controlOperationId: scope.controlOperationId, owner: scope.owner,
      recoveryEndpointIdentity: scope.control.recoveryEndpointIdentity, retirementSecretSha256: scope.control.retirementSecretSha256,
      requireParentExit, deadlineMs: Math.max(1, Math.min(60000, deadlineAt - Date.now())) };
    scope.witnessInput = new Promise((resolve, reject) => child.stdin.end(JSON.stringify(request) + '\n', error => error ? reject(error) : resolve()));
    scope.witnessReleaseOriginal=Promise.all([scope.witness.exited,scope.witness.closed,scope.witness.stdout,scope.witness.stderr,scope.witnessInput]).then(async result=>{
      const proof={};this.#proofs.set(proof,{kind:'witness-retired',scope,admission});
      await this.releaseCpuWitness(admission,proof,this);return result;
    });
    scope.witnessReleaseOriginal.catch(error=>{scope.witnessReleaseFailure??=error;});
    const result=await this.#deadline(scope.witnessReleaseOriginal,deadlineAt);
    if (result[0].code !== 0 || result[0].signal || result[3].length) fail('CPU_RECOVERY_WITNESS_UNCONFIRMED');
    const proof = privateJson(result[2]);
    if (proof.controlOperationId !== scope.controlOperationId || !equal(proof.owner, scope.owner) || proof.recoveryEndpointIdentity !== scope.control.recoveryEndpointIdentity
      || proof.retirementSecretSha256 !== scope.control.retirementSecretSha256 || proof.helperKernelExited !== true || proof.helperPipeEOF !== true
      || proof.treeEmpty !== true || proof.pipeEof !== true || requireParentExit && proof.parentExited !== true && proof.noStartSealed !== true) fail('CPU_RECOVERY_WITNESS_CONFLICT');
    return proof;
    } catch(error) {
      if(!launchCalled){const proof={};this.#proofs.set(proof,{kind:'witness-before-fork',scope,admission});
        try{await this.releaseCpuWitness(admission,proof,this);}catch(releaseError){scope.witnessReleaseFailure??=releaseError;}}
      throw error;
    }
  }
  async #recoverControl(context, operation, deadlineAt) {
    const scope = this.#scope(context, operation.original.scope, deadlineAt, operation.owner.ownerGeneration);
    this.#scopes.delete(scope.owner.ownerId); scope.owner = Object.freeze(structuredClone(operation.owner)); scope.controlOperationId = operation.original.operationId;
    scope.control = operation.control; scope.workerBootId = operation.control.workerBootId; scope.closing = true; scope.recovered = true; this.#scopes.set(scope.owner.ownerId, scope);
    await this.#witness(scope, deadlineAt, true); scope.physicalRetired = true;
    const proof = {}; this.#proofs.set(proof, { kind: 'physical', scope, retentionSeed: randomBytes(32).toString('hex') });
    this.ledger.retireOriginal(scope.contextFor(context), { operationId: scope.controlOperationId, owner: scope.owner, physicalProof: proof });
    await this.releaseCpu(scope.admission,proof,this);
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

// INSERT inside actual ManagedCpuSupervisor class. New private fields:
// #attachmentLeases = new WeakMap(); #originalProfile;
// Constructor sets #originalProfile=profile before exposing public properties.
// Import ManagedCpuProfile from './managed-profile.mjs' (actual protected loader).
bindAttachmentContext(context) {
 const scope=this.#current;this.#assertAttachmentScope(context,scope);return scope.contextFor(context);
}
captureAttachmentLease(context,scope,callId,deadlineAt) {
 if(typeof callId!=='string'||!/^[a-f0-9]{8}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{4}-[a-f0-9]{12}$/.test(callId)||!Number.isSafeInteger(deadlineAt)
  ||deadlineAt<=Date.now()||deadlineAt>scope?.deadlineAt)fail('CPU_CALL_LEASE_INVALID');
 this.#assertAttachmentScope(context,scope);
 deadlineAt=Math.min(deadlineAt,scope.admission.deadlineAt);if(deadlineAt<=Date.now())fail('CPU_CALL_LEASE_INVALID');
 if(scope.sessions.has(callId)||scope.sessions.size>=16)fail('CPU_CALL_LEASE_CAPACITY');
 const handle=Object.freeze({});scope.sessions.add(callId);
 this.#attachmentLeases.set(handle,{context,scope,callId,deadlineAt,release:null});return handle;
}
#assertAttachmentScope(context,scope) {
 if(!this.isOwnedScope(scope)||this.#current!==scope||!scope.ready||scope.closing||scope.processExited||scope.physicalRetired
  ||!scope.child||!scope.workerBootId||!(this.#originalProfile instanceof ManagedCpuProfile)||!Object.isFrozen(this.#originalProfile)||this.profile!==this.#originalProfile
  ||scope.control?.profileDigest!==this.#originalProfile.profileDigest)fail('CPU_CALL_SCOPE_UNAVAILABLE');
 this.requireCpuAdmission(scope.admission,scope);
 const control=this.ledger.privateRead(scope.contextFor(context),{operationId:scope.controlOperationId,owner:scope.owner});
 if(control.original.kind!=='voice-cpu-supervisor'||control.original.operationId!==scope.controlOperationId||!sameScope(control.original.scope,scope.scope)
  ||control.state!=='running'||control.resourceRetired||!equal(control.owner,scope.owner)||control.control?.workerBootId!==scope.workerBootId
  ||control.control?.profileDigest!==this.#originalProfile.profileDigest)fail('CPU_CALL_CONTROL_UNAVAILABLE');
 if(!scope.health?.voices?.includes(this.#originalProfile.value.defaultVoice))fail('CPU_CALL_VOICE_UNAVAILABLE');
}
inspectAttachmentLease(handle) {
 const original=this.#attachmentLeases.get(handle);
 if(!original||original.release||original.deadlineAt<=Date.now()||!original.scope.sessions.has(original.callId))fail('CPU_CALL_LEASE_REQUIRED');
 this.#assertAttachmentScope(original.context,original.scope);
 return Object.freeze({scope:original.scope.scope,owner:original.scope.owner,controlOperationId:original.scope.controlOperationId,
  profileDigest:this.#originalProfile.profileDigest,defaultVoice:this.#originalProfile.value.defaultVoice,deadlineAt:original.deadlineAt});
}
releaseAttachmentLease(handle) {
 const original=this.#attachmentLeases.get(handle);if(!original)fail('CPU_CALL_LEASE_REQUIRED');
 if(!original.release){
  // Enroll the exact cleanup join before its effect. Keep the final session
  // original until physical retirement is positively acknowledged.
  original.release=Promise.resolve().then(async()=>{
   if(!original.scope.sessions.has(original.callId))fail('CPU_CALL_LEASE_REQUIRED');
   if(original.scope.cleanupFailure||original.scope.retentionFailure||original.scope.releaseFailure)fail('CPU_CALL_LEASE_CLEANUP_UNKNOWN');
   if(original.scope.sessions.size>1){original.scope.sessions.delete(original.callId);return;}
   if(!original.scope.physicalRetired)await this.stopScope(original.scope,Date.now()+20000);
   original.scope.sessions.delete(original.callId);
  });
 }
 return original.release;
}

// INSERT inside ManagedCpuSupervisor. Private field: #attachmentBootstraps=new WeakMap();
  beginOriginalAttachmentScope({context,scope,deadlineAt,signal}) {
    const requested=Object.freeze({...validateScope(scope)});
    if(!Number.isSafeInteger(deadlineAt)||deadlineAt<=Date.now()||!(signal instanceof AbortSignal))fail('CPU_ATTACHMENT_BOOTSTRAP_INPUT');
    signal.throwIfAborted();
    const handle=Object.freeze({}),controller=new AbortController();
    const record={context,scope:null,sessionId:'attachment-bootstrap:'+randomUUID(),controller,signal,
      abort:null,work:null,release:null,released:false,failure:null};
    record.abort=()=>controller.abort(signal.reason);
    // The actual record and pending work are published before #queueScope can
    // call #open, recovery, admission, reservation, network or spawn.
    this.#attachmentBootstraps.set(handle,record);
    record.work=Promise.resolve().then(()=>{
      controller.signal.throwIfAborted();
      return this.#queueScope({context,scope:requested,sessionId:record.sessionId,deadlineAt,signal:controller.signal},record);
    });
    record.work.catch(error=>{record.failure??=error;});
    signal.addEventListener('abort',record.abort,{once:true});
    if(signal.aborted)record.abort();
    return handle;
  }
  async waitOriginalAttachmentScope(handle,signal) {
    const record=this.#attachmentBootstraps.get(handle);
    if(!record||record.released||!(signal instanceof AbortSignal))fail('CPU_ATTACHMENT_BOOTSTRAP_ORIGINAL_REQUIRED');
    const abort=()=>record.controller.abort(signal.reason);
    signal.addEventListener('abort',abort,{once:true});if(signal.aborted)abort();
    try {
      const status=await record.work;
      record.controller.signal.throwIfAborted();signal.throwIfAborted();
      this.#requireAttachmentBootstrap(record);return status; // status DATA, never authority
    } catch(error) {
      try{await this.releaseOriginalAttachmentScope(handle);}catch(cleanup){
        record.failure??=cleanup;throw Object.assign(Error('CPU_ATTACHMENT_BOOTSTRAP_CLEANUP_UNKNOWN'),{code:'CPU_ATTACHMENT_BOOTSTRAP_CLEANUP_UNKNOWN',cause:cleanup});
      }
      throw error;
    } finally {signal.removeEventListener('abort',abort);}
  }
  #requireAttachmentBootstrap(record) {
    const scope=record.scope;
    if(record.released||record.controller.signal.aborted||!scope||!this.isOwnedScope(scope)
      ||!scope.ready||scope.closing||scope.physicalRetired||!scope.sessions.has(record.sessionId))fail('CPU_ATTACHMENT_BOOTSTRAP_NOT_READY');
    this.requireCpuAdmission(scope.admission,scope);return scope;
  }
  bindOriginalAttachmentScope(handle,freshActualContext) {
    const record=this.#attachmentBootstraps.get(handle);if(!record)fail('CPU_ATTACHMENT_BOOTSTRAP_ORIGINAL_REQUIRED');
    const scope=this.#requireAttachmentBootstrap(record);
    // Genuine bindContext validates actual context against exact retained scope.
    // Neither #current nor a caller-supplied observer/scope participates.
    return this.bindContext(freshActualContext,scope,this);
  }
  releaseOriginalAttachmentScope(handle) {
    const record=this.#attachmentBootstraps.get(handle);if(!record)fail('CPU_ATTACHMENT_BOOTSTRAP_ORIGINAL_REQUIRED');
    if(record.release)return record.release;
    record.released=true;record.controller.abort();
    record.signal.removeEventListener('abort',record.abort);
    record.release=Promise.resolve().then(async()=>{
      // Join the enrolled original even if it was still queued or admitting.
      await record.work.catch(()=>undefined);
      const scope=record.scope;if(!scope)return;
      if(scope.cleanupFailure||scope.retentionFailure||scope.releaseFailure)
        throw Object.assign(Error('CPU_ATTACHMENT_BOOTSTRAP_CLEANUP_UNKNOWN'),{code:'CPU_ATTACHMENT_BOOTSTRAP_CLEANUP_UNKNOWN'});
      if(scope.sessions.size>1){scope.sessions.delete(record.sessionId);return;}
      if(scope.physicalRetired){scope.sessions.delete(record.sessionId);if(!scope.busy)this.#scopes.delete(scope.owner.ownerId);return;}
      if(!scope.child)fail('CPU_ATTACHMENT_BOOTSTRAP_CLEANUP_UNKNOWN');
      await this.stopScope(scope,Date.now()+20000); // exact original, never #current
      scope.sessions.delete(record.sessionId); // retain custody until actual retirement succeeds
    });
    record.release.catch(error=>{record.failure??=error;});return record.release;
  }

}
