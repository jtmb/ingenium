import { createHash } from 'node:crypto';
import { VoiceError, validateScope, validateTurn, sameScope } from '../../../../packages/veyra-voice/session.mjs';

const fail = code => { throw new VoiceError(code); };
const canonical = value => value && typeof value === 'object' ? Array.isArray(value) ? '[' + value.map(canonical).join(',') + ']'
  : '{' + Object.keys(value).sort().map(key => JSON.stringify(key) + ':' + canonical(value[key])).join(',') + '}' : JSON.stringify(value);
const hash = value => createHash('sha256').update(canonical(value)).digest('hex');
export function voiceOperationId(scope, requestId, kind) {
  const bytes = Buffer.from(hash(['VEYRA-CORE-AGENT-ORIGINAL-V1', validateScope(scope), requestId, kind]).slice(0, 32), 'hex');
  bytes[6] = bytes[6] & 15 | 128; bytes[8] = bytes[8] & 63 | 128;
  const id = bytes.toString('hex'); return `${id.slice(0, 8)}-${id.slice(8, 12)}-${id.slice(12, 16)}-${id.slice(16, 20)}-${id.slice(20)}`;
}
export function agentResultFingerprint({ scope, requestId, text }) {
  if (typeof text !== 'string' || [...text].length > 32000 || Buffer.from(text).toString() !== text) fail('VOICE_RESULT_INVALID');
  return hash({ scope: validateScope(scope), requestId, text });
}
export const controlResultFingerprint = operationId => hash({ original: operationId, accepted: true });
export const agentInputFingerprint = ({ scope, turn, text, delivery, parentOperationId = null }) =>
  hash({ scope: validateScope(scope), turn: validateTurn(turn), text, delivery, parentOperationId });

/** Concrete SQL128 consumer. bindOriginal is Root's actual selected execution
 * resource/context binding, never an owner guessed from a session or HTTP body.
 * Every reserve/CAS/settle/quarantine uses the existing Core owner synchronously.
 */
export class CoreVoiceOperations {
  #originals = new WeakMap();
  constructor({ ledger, bindOriginal }) {
    if (['reserve', 'read', 'cas', 'settle', 'quarantine', 'retireOriginal'].some(method => typeof ledger?.[method] !== 'function') || typeof bindOriginal !== 'function') fail('VOICE_CORE_BINDING_REQUIRED');
    Object.assign(this, { ledger, bindOriginal, contract: 'veyra-core-voice-128' });
  }
  reserve({ context, scope, turn, requestId, kind, text, delivery, parentOperationId = null, deadlineAt }) {
    scope = validateScope(scope); turn = Object.freeze({ ...validateTurn(turn) });
    if (!['voice-agent-turn', 'voice-agent-steer', 'voice-agent-queue'].includes(kind) || typeof requestId !== 'string' || !requestId || requestId.length > 160
      || typeof text !== 'string' || !text.trim() || [...text].length > 2000 || Buffer.from(text).toString() !== text
      || !['prompt', 'steer', 'queue'].includes(delivery) || !Number.isSafeInteger(deadlineAt) || deadlineAt <= Date.now()
      || kind !== 'voice-agent-turn' && kind !== `voice-agent-${delivery}` || kind === 'voice-agent-turn' && requestId !== turn.requestId) fail('VOICE_CORE_ORIGINAL_INVALID');
    const proposed = Object.freeze({ operationId: voiceOperationId(scope, requestId, kind), requestId, kind, scope,
      turnGeneration: turn.generation, inputSha256: agentInputFingerprint({ scope, turn, text, delivery, parentOperationId }),
      parentOperationId, controlOperationId: null, control: null, deadlineAt, cpuIdentity: null });
    const binding = this.bindOriginal({ context, original: proposed });
    if (!binding?.owner || !binding.context || typeof binding.context !== 'object' || !Number.isSafeInteger(binding.deadlineAt) || binding.deadlineAt <= Date.now()) fail('VOICE_CORE_ORIGINAL_RESOURCE_REQUIRED');
    const original = Object.freeze({ ...proposed, deadlineAt: Math.min(deadlineAt, binding.deadlineAt) });
    const reserved = this.ledger.reserve(binding.context, original, binding.owner);
    if (!reserved.accepted || !reserved.fresh) fail('VOICE_DUPLICATE_OR_UNKNOWN');
    const handle = Object.freeze({ accepted: true, operationId: original.operationId, original: reserved.operation.original });
    this.#originals.set(handle, { binding, operation: reserved.operation, original }); return handle;
  }
  #owned(handle) { const retained = this.#originals.get(handle); if (!retained) fail('VOICE_CORE_ORIGINAL_HANDLE_REQUIRED'); return retained; }
  claim(handle) {
    const retained = this.#owned(handle), { binding, operation } = retained;
    retained.operation = this.ledger.cas(binding.context, { operationId: operation.original.operationId, expectedRevision: operation.revision,
      owner: binding.owner, from: 'reserved', to: 'running' });
  }
  retire(reservation, proof) {
    const { binding, original } = this.#owned(reservation);
    if (!proof || typeof proof !== 'object') fail('VOICE_ORIGINAL_RETIREMENT_REQUIRED');
    return this.ledger.retireOriginal(binding.context, { operationId: original.operationId, owner: binding.owner, physicalProof: proof });
  }
  isRetired(reservation) {
    const { binding, original } = this.#owned(reservation);
    const operation = this.ledger.read(binding.context, original.operationId);
    return Boolean(operation && sameScope(operation.original.scope, original.scope) && operation.retired === true && operation.retentionId);
  }
  settle({ reservation, outcome, result, proof }) {
    const retained = this.#owned(reservation), { binding, original } = retained;
    const operation = this.ledger.read(binding.context, original.operationId);
    if (!operation || !sameScope(operation.original.scope, original.scope)) fail('VOICE_CORE_ORIGINAL_UNAVAILABLE');
    if (outcome === 'unknown') {
      retained.operation = this.ledger.quarantine(binding.context, original.operationId, operation.revision, 'VOICE_NATIVE_OUTCOME_UNCERTAIN');
      return retained.operation;
    }
    if (outcome !== 'completed' || !proof || typeof proof !== 'object') fail('VOICE_ORIGINAL_RETIREMENT_REQUIRED');
    if (original.kind === 'voice-agent-turn' && (!sameScope(result?.scope, original.scope) || result.requestId !== original.requestId)) fail('VOICE_RESULT_SCOPE_MISMATCH');
    const fingerprint = original.kind === 'voice-agent-turn' ? agentResultFingerprint(result) : controlResultFingerprint(original.operationId);
    retained.operation = this.ledger.settle(binding.context, { operationId: original.operationId, expectedRevision: operation.revision,
      owner: binding.owner, from: operation.state, to: 'terminal', outcome: 'completed', resultFingerprint: fingerprint, proof });
    return retained.operation;
  }
}
