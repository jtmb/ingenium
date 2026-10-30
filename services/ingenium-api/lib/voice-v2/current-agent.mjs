import { createHash } from 'node:crypto';
import { VoiceError, sameScope, validateScope, validateTurn } from '../../../../packages/veyra-voice/session.mjs';
import { agentInputFingerprint } from './core-operations.mjs';
import { hostedOpenCodeLifecycle } from './hosted-lifecycle.mjs';

/** A stable native message ID, not a second operation ledger or conversation identity. */
export function nativeVoiceMessageId(scope, operationId) {
  const verified = validateScope(scope);
  if (typeof operationId !== 'string' || !operationId || operationId.length > 160) throw new VoiceError('VOICE_OPERATION_INVALID');
  const identity = ['actorId', 'accountId', 'organizationId', 'projectId', 'runtimeId', 'executionBindingId', 'executionRevision', 'conversationId', 'agentId'].map(key => verified[key]);
  return `msg_veyra_voice_${createHash('sha256').update(JSON.stringify([identity, operationId])).digest('hex')}`;
}

/** Consumer of the existing authenticated native request dispatcher and conversation event owner. */
export class CurrentAgentVoiceAdapter {
  #watches = new Map();
  #controls = new Map();
  constructor({ request, resolveBinding, withBinding, observeTurn, observeControl }) {
    Object.assign(this, { request, resolveBinding, withBinding, observeTurn, observeControl });
  }
  async #binding(context, scope, action, signal) {
    validateScope(scope); signal?.throwIfAborted();
    if (typeof this.resolveBinding !== 'function' || typeof this.request !== 'function' || typeof this.withBinding !== 'function') throw new VoiceError('VOICE_AGENT_BINDING_UNAVAILABLE');
    const binding = await this.resolveBinding({ context, scope, action, signal });
    if (!binding || binding.verified !== true || !sameScope(scope, binding.scope) || binding.sessionId !== scope.conversationId || typeof binding.directory !== 'string' || !binding.directory || binding.protocol !== 'opencode-v2.0.11') throw new VoiceError('VOICE_AGENT_BINDING_UNAVAILABLE');
    signal?.throwIfAborted(); return binding;
  }
  async #call(binding, path, options = {}) {
    const result = await this.withBinding(binding, () => this.request(path, options));
    if (result?.error) throw new VoiceError('VOICE_NATIVE_REQUEST_FAILED');
    return result;
  }
  #path(binding, suffix = '') { return `/api/session/${encodeURIComponent(binding.sessionId)}${suffix}`; }
  async #session(binding, scope, signal) {
    const result = await this.#call(binding, this.#path(binding), { signal });
    const session = result?.data;
    if (session?.id !== scope.conversationId || session.location?.directory !== binding.directory || session.agent !== scope.agentId || !session.model || typeof session.model.id !== 'string' || !session.model.id || typeof session.model.providerID !== 'string' || !session.model.providerID) throw new VoiceError('VOICE_AGENT_SESSION_UNAVAILABLE');
    return session;
  }
  async availability(context, scope, signal) {
    try {
      const binding = await this.#binding(context, scope, 'voice:inspect-agent', signal);
      await this.#session(binding, scope, signal);
      if (typeof this.observeTurn !== 'function') throw new VoiceError('VOICE_AGENT_OBSERVER_UNAVAILABLE');
      // The pinned public HTTP protocol lacks original-targeted settlement.
      // Merely injecting an event observer does not qualify that capability.
      return { state: 'unavailable', reason: hostedOpenCodeLifecycle.reason, scope, protocol: binding.protocol, duplex: 'half-duplex', preservesSessionModel: true };
    } catch (error) {
      return { state: 'unavailable', reason: error instanceof VoiceError ? error.code : 'VOICE_AGENT_UNAVAILABLE', duplex: 'half-duplex', preservesSessionModel: true };
    }
  }
  #metadata(scope, turn, operationId) {
    return { veyraVoice: { sessionId: turn.sessionId, requestId: turn.requestId, generation: turn.generation, executionRevision: scope.executionRevision, ...(operationId ? { operationId } : {}) } };
  }
  async #prompt(binding, scope, turn, { text, delivery, operationId, signal }) {
    const id = nativeVoiceMessageId(scope, operationId ?? turn.requestId);
    const body = { id, text, metadata: this.#metadata(scope, turn, operationId), ...(delivery === 'steer' || delivery === 'queue' ? { delivery } : {}) };
    const response = await this.#call(binding, this.#path(binding, '/prompt'), { method: 'POST', body, signal });
    const admitted = response?.data;
    if (admitted?.id !== id || admitted.sessionID !== binding.sessionId || (delivery !== 'prompt' && admitted.delivery !== delivery)) throw new VoiceError('VOICE_NATIVE_ADMISSION_UNKNOWN');
    return id;
  }
  async submit({ context, scope, turn, text, delivery, signal, onEvent, originalOperation }) {
    validateTurn(turn);
    if (!['prompt', 'steer', 'queue'].includes(delivery) || typeof text !== 'string' || !text.trim() || [...text].length > 2000) throw new VoiceError('VOICE_TURN_INVALID');
    const binding = await this.#binding(context, scope, 'agent:prompt', signal);
    await this.#session(binding, scope, signal);
    if (typeof this.observeTurn !== 'function') throw new VoiceError('VOICE_AGENT_OBSERVER_UNAVAILABLE');
    if (originalOperation && (!sameScope(originalOperation.scope, scope) || originalOperation.requestId !== turn.requestId
      || originalOperation.turnGeneration !== turn.generation || originalOperation.kind !== 'voice-agent-turn'
      || originalOperation.inputSha256 !== agentInputFingerprint({ scope, turn, text, delivery, parentOperationId: originalOperation.parentOperationId }))) throw new VoiceError('VOICE_CORE_ORIGINAL_CONFLICT');
    const promptId = nativeVoiceMessageId(scope, originalOperation?.operationId ?? turn.requestId);
    const key = nativeVoiceMessageId(scope, turn.requestId);
    if (this.#watches.has(key)) throw new VoiceError('VOICE_TURN_CONFLICT');
    const watch = await this.observeTurn({ context, scope, turn, originalOperation, nativeSessionId: binding.sessionId, promptId, signal,
      onEvent: event => {
        if (signal?.aborted || !sameScope(event?.scope, scope) || event.nativeSessionId !== binding.sessionId || event.promptId !== promptId) return;
        if (event.type === 'tool') onEvent?.({ ...turn, scope, type: 'tool', callId: event.callId, label: event.label, status: event.status });
        else if (event.type === 'approval') onEvent?.({ ...turn, scope, type: 'approval', approvalId: event.approvalId, label: event.label });
      } });
    Promise.resolve(watch?.result).catch(() => undefined);
    Promise.resolve(watch?.ready).catch(() => undefined);
    if (!watch || typeof watch.ready?.then !== 'function' || typeof watch.result?.then !== 'function' || typeof watch.stop !== 'function' || typeof watch.ownsPermission !== 'function' || typeof watch.ownsExecution !== 'function') { watch?.stop?.(); throw new VoiceError('VOICE_AGENT_OBSERVER_UNAVAILABLE'); }
    if (originalOperation && typeof watch.retirement?.then !== 'function') { watch.stop(); throw new VoiceError('VOICE_ORIGINAL_RETIREMENT_UNAVAILABLE'); }
    watch.retirement?.catch(() => undefined);
    const record = { watch, voiceSessionId: turn.sessionId, scope, originalOperation };
    this.#watches.set(key, record);
    // The existing event owner subscribes before durable admission, as useOpenCodeChat does.
    void watch.result.catch(() => undefined);
    try {
      await watch.ready; signal?.throwIfAborted();
      await this.#prompt(binding, scope, turn, { text, delivery, operationId: originalOperation?.operationId, signal });
      const result = await watch.result;
      signal?.throwIfAborted();
      if (!sameScope(result?.scope, scope) || result.nativeSessionId !== binding.sessionId || result.promptId !== promptId || result.outcome !== 'succeeded' || typeof result.text !== 'string' || !result.text.trim() || [...result.text].length > 32000) throw new VoiceError('VOICE_NATIVE_TURN_OUTCOME_UNKNOWN');
      const retirementProof = originalOperation ? await watch.retirement : undefined;
      if (originalOperation && (!retirementProof || typeof retirementProof !== 'object')) throw new VoiceError('VOICE_ORIGINAL_RETIREMENT_UNAVAILABLE');
      return { scope, requestId: turn.requestId, text: result.text, ...(retirementProof ? { retirementProof } : {}), ...(result.usage === undefined ? {} : { usage: result.usage }) };
    } finally {
      // A returned/failed HTTP consumer is not the original's retirement.
      // Core-backed resources remain captured until the caller's real Core
      // verifier accepts the proof and explicitly finalizes this same original.
      if (!originalOperation) { if (this.#watches.get(key) === record) this.#watches.delete(key); watch.stop(); }
    }
  }
  async steer({ context, scope, turn, text, delivery, operationId, signal, originalOperation }) {
    validateTurn(turn);
    if (!['steer', 'queue'].includes(delivery) || typeof text !== 'string' || !text.trim() || [...text].length > 2000 || typeof operationId !== 'string' || !operationId.startsWith(`voice-control:${turn.sessionId}:`)) throw new VoiceError('VOICE_STEERING_INVALID');
    const binding = await this.#binding(context, scope, `agent:${delivery}`, signal);
    await this.#session(binding, scope, signal);
    let observation;
    if (originalOperation) {
      if (!sameScope(originalOperation.scope, scope) || originalOperation.requestId !== operationId || originalOperation.turnGeneration !== turn.generation
        || originalOperation.kind !== `voice-agent-${delivery}` || originalOperation.inputSha256 !== agentInputFingerprint({ scope, turn, text, delivery, parentOperationId: originalOperation.parentOperationId })
        || typeof this.observeControl !== 'function') throw new VoiceError('VOICE_ORIGINAL_RETIREMENT_UNAVAILABLE');
      if (this.#controls.has(originalOperation.operationId)) throw new VoiceError('VOICE_TURN_CONFLICT');
      observation = await this.observeControl({ context, scope, turn, originalOperation, nativeSessionId: binding.sessionId,
        promptId: nativeVoiceMessageId(scope, originalOperation.operationId), signal });
      if (typeof observation?.ready?.then !== 'function' || typeof observation?.retirement?.then !== 'function' || typeof observation?.stop !== 'function') {
        observation?.stop?.(); throw new VoiceError('VOICE_ORIGINAL_RETIREMENT_UNAVAILABLE');
      }
      observation.retirement.catch(() => undefined);
      this.#controls.set(originalOperation.operationId, { watch: observation, originalOperation, voiceSessionId: turn.sessionId, scope });
    }
    let retirementProof;
    try {
      if (observation) { await observation.ready; signal?.throwIfAborted(); }
      await this.#prompt(binding, scope, turn, { text, delivery, operationId: originalOperation?.operationId ?? operationId, signal });
      if (observation) { retirementProof = await observation.retirement; if (!retirementProof || typeof retirementProof !== 'object') throw new VoiceError('VOICE_ORIGINAL_RETIREMENT_UNAVAILABLE'); }
    } finally { if (!originalOperation) observation?.stop(); }
    // Acceptance means durable inbox admission, never a completed tool/job claim.
    return { accepted: true, requestId: turn.requestId, operationId, scope, ...(retirementProof ? { retirementProof } : {}) };
  }
  async approve({ context, scope, turn, approvalId, decision, signal }) {
    validateTurn(turn);
    if (!['allow-once', 'deny'].includes(decision) || typeof approvalId !== 'string' || !approvalId || approvalId.length > 256) throw new VoiceError('VOICE_APPROVAL_INVALID');
    const binding = await this.#binding(context, scope, 'agent:approve', signal);
    const watch = this.#watches.get(nativeVoiceMessageId(scope, turn.requestId))?.watch;
    if (!watch?.ownsPermission(approvalId)) throw new VoiceError('VOICE_APPROVAL_INVALID');
    const path = this.#path(binding, `/permission/${encodeURIComponent(approvalId)}`);
    const pending = await this.#call(binding, path, { signal });
    if (pending?.data?.id !== approvalId || pending.data.sessionID !== binding.sessionId) throw new VoiceError('VOICE_APPROVAL_INVALID');
    await this.#call(binding, `${path}/reply`, { method: 'POST', body: { decision: decision === 'allow-once' ? 'once' : 'reject' }, signal });
  }
  async #ownedInbox(binding, scope, sessionId, requestId, signal) {
    const response = await this.#call(binding, this.#path(binding, '/inbox'), { signal });
    if (!Array.isArray(response?.data) || response.data.length > 128) throw new VoiceError('VOICE_NATIVE_INBOX_UNKNOWN');
    return response.data.filter(item => {
      const metadata = item?.payload?.metadata?.veyraVoice;
      return item.sessionID === binding.sessionId && metadata?.sessionId === sessionId && metadata.executionRevision === scope.executionRevision && (requestId === undefined || metadata.requestId === requestId);
    });
  }
  async #cancelInbox(binding, scope, sessionId, requestId, signal) {
    for (const item of await this.#ownedInbox(binding, scope, sessionId, requestId, signal)) {
      const metadata = item.payload.metadata.veyraVoice;
      if (item.id !== nativeVoiceMessageId(scope, metadata.operationId ?? metadata.requestId)) throw new VoiceError('VOICE_NATIVE_INBOX_UNKNOWN');
      await this.#call(binding, this.#path(binding, `/inbox/${encodeURIComponent(item.id)}`), { method: 'DELETE', signal });
    }
  }
  async interrupt({ context, scope, turn, signal, originalOperation }) {
    validateTurn(turn);
    if (originalOperation) {
      const record = this.#watches.get(nativeVoiceMessageId(scope, turn.requestId));
      // Public session.interrupt acknowledges acceptance before finalizers. It
      // cannot target this retained original and must never be its fallback.
      if (!record || record.originalOperation !== originalOperation || !sameScope(record.scope, scope)
        || typeof record.watch.interruptOriginal !== 'function') throw new VoiceError('VOICE_ORIGINAL_INTERRUPT_UNAVAILABLE');
      const retirementProof = await record.watch.interruptOriginal({ signal });
      if (!retirementProof || typeof retirementProof !== 'object') throw new VoiceError('VOICE_ORIGINAL_RETIREMENT_UNAVAILABLE');
      // VoiceService submits this opaque proof to the actual Core verifier;
      // this acknowledgement alone grants no retirement or next-turn admission.
      return { acknowledged: true, requestId: turn.requestId, scope, retirementProof };
    }
    const binding = await this.#binding(context, scope, 'agent:interrupt', signal);
    await this.#cancelInbox(binding, scope, turn.sessionId, turn.requestId, signal);
    const before = await this.#call(binding, '/api/session/active', { signal });
    if (!before?.data || typeof before.data !== 'object' || Array.isArray(before.data)) throw new VoiceError('VOICE_INTERRUPT_UNKNOWN');
    const running = before.data[binding.sessionId]?.type === 'running';
    if (Object.hasOwn(before.data, binding.sessionId) && !running) throw new VoiceError('VOICE_INTERRUPT_UNKNOWN');
    const watch = this.#watches.get(nativeVoiceMessageId(scope, turn.requestId))?.watch;
    if (running && watch?.ownsExecution() !== true) throw new VoiceError('VOICE_INTERRUPT_OWNERSHIP_UNKNOWN');
    const interrupted = await this.#call(binding, this.#path(binding, '/interrupt'), { method: 'POST', query: { resume: 'false' }, signal });
    if (typeof interrupted?.interrupted !== 'boolean') throw new VoiceError('VOICE_INTERRUPT_UNKNOWN');
    const active = await this.#call(binding, '/api/session/active', { signal });
    if (!active?.data || typeof active.data !== 'object' || Array.isArray(active.data) || Object.hasOwn(active.data, binding.sessionId)) throw new VoiceError('VOICE_INTERRUPT_UNKNOWN');
    if ((await this.#ownedInbox(binding, scope, turn.sessionId, turn.requestId, signal)).length) throw new VoiceError('VOICE_NATIVE_INBOX_UNKNOWN');
    return { acknowledged: true, requestId: turn.requestId, scope };
  }
  async closeVoice({ context, scope, sessionId }) {
    if ([...this.#watches.values(), ...this.#controls.values()].some(record => record.originalOperation
      && record.voiceSessionId === sessionId && sameScope(record.scope, scope))) throw new VoiceError('VOICE_ORIGINAL_RETIREMENT_UNCONFIRMED');
    const binding = await this.#binding(context, scope, 'voice:close');
    await this.#cancelInbox(binding, scope, sessionId);
    if ((await this.#ownedInbox(binding, scope, sessionId)).length) throw new VoiceError('VOICE_NATIVE_INBOX_UNKNOWN');
    for (const [key, record] of this.#watches) {
      if (record.voiceSessionId === sessionId && sameScope(record.scope, scope)) { record.watch.stop(); this.#watches.delete(key); }
    }
    // The caller already fences/interrupts its active turn. Never delete the working engine session.
  }
  /** Call only AFTER the actual Core verifier accepted this original's proof.
   * This releases local retained handles; it does not create physical proof. */
  async finalizeOriginal(originalOperation) {
    const control = this.#controls.get(originalOperation.operationId);
    const key = nativeVoiceMessageId(originalOperation.scope, originalOperation.requestId);
    const record = control ?? this.#watches.get(key);
    if (!record || record.originalOperation !== originalOperation) throw new VoiceError('VOICE_ORIGINAL_HANDLE_UNAVAILABLE');
    await record.watch.stop();
    if (control) this.#controls.delete(originalOperation.operationId);
    else if (this.#watches.get(key) === record) this.#watches.delete(key);
  }
}
