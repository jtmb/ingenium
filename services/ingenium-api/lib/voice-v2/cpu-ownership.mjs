import { createHash } from 'node:crypto';

const fields = ['instanceId', 'bootId', 'ownerId', 'ownerGeneration', 'requestId', 'operationId', 'generation', 'kind', 'digest'];
const uuid = value => typeof value === 'string' && /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/.test(value) && value !== '00000000-0000-0000-0000-000000000000';
export class CpuOwnershipError extends Error {
  constructor(code) { super(code); this.name = 'CpuOwnershipError'; this.code = code; }
}
const fail = code => { throw new CpuOwnershipError(code); };
export function cpuIdentity(value) {
  if (!value || typeof value !== 'object' || Array.isArray(value) || Object.keys(value).length !== fields.length || fields.some(key => !Object.hasOwn(value, key))) fail('CPU_IDENTITY_INVALID');
  if (typeof value.instanceId !== 'string' || !/^[A-Za-z0-9:_-]{1,160}$/.test(value.instanceId)
    || ['bootId', 'ownerId', 'requestId', 'operationId', 'generation'].some(key => !uuid(value[key]))
    || value.requestId !== value.operationId || !Number.isSafeInteger(value.ownerGeneration) || value.ownerGeneration < 1
    || !['transcribe', 'synthesize'].includes(value.kind) || typeof value.digest !== 'string' || !/^[0-9a-f]{64}$/.test(value.digest)) fail('CPU_IDENTITY_INVALID');
  return Object.freeze(Object.fromEntries(fields.map(key => [key, value[key]])));
}
const same = (left, right) => fields.every(key => left[key] === right[key]);
export function cpuPayloadDigest(kind, bytes) {
  if (!['transcribe', 'synthesize'].includes(kind) || !(bytes instanceof Uint8Array)) fail('CPU_PAYLOAD_INVALID');
  return createHash('sha256').update(kind + '\0', 'ascii').update(bytes).digest('hex');
}
export function cpuProof(original, value) {
  const identity = cpuIdentity(original), proofIdentity = cpuIdentity(value?.identity);
  if (!same(identity, proofIdentity) || Object.keys(value).some(key => !['identity', 'state', 'outcome', 'drained', 'retentionId', 'accepted'].includes(key))) fail('CPU_PROOF_IDENTITY_MISMATCH');
  if (value.accepted !== undefined && value.accepted !== true) fail('CPU_PROOF_INVALID');
  if (value.state === 'terminal') {
    if (value.drained !== true || !uuid(value.retentionId) || !['completed', 'failed', 'cancelled', 'cancelled-before-dispatch'].includes(value.outcome)) fail('CPU_PROOF_INVALID');
  } else if (!['reserved', 'running', 'uncertain'].includes(value.state) || value.drained !== false || value.outcome !== null
    || (value.retentionId !== null && !uuid(value.retentionId))) fail('CPU_PROOF_INVALID');
  return Object.freeze({ identity, state: value.state, outcome: value.outcome, drained: value.drained, retentionId: value.retentionId });
}

async function bounded(response, limit) {
  const reader = response.body?.getReader();
  if (!reader) fail('CPU_RESPONSE_EMPTY');
  const length = response.headers.get('content-length');
  if (length !== null && (!/^\d+$/.test(length) || Number(length) > limit)) { await reader.cancel(); fail('CPU_RESPONSE_LIMIT'); }
  const chunks = []; let count = 0;
  try {
    for (;;) {
      const next = await reader.read(); if (next.done) break;
      count += next.value.byteLength;
      if (count > limit) { await reader.cancel(); fail('CPU_RESPONSE_LIMIT'); }
      chunks.push(next.value);
    }
  } finally { reader.releaseLock(); }
  if (length !== null && count !== Number(length)) fail('CPU_RESPONSE_TRUNCATED');
  const bytes = new Uint8Array(count); let offset = 0;
  for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.byteLength; }
  return bytes;
}

/** Server-only v2 consumer. The existing Windows-native OR Linux API supervisor
 * supplies original bindings, one-shot dispatch and durable proof acceptance.
 * There is no default owner, journal, session, generation creator or replay loop. */
export class CpuOwnershipClient {
  constructor({ baseUrl, token, owner, fetch: request = globalThis.fetch }) {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || typeof token !== 'string' || !token
      || ['claimDispatch', 'acceptTerminal', 'quarantine'].some(key => typeof owner?.[key] !== 'function')) fail('CPU_OWNER_CONFIG_INVALID');
    Object.assign(this, { baseUrl: url.origin, token, owner, request });
  }
  async #call(path, body, contentType = 'application/json', identity, limit = 8192, signal) {
    const response = await this.request(new URL(path, this.baseUrl), { method: 'POST', redirect: 'error',
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': contentType, ...(identity ? { 'X-Veyra-Identity': JSON.stringify(identity) } : {}) },
      body, signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(7000)]) : AbortSignal.timeout(7000) });
    const bytes = await bounded(response, limit);
    return { bytes, status: response.status, ok: response.ok, contentType: response.headers.get('content-type')?.split(';')[0] ?? '' };
  }
  async #observe(identity, action) {
    const result = await this.#call('/v2/operations/' + action, JSON.stringify(identity));
    if (!result.ok) fail('CPU_ORIGINAL_UNAVAILABLE');
    return cpuProof(identity, JSON.parse(new TextDecoder().decode(result.bytes)));
  }
  async #accept(identity, proof) {
    if (!proof.drained) return { proof, retired: false, resultAvailable: false };
    // The privileged port must match the worker's transition with its own durable
    // original/process binding before authorizing resource retirement. No boolean
    // ACK, health response or freshly generated ID can substitute for that receipt.
    const accepted = await this.owner.acceptTerminal(identity, proof);
    if (!accepted || accepted.retired !== true || accepted.replayAllowed !== false
      || accepted.retentionId !== proof.retentionId || !same(identity, cpuIdentity(accepted.identity))) fail('CPU_OWNER_PROOF_UNCONFIRMED');
    return { proof, retired: true, resultAvailable: false };
  }
  async #unknown(identity) {
    // Failure to retain quarantine propagates; no local success/terminal fallback.
    try { await this.owner.quarantine(identity, 'CPU_OUTCOME_UNCERTAIN'); }
    catch { fail('CPU_QUARANTINE_RETENTION_UNCONFIRMED'); }
    fail('CPU_OUTCOME_UNCERTAIN');
  }
  async start(original, payload, { signal } = {}) {
    const identity = cpuIdentity(original);
    if (!(payload instanceof Uint8Array) || cpuPayloadDigest(identity.kind, payload) !== identity.digest
      || (identity.kind === 'transcribe' ? payload.length < 8000 || payload.length > 480000 || payload.length % 2 : !payload.length || payload.length > 4096)) fail('CPU_PAYLOAD_INVALID');
    signal?.throwIfAborted();
    // Claim BEFORE even reserving: a lost reserve response cannot restart this
    // workflow or indirectly re-authorize an execute on a later reconnect.
    let permit;
    try {
      permit = await this.owner.claimDispatch(identity);
      if (!permit || !uuid(permit.permitId) || !same(identity, cpuIdentity(permit.identity))) fail('CPU_DISPATCH_NOT_AUTHORIZED');
    } catch { return this.#unknown(identity); }
    try {
      const reserved = await this.#observe(identity, 'reserve');
      if (reserved.drained) return await this.#accept(identity, reserved);
      if (reserved.state !== 'reserved') fail('CPU_ORIGINAL_SPENT');
      const result = await this.#call(identity.kind === 'transcribe' ? '/v2/transcriptions' : '/v2/speech', payload,
        identity.kind === 'transcribe' ? 'application/octet-stream' : 'application/json', identity, 1440044, signal);
      const proof = await this.#observe(identity, 'observe');
      if (result.ok !== (proof.outcome === 'completed')) fail('CPU_RESPONSE_PROOF_CONFLICT');
      const accepted = await this.#accept(identity, proof);
      if (!accepted.retired) fail('CPU_ORIGINAL_UNSETTLED');
      if (typeof this.owner.validateResult === 'function') await this.owner.validateResult(identity, { status: result.status, contentType: result.contentType, bytes: result.bytes });
      return { ...accepted, resultAvailable: result.ok, bytes: result.ok ? result.bytes : undefined, status: result.status };
    } catch { return this.#unknown(identity); }
  }
  async reconcile(original) {
    const identity = cpuIdentity(original);
    try { return await this.#accept(identity, await this.#observe(identity, 'observe')); }
    catch { return this.#unknown(identity); }
  }
  async cancel(original) {
    const identity = cpuIdentity(original);
    try {
      const proof = await this.#observe(identity, 'cancel');
      // Running acknowledgement is explicitly nonterminal. Reserved cancellation
      // may carry a separately retained dispatch-sealed terminal proof.
      return await this.#accept(identity, proof);
    } catch { return this.#unknown(identity); }
  }
}
