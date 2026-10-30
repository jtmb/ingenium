const scopeKeys = ['actorId', 'accountId', 'organizationId', 'projectId', 'conversationId', 'runtimeId', 'executionBindingId', 'executionRevision', 'agentId'];
const nullable = new Set(['organizationId', 'projectId']);

export class VoiceError extends Error {
  constructor(code) { super(code); this.code = code; }
}

export function validateScope(scope) {
  if (!scope || Object.keys(scope).sort().join() !== [...scopeKeys].sort().join()) throw new VoiceError('VOICE_SCOPE_INVALID');
  for (const key of scopeKeys) {
    const value = scope[key];
    if (nullable.has(key) && value === null) continue;
    if (typeof value !== 'string' || !value.trim() || value.length > 256) throw new VoiceError('VOICE_SCOPE_INVALID');
  }
  return Object.freeze({ ...scope });
}

export function sameScope(a, b) {
  return Boolean(a && b && scopeKeys.every(key => a[key] === b[key]) && Object.keys(b).length === scopeKeys.length);
}

export function validateTurn(turn) {
  if (!turn || Object.keys(turn).sort().join() !== 'generation,requestId,sessionId,turnId' || typeof turn.sessionId !== 'string' || !turn.sessionId || turn.sessionId.length > 128 || !Number.isSafeInteger(turn.turnId) || turn.turnId < 1 || !Number.isSafeInteger(turn.generation) || turn.generation < 0 || turn.requestId !== `voice:${turn.sessionId}:${turn.turnId}` || turn.requestId.length > 160) throw new VoiceError('VOICE_TURN_INVALID');
  return turn;
}

function boundedText(text, max = 2000) {
  if (typeof text !== 'string' || !text.trim() || [...text].length > max) throw new VoiceError('VOICE_TEXT_INVALID');
  return text.trim();
}

async function interruptWithDeadline(port, request, timeoutMs) {
  const controller = new AbortController();
  let timer;
  try {
    return await Promise.race([
      Promise.resolve().then(() => port({ ...request, signal: controller.signal })),
      new Promise((_, reject) => { timer = setTimeout(() => { controller.abort(); reject(new VoiceError('VOICE_INTERRUPT_UNKNOWN')); }, timeoutMs); }),
    ]);
  } finally { clearTimeout(timer); }
}

/** Volatile orchestration only. The existing conversation API remains the transcript writer. */
export class VoiceSession {
  #listeners = new Set();
  #active;
  #generation = 0;
  #counter = 0;
  #controlCounter = 0;
  #steeringUnknown = false;
  #connection = 0;
  #connecting;
  #interrupting;
  #closed = false;
  #ending;
  #snapshot;

  constructor({ scope, mode, sessionId, ports, interruptDeadlineMs = 3000 }) {
    this.scope = validateScope(scope);
    if (!['dictation', 'agent-call', 'conversation'].includes(mode) || typeof sessionId !== 'string' || !sessionId || sessionId.length > 128) throw new VoiceError('VOICE_SESSION_INVALID');
    if (!Number.isInteger(interruptDeadlineMs) || interruptDeadlineMs < 1 || interruptDeadlineMs > 3000) throw new VoiceError('VOICE_SESSION_INVALID');
    this.mode = mode; this.sessionId = sessionId; this.ports = ports;
    this.interruptDeadlineMs = interruptDeadlineMs;
    this.#snapshot = Object.freeze({ phase: 'disconnected', muted: true, transcript: '', reply: '', tools: [], approval: null, error: null, generation: 0 });
  }

  subscribe = listener => { this.#listeners.add(listener); return () => this.#listeners.delete(listener); };
  getSnapshot = () => this.#snapshot;
  reportError(code) { this.#set({ error: typeof code === 'string' && code.length <= 128 ? code : 'VOICE_DEVICE_FAILED' }); }
  #set(patch) {
    this.#snapshot = Object.freeze({ ...this.#snapshot, ...patch, generation: this.#generation });
    for (const listener of this.#listeners) listener();
  }
  #current(turn) { return !this.#closed && this.#active?.turn === turn && turn.generation === this.#generation; }

  async connect() {
    if (this.#closed || this.#connecting || !['disconnected', 'reconnecting'].includes(this.#snapshot.phase)) throw new VoiceError('VOICE_CONNECTION_INVALID');
    const epoch = ++this.#connection;
    const controller = new AbortController(); this.#connecting = controller;
    this.#set({ phase: 'connecting', muted: true, error: null });
    try {
      const grant = await this.ports.connect({ scope: this.scope, mode: this.mode, sessionId: this.sessionId, signal: controller.signal });
      if (this.#closed || epoch !== this.#connection) return false;
      if (!sameScope(this.scope, grant.scope) || grant.sessionId !== this.sessionId || grant.allowed !== true) throw new VoiceError('VOICE_FORBIDDEN');
      this.#set({ phase: 'ready', muted: false }); return true;
    } catch (error) {
      if (!this.#closed && epoch === this.#connection) this.#set({ phase: 'disconnected', muted: true, error: error instanceof VoiceError ? error.code : 'VOICE_CONNECT_FAILED' });
      throw error;
    } finally { if (this.#connecting === controller) this.#connecting = undefined; }
  }

  async receive(pcm) {
    if (!(pcm instanceof Uint8Array) || pcm.byteLength < 8000 || pcm.byteLength > 480000 || pcm.byteLength % 2) throw new VoiceError('VOICE_PCM_INVALID');
    return this.#run(async active => {
      this.#set({ phase: 'transcribing' });
      const result = await this.ports.transcribe({ pcm, scope: this.scope, turn: active.turn, signal: active.controller.signal });
      if (!this.#current(active.turn)) return null;
      if (result.text === '') return null;
      return boundedText(result.text);
    }, 'prompt');
  }

  async sendText(text, delivery = 'prompt') {
    const value = boundedText(text);
    if (!['prompt', 'steer', 'queue'].includes(delivery) || (this.mode === 'dictation' && delivery !== 'prompt')) throw new VoiceError('VOICE_DELIVERY_INVALID');
    if (this.#active && delivery !== 'prompt') {
      const active = this.#active;
      if (this.#steeringUnknown) throw new VoiceError('VOICE_STEERING_OUTCOME_UNKNOWN');
      const operationId = `voice-control:${this.sessionId}:${++this.#controlCounter}`;
      try {
        const ack = await this.ports.steer({ scope: this.scope, turn: active.turn, operationId, text: value, delivery, signal: active.controller.signal });
        if (!sameScope(this.scope, ack.scope) || ack.requestId !== active.turn.requestId || ack.operationId !== operationId || ack.accepted !== true) throw new VoiceError('VOICE_STEERING_OUTCOME_UNKNOWN');
      } catch {
        if (this.#current(active.turn)) { this.#steeringUnknown = true; this.reportError('VOICE_STEERING_OUTCOME_UNKNOWN'); }
        throw new VoiceError('VOICE_STEERING_OUTCOME_UNKNOWN');
      }
      return;
    }
    if (this.#active) await this.interrupt();
    return this.#run(async () => value, delivery);
  }

  async #run(transcript, delivery) {
    if (this.#closed || this.#interrupting || this.#snapshot.muted || this.#snapshot.phase !== 'ready') throw new VoiceError('VOICE_NOT_READY');
    const turn = Object.freeze({ sessionId: this.sessionId, turnId: ++this.#counter, generation: this.#generation, requestId: `voice:${this.sessionId}:${this.#counter}` });
    const active = { turn, controller: new AbortController(), submitted: false }; this.#active = active;
    this.#steeringUnknown = false;
    this.#set({ phase: 'transcribing', transcript: '', reply: '', tools: [], approval: null, error: null });
    try {
      const text = await transcript(active);
      if (!this.#current(turn) || text === null) return;
      this.#set({ transcript: text });
      if (this.mode === 'dictation') {
        await this.ports.dictation({ scope: this.scope, turn, text, signal: active.controller.signal }); return;
      }
      this.#set({ phase: 'thinking' }); active.submitted = true;
      const result = await this.ports.submit({ scope: this.scope, turn, text, delivery, signal: active.controller.signal, onEvent: event => this.acceptEvent(event) });
      if (!this.#current(turn)) return;
      if (!sameScope(this.scope, result.scope) || result.requestId !== turn.requestId) throw new VoiceError('VOICE_RESULT_SCOPE_MISMATCH');
      boundedText(result.text, 32000);
      const reply = result.text;
      this.#set({ reply, phase: 'synthesizing', approval: null });
      if (typeof this.ports.speechSequence === 'function') {
        for await (const child of this.ports.speechSequence({ scope: this.scope, turn, text: result.text, signal: active.controller.signal })) {
          if (!this.#current(turn)) return;
          if (child.operation?.parentRequestId !== turn.requestId || child.operation.generation !== turn.generation) throw new VoiceError('VOICE_RESULT_SCOPE_MISMATCH');
          this.#set({ phase: 'speaking' });
          await this.ports.play({ wav: child.wav, turn, speechOperation: child.operation, segment: child.segment, signal: active.controller.signal });
          if (!this.#current(turn)) return;
          this.#set({ phase: 'synthesizing' });
        }
      } else {
        const wav = await this.ports.synthesize({ scope: this.scope, turn, text: result.text, signal: active.controller.signal });
        if (!this.#current(turn)) return;
        this.#set({ phase: 'speaking' });
        await this.ports.play({ wav, turn, signal: active.controller.signal });
      }
      if (this.#current(turn)) await this.ports.complete({ scope: this.scope, turn, signal: active.controller.signal });
    } catch (error) {
      if (this.#current(turn)) this.#set({ error: error instanceof VoiceError ? error.code : 'VOICE_TURN_FAILED' });
      // A transport failure after submission cannot prove that the agent stopped.
      if (this.#current(turn) && active.submitted) await this.interrupt();
    } finally {
      if (this.#current(turn)) { this.#active = undefined; this.#generation++; this.#set({ phase: 'ready', approval: null }); }
    }
  }

  acceptEvent(event) {
    const turn = this.#active?.turn;
    if (!turn || !sameScope(this.scope, event.scope) || event.sessionId !== turn.sessionId || event.turnId !== turn.turnId || event.generation !== turn.generation || event.requestId !== turn.requestId) return false;
    if (event.type === 'transcript.partial' && typeof event.text === 'string' && event.text.length <= 4000) this.#set({ transcript: event.text });
    else if (event.type === 'tool' && typeof event.callId === 'string' && typeof event.label === 'string' && ['running', 'completed', 'failed'].includes(event.status)) {
      const tools = this.#snapshot.tools.filter(tool => tool.callId !== event.callId).slice(-31);
      this.#set({ tools: [...tools, { callId: event.callId.slice(0, 256), label: event.label.slice(0, 160), status: event.status }] });
    } else if (event.type === 'approval' && typeof event.approvalId === 'string' && typeof event.label === 'string') this.#set({ approval: { id: event.approvalId, label: event.label.slice(0, 256) } });
    else return false;
    return true;
  }

  async decideApproval(decision) {
    const approval = this.#snapshot.approval, active = this.#active;
    if (!approval || !active || !['allow-once', 'deny'].includes(decision)) throw new VoiceError('VOICE_APPROVAL_INVALID');
    this.#set({ approval: null });
    try { await this.ports.approve({ scope: this.scope, turn: active.turn, approvalId: approval.id, decision, signal: active.controller.signal }); }
    catch { if (this.#current(active.turn)) { this.#set({ error: 'VOICE_APPROVAL_OUTCOME_UNKNOWN' }); await this.interrupt(); } }
  }

  async interrupt() {
    if (this.#interrupting) return this.#interrupting;
    const active = this.#active;
    this.#generation++; this.#active = undefined;
    active?.controller.abort(); this.ports.stopPlayback();
    this.#set({ phase: 'interrupting', approval: null });
    this.#interrupting = (async () => {
      await Promise.resolve();
      try {
        if (active?.submitted) {
          const ack = await interruptWithDeadline(request => this.ports.interrupt(request), { scope: this.scope, turn: active.turn }, this.interruptDeadlineMs);
          if (ack?.acknowledged !== true || ack.requestId !== active.turn.requestId || !sameScope(this.scope, ack.scope)) throw new VoiceError('VOICE_INTERRUPT_UNKNOWN');
        }
        if (!this.#closed) this.#set({ phase: 'ready' });
      } catch {
        this.#closed = true; this.ports.stopCapture();
        this.#set({ phase: 'ended', muted: true, error: 'VOICE_INTERRUPT_UNKNOWN' });
      } finally { this.#interrupting = undefined; }
    })();
    return this.#interrupting;
  }

  async bargeIn({ echoCancelled, speechConfirmed }) {
    if (echoCancelled !== true || speechConfirmed !== true || this.mode === 'dictation') return false;
    await this.interrupt(); return !this.#closed;
  }

  async mute(muted) {
    if (this.#closed) return;
    if (!['ready', 'transcribing', 'thinking', 'synthesizing', 'speaking', 'interrupting'].includes(this.#snapshot.phase)) throw new VoiceError('VOICE_NOT_READY');
    this.#set({ muted });
    if (muted) { this.ports.stopCapture(); await this.interrupt(); }
  }

  async reconnect() {
    this.ports.stopCapture(); this.#set({ muted: true });
    this.#connecting?.abort(); this.#connection++;
    await this.interrupt();
    if (this.#closed) return false;
    this.#set({ phase: 'reconnecting', transcript: '', reply: '', tools: [] });
    return this.connect();
  }

  async end() {
    if (this.#ending) return this.#ending;
    this.#closed = true; this.#connection++; this.#connecting?.abort();
    this.ports.stopCapture();
    this.#ending = (async () => {
      await this.interrupt();
      this.#set({ phase: 'ended', muted: true, transcript: '', reply: '', tools: [], approval: null });
      await this.ports.disconnect({ scope: this.scope, sessionId: this.sessionId });
    })();
    return this.#ending;
  }
}
