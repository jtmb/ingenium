import { VoiceError, sameScope, validateScope, validateTurn } from '../../../../packages/veyra-voice/session.mjs';

/** Authenticated API adapter; identity, durable admission and native agent authority are injected. */
export class VoiceService {
  #sessions = new Map();
  constructor({ authorize, speech, agent, operations, now = Date.now, maxSessions = 16, ttlMs = 1800000 }) {
    if (typeof authorize !== 'function' || typeof operations?.reserve !== 'function' || typeof operations?.settle !== 'function' || !agent || !speech || !Number.isInteger(maxSessions) || maxSessions < 1 || maxSessions > 64 || !Number.isFinite(ttlMs) || ttlMs < 1000 || ttlMs > 1800000) throw new VoiceError('VOICE_SERVICE_CONFIG_INVALID');
    Object.assign(this, { authorize, speech, agent, operations, now, maxSessions, ttlMs });
  }
  async open(context, { scope, mode, sessionId }, signal) {
    const validated = validateScope(scope);
    if (!['dictation', 'agent-call', 'conversation'].includes(mode) || typeof sessionId !== 'string' || !sessionId || sessionId.length > 128) throw new VoiceError('VOICE_SESSION_INVALID');
    const access = await this.authorize(context, validated, 'voice:connect', signal);
    if (!access?.allowed || !sameScope(access.scope, validated)) throw new VoiceError('VOICE_FORBIDDEN');
    if (this.#sessions.has(sessionId)) throw new VoiceError('VOICE_SESSION_CONFLICT');
    if (this.#sessions.size >= this.maxSessions) throw new VoiceError('VOICE_CAPACITY');
    // Reserve before asynchronous health checks so concurrent opens cannot exceed capacity.
    const session = { scope: validated, mode, expires: this.now() + this.ttlMs, generation: -1, lastTurn: 0, lastTranscribed: 0, recognizing: null, speaking: false, speechRequested: false, agentCompleted: false, resultText: null, active: null, state: 'opening' };
    this.#sessions.set(sessionId, session);
    try {
      await this.speech.health(signal); signal?.throwIfAborted();
      if (this.#sessions.get(sessionId) !== session || session.state !== 'opening' || session.expires <= this.now()) throw new VoiceError('VOICE_SCOPE_EXPIRED');
      session.state = 'ready';
    } catch (error) { if (this.#sessions.get(sessionId) === session) this.#sessions.delete(sessionId); throw error; }
    return { allowed: true, scope: validated, sessionId, mode, expiresAt: session.expires };
  }
  async #admit(context, envelope, capability) {
    const turn = validateTurn(envelope.turn);
    const session = this.#sessions.get(turn.sessionId);
    if (!session || session.state !== 'ready' || session.expires <= this.now() || !sameScope(session.scope, envelope.scope)) throw new VoiceError('VOICE_SCOPE_EXPIRED');
    const access = await this.authorize(context, session.scope, capability, envelope.signal);
    if (!access?.allowed || !sameScope(access.scope, session.scope)) throw new VoiceError('VOICE_FORBIDDEN');
    if (this.#sessions.get(envelope.turn.sessionId) !== session || session.state !== 'ready' || session.expires <= this.now()) throw new VoiceError('VOICE_SCOPE_EXPIRED');
    envelope.signal?.throwIfAborted();
    if (session.active && !['agent:prompt', 'voice:transcribe'].includes(capability) && (session.active.turnId !== turn.turnId || session.active.generation !== turn.generation || session.active.requestId !== turn.requestId)) throw new VoiceError('VOICE_TURN_CONFLICT');
    return session;
  }
  async transcribe(context, envelope) {
    const session = await this.#admit(context, envelope, 'voice:transcribe');
    if (session.active || session.recognizing || envelope.turn.turnId <= session.lastTranscribed || envelope.turn.generation < session.generation) throw new VoiceError('VOICE_TURN_CONFLICT');
    session.lastTranscribed = envelope.turn.turnId; session.recognizing = envelope.turn;
    try { return await this.speech.transcribe(envelope); }
    finally { if (session.recognizing === envelope.turn) session.recognizing = null; }
  }
  async resume(context, { sessionId, scope, mode }, signal) {
    const session = this.#sessions.get(sessionId);
    if (!session || session.state !== 'ready' || session.active || session.mode !== mode || session.expires <= this.now() || !sameScope(scope, session.scope)) throw new VoiceError('VOICE_RECONNECT_REJECTED');
    const access = await this.authorize(context, session.scope, 'voice:connect', signal);
    if (!access?.allowed || !sameScope(access.scope, session.scope)) throw new VoiceError('VOICE_FORBIDDEN');
    await this.speech.health(signal);
    if (this.#sessions.get(sessionId) !== session || session.state !== 'ready' || session.active || session.expires <= this.now()) throw new VoiceError('VOICE_RECONNECT_REJECTED');
    return { allowed: true, scope: session.scope, sessionId, mode, expiresAt: session.expires };
  }
  async submit(context, envelope) {
    const session = await this.#admit(context, envelope, 'agent:prompt');
    if (session.mode === 'dictation' || !['prompt', 'steer', 'queue'].includes(envelope.delivery) || typeof envelope.text !== 'string' || !envelope.text.trim() || [...envelope.text].length > 2000) throw new VoiceError('VOICE_TURN_INVALID');
    const { turn } = envelope;
    if (session.active || session.recognizing || turn.turnId <= session.lastTurn || turn.generation < session.generation) throw new VoiceError('VOICE_TURN_CONFLICT');
    session.lastTurn = turn.turnId; session.generation = turn.generation; session.active = turn;
    session.agentCompleted = false; session.resultText = null; session.speechRequested = false;
    let reservation, settled = false;
    try {
      // The coordinator binds the existing durable operation ledger, including cold-restart deduplication.
      reservation = await this.operations.reserve({ context, scope: session.scope, requestId: turn.requestId, kind: 'voice-agent-turn' });
      if (reservation?.accepted !== true) throw new VoiceError('VOICE_DUPLICATE_OR_UNKNOWN');
      if (session.active !== turn) throw new VoiceError('VOICE_TURN_CANCELLED');
      const result = await this.agent.submit({ ...envelope, context, scope: session.scope, onEvent: event => {
        if (session.active === turn && !envelope.signal?.aborted && sameScope(event.scope, session.scope) && event.requestId === turn.requestId) envelope.onEvent?.({ ...event, ...turn, scope: session.scope });
      } });
      if (session.active !== turn || envelope.signal?.aborted) throw new VoiceError('VOICE_TURN_CANCELLED');
      if (!sameScope(result.scope, session.scope) || result.requestId !== turn.requestId || typeof result.text !== 'string' || [...result.text].length > 32000) throw new VoiceError('VOICE_RESULT_SCOPE_MISMATCH');
      await this.operations.settle({ context, scope: session.scope, requestId: turn.requestId, outcome: 'completed', usage: result.usage });
      settled = true;
      if (session.active !== turn || envelope.signal?.aborted) throw new VoiceError('VOICE_TURN_CANCELLED');
      session.agentCompleted = true; session.resultText = result.text;
      return result;
    } catch (error) {
      if (reservation?.accepted === true && !settled) await this.operations.settle({ context, scope: session.scope, requestId: turn.requestId, outcome: 'unknown' });
      throw error;
    }
  }
  async synthesize(context, envelope) {
    const session = await this.#admit(context, envelope, 'voice:speak');
    if (session.active?.requestId !== envelope.turn.requestId || !session.agentCompleted || envelope.text !== session.resultText || session.speechRequested) throw new VoiceError('VOICE_TURN_CONFLICT');
    session.speaking = true; session.speechRequested = true;
    try { return await this.speech.synthesize(envelope); }
    finally { session.speaking = false; }
  }
  async approve(context, envelope) {
    const session = await this.#admit(context, envelope, 'agent:approve');
    if (session.active?.requestId !== envelope.turn.requestId || !['allow-once', 'deny'].includes(envelope.decision) || typeof envelope.approvalId !== 'string' || !envelope.approvalId) throw new VoiceError('VOICE_APPROVAL_INVALID');
    return this.agent.approve({ ...envelope, context, scope: session.scope });
  }
  async steer(context, envelope) {
    const session = await this.#admit(context, envelope, envelope.delivery === 'queue' ? 'agent:queue' : 'agent:steer');
    if (session.active?.requestId !== envelope.turn.requestId || !['steer', 'queue'].includes(envelope.delivery) || typeof envelope.text !== 'string' || !envelope.text.trim() || [...envelope.text].length > 2000) throw new VoiceError('VOICE_STEERING_INVALID');
    const prefix = `voice-control:${envelope.turn.sessionId}:`;
    const suffix = typeof envelope.operationId === 'string' && envelope.operationId.startsWith(prefix) ? envelope.operationId.slice(prefix.length) : '';
    const sequence = Number(suffix);
    if (!suffix || !Number.isSafeInteger(sequence) || sequence < 1 || String(sequence) !== suffix || envelope.operationId.length > 160) throw new VoiceError('VOICE_STEERING_INVALID');
    const reservation = await this.operations.reserve({ context, scope: session.scope, requestId: envelope.operationId, parentRequestId: envelope.turn.requestId, kind: `voice-agent-${envelope.delivery}` });
    if (reservation?.accepted !== true) throw new VoiceError('VOICE_DUPLICATE_OR_UNKNOWN');
    let settled = false;
    try {
      if (session.active?.requestId !== envelope.turn.requestId) throw new VoiceError('VOICE_TURN_CANCELLED');
      const ack = await this.agent.steer({ ...envelope, context, scope: session.scope });
      if (ack?.accepted !== true || ack.requestId !== envelope.turn.requestId || !sameScope(ack.scope, session.scope)) throw new VoiceError('VOICE_STEERING_OUTCOME_UNKNOWN');
      await this.operations.settle({ context, scope: session.scope, requestId: envelope.operationId, outcome: 'completed' }); settled = true;
      return { ...ack, operationId: envelope.operationId };
    } catch (error) {
      if (!settled) await this.operations.settle({ context, scope: session.scope, requestId: envelope.operationId, outcome: 'unknown' });
      throw error;
    }
  }
  async interrupt(context, envelope) {
    const session = await this.#admit(context, envelope, 'agent:interrupt');
    if (session.active?.requestId !== envelope.turn.requestId) throw new VoiceError('VOICE_TURN_CONFLICT');
    session.active = null;
    session.resultText = null;
    session.state = 'interrupting';
    try {
      const ack = await this.agent.interrupt({ ...envelope, context, scope: session.scope });
      if (ack?.acknowledged !== true || ack.requestId !== envelope.turn.requestId || !sameScope(ack.scope, session.scope)) throw new VoiceError('VOICE_INTERRUPT_UNKNOWN');
      if (this.#sessions.get(envelope.turn.sessionId) !== session || session.state !== 'interrupting') throw new VoiceError('VOICE_SCOPE_EXPIRED');
      session.state = 'ready';
      return ack;
    } catch (error) { session.state = 'retired'; throw error; }
  }
  async complete(context, envelope) {
    const session = await this.#admit(context, envelope, 'voice:speak');
    if (session.active?.requestId !== envelope.turn.requestId || !session.agentCompleted || session.speaking) throw new VoiceError('VOICE_TURN_CONFLICT');
    session.active = null; session.resultText = null;
  }
  async close(context, { sessionId, scope }) {
    const session = this.#sessions.get(sessionId); if (!session) return;
    if (!sameScope(scope, session.scope)) throw new VoiceError('VOICE_SCOPE_INVALID');
    const access = await this.authorize(context, session.scope, 'voice:close');
    if (!access?.allowed || !sameScope(access.scope, session.scope)) throw new VoiceError('VOICE_FORBIDDEN');
    session.state = 'retired';
    // Native agent cleanup is scope-specific; this does not delete the working conversation.
    await this.agent.closeVoice({ context, scope: session.scope, sessionId });
    if (this.#sessions.get(sessionId) === session) this.#sessions.delete(sessionId);
  }
  async expire() {
    const expired = [...this.#sessions].filter(([, session]) => session.expires <= this.now());
    const results = [];
    for (const [sessionId, session] of expired) {
      session.state = 'retired';
      try {
        await this.agent.closeVoice({ scope: session.scope, sessionId, reason: 'expired' });
        if (this.#sessions.get(sessionId) === session) this.#sessions.delete(sessionId);
        results.push({ sessionId, closed: true });
      } catch { results.push({ sessionId, closed: false, code: 'VOICE_CLEANUP_UNKNOWN' }); }
    }
    return results;
  }
}
