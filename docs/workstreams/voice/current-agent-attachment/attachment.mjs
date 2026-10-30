import { createHash } from 'node:crypto';

const fail = code => { throw Object.assign(new Error(code), { code }); };
const canonical = value => JSON.stringify(value, Object.keys(value).sort());
const digest = value => createHash('sha256').update(value).digest('hex');
const id = value => typeof value === 'string' && value.length > 0 && value.length <= 256 && !/[\u0000-\u001f\u007f]/.test(value);
const scopeKeys = ['actorId', 'accountId', 'organizationId', 'projectId', 'conversationId', 'runtimeId', 'executionBindingId', 'executionRevision', 'agentId'];
function scopeOf(value) {
  if (!value || Object.keys(value).sort().join() !== [...scopeKeys].sort().join()
    || scopeKeys.some(k => !id(value[k]) && !(['organizationId', 'projectId'].includes(k) && value[k] === null))) fail('CALL_SCOPE_INVALID');
  return Object.freeze(Object.fromEntries(scopeKeys.map(key=>[key,value[key]])));
}
const same = (a, b) => a && b && scopeKeys.every(k => a[k] === b[k]);
const record = value => value && typeof value === 'object' && !Array.isArray(value) ? value : null;
function selectedEvent(block, sessionId, directory) {
  const lines = block.split('\n'), raw = lines.filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n');
  if (!raw) return null;
  let decoded = JSON.parse(raw); if (typeof decoded === 'string') decoded = JSON.parse(decoded);
  const root = record(decoded), event = record(root?.payload) ?? root;
  if (!event || !id(event.type)) return null;
  const location = record(event.location) ?? record(root?.location);
  if (location?.directory !== undefined && location.directory !== directory) return null;
  const data = record(event.data) ?? record(event.properties); if (!data) return null;
  const candidate = data.sessionID ?? ['info', 'part', 'form', 'request'].map(k => record(data[k])?.sessionID).find(v => typeof v === 'string');
  if (candidate !== sessionId) return null; // Never expose global/unrelated events.
  const eventId = lines.find(line => line.startsWith('id:'))?.slice(3).trim() ?? event.id;
  return { type: event.type, data, ...(id(eventId) ? { eventId } : {}) };
}

/** Attachment only. owner is Root's existing authenticated canonical chat owner;
 * speech is its actual call-owned CPU/audio owner. No agent run or proof is made.
 * The implementation retains real stream/message/speech Promises; injected
 * test fixtures are never runtime qualification or Core retirement evidence.
 */
export class CurrentAgentCallAttachment {
  #owner; #context; #speech; #scope; #callId; #emit;
  #selection; #directory; #subscription; #connecting; #connection = 0; #closed = false; #ending; #barging;
  #speechGeneration = 0; #speechFenced = false; #speechOriginals = new Set(); #deliveries = new Map();
  #controls = new Map(); #texts = new Map(); #seen = new Set(); #cursor;
  #state = 'new'; #agentState = 'unobserved';
  constructor({ owner, context, speech, scope, callId, onEvent = () => {} }) {
    if (!owner || ['inspect', 'openEvents', 'deliverMessage', 'cancelAgent'].some(k => typeof owner[k] !== 'function')
      || !speech || ['transcribe', 'speak', 'cancelOwned'].some(k => typeof speech[k] !== 'function')
      || !id(callId) || typeof onEvent !== 'function' || !context || typeof context !== 'object') fail('CALL_OWNER_REQUIRED');
    this.#owner = owner; this.#context = context; this.#speech = speech;
    this.#scope = scopeOf(scope); this.#callId = callId; this.#emit = onEvent;
  }
  snapshot() {
    return Object.freeze({ state: this.#state, callId: this.#callId, scope: this.#scope,
      agentState: this.#agentState, speechState:this.#speechFenced?'fenced':'ready', agentExecutionOwnedByCall: false,
      deliveries: [...this.#deliveries.values()].map(v => Object.freeze({ requestId: v.requestId, nativeMessageId: v.nativeMessageId, state: v.state })),
      controls: [...this.#controls.values()].map(v => Object.freeze({ requestId: v.requestId, state: v.state })),
      ...(this.#cursor ? { cursor: this.#cursor } : {}) });
  }
  async #current(action) {
    const selected = await this.#owner.inspect(this.#context, this.#scope, action);
    if (!same(selected?.scope, this.#scope) || selected.sessionId !== this.#scope.conversationId || selected.agentId !== this.#scope.agentId
      || !id(selected.modelId) || !id(selected.providerId) || !id(selected.configurationRevision) || !id(selected.directory)) fail('CALL_SELECTION_CHANGED');
    const selection = canonical({ sessionId: selected.sessionId, agentId: selected.agentId, modelId: selected.modelId,
      providerId: selected.providerId, variant: selected.variant ?? null, configurationRevision: selected.configurationRevision });
    if (this.#selection && this.#selection !== selection) fail('CALL_SELECTION_CHANGED');
    this.#selection ??= selection;
    if (this.#directory && this.#directory !== selected.directory) fail('CALL_SELECTION_CHANGED');
    this.#directory ??= selected.directory; return selected;
  }
  connect() {
    if (this.#connecting) return this.#connecting;
    const original = this.#connect(); this.#connecting = original;
    original.finally(() => { if (this.#connecting === original) this.#connecting = undefined; }).catch(() => {}); return original;
  }
  async #connect() {
    if (this.#closed || !['new', 'disconnected'].includes(this.#state)) fail('CALL_CONNECTION_CONFLICT');
    this.#state = 'connecting'; const connection = ++this.#connection;
    try {
      await this.#current('read'); if (this.#closed || connection !== this.#connection) fail('CALL_CLOSED');
      const controller = new AbortController(), original = { controller, reader: null, stopped: false, cancel: null, failure: null };
      this.#subscription = original;
      // Publish this original before openEvents can start a fetch.
      original.open = Promise.resolve().then(() => this.#owner.openEvents(this.#context, this.#scope,
        { cursor: this.#cursor, signal: controller.signal }));
      original.open.catch(() => {});
      original.pump = this.#pump(original, connection); original.pump.catch(error => {
        original.failure ??= error;
        if (!this.#closed && this.#subscription === original) this.#state = 'disconnected';
      });
      const stream = await original.open;
      if (!stream || typeof stream.getReader !== 'function') fail('CALL_EVENT_STREAM_INVALID');
      if (this.#closed || original.stopped || connection !== this.#connection) { await this.#stopSubscription(original); fail('CALL_CLOSED'); }
      this.#state = 'attached'; return this.snapshot();
    } catch (error) {
      if (!this.#closed) this.#state = 'disconnected';
      if (this.#subscription) await this.#stopSubscription(this.#subscription);
      throw error;
    }
  }
  async #pump(original, connection) {
    const stream = await original.open;
    if (!stream || typeof stream.getReader !== 'function') fail('CALL_EVENT_STREAM_INVALID');
    const reader = stream.getReader(); original.reader = reader;
    const decoder = new TextDecoder('utf-8', { fatal: true }); let buffer = '';
    try {
      if (original.stopped) { original.cancel ??= reader.cancel(); await original.cancel; return; }
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        if (!(value instanceof Uint8Array) || value.byteLength > 262144) fail('CALL_EVENT_BOUND');
        buffer += decoder.decode(value, { stream: true }); buffer = buffer.replace(/\r\n/g, '\n');
        if (Buffer.byteLength(buffer) > 262144) fail('CALL_EVENT_BOUND');
        let boundary;
        while ((boundary = buffer.indexOf('\n\n')) >= 0) {
          const block = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2);
          const event = selectedEvent(block, this.#scope.conversationId, this.#directory); if (!event) continue;
          if (original.stopped || this.#closed || connection !== this.#connection) continue;
          await this.#current('read'); // Auth/source/runtime changes fence every delivery.
          if (original.stopped || this.#closed || connection !== this.#connection) continue;
          if (event.eventId && this.#seen.has(event.eventId)) continue;
          if (event.type.startsWith('session.execution.')) this.#agentState = event.type.slice('session.execution.'.length);
          // Event labels are presentation only; never physical settlement.
          if (event.type === 'session.text.ended' && event.eventId && typeof event.data.text === 'string'
            && [...event.data.text].length <= 32000 && id(event.data.assistantMessageID)) {
            this.#texts.set(event.eventId, { text: event.data.text, messageId: event.data.assistantMessageID });
            if (this.#texts.size > 16) this.#texts.delete(this.#texts.keys().next().value);
          }
          await this.#emit(Object.freeze({ ...event, scope: this.#scope, callId: this.#callId, agentSettlementProof: false }));
          if (original.stopped || this.#closed || connection !== this.#connection) continue;
          if (event.eventId) { this.#seen.add(event.eventId); this.#cursor = event.eventId;
            if (this.#seen.size > 2048) this.#seen.delete(this.#seen.values().next().value); }
        }
      }
      decoder.decode();
      if (!original.stopped && !this.#closed) { this.#state = 'disconnected'; fail('CALL_EVENT_STREAM_ENDED'); }
    } finally {
      // A reader fault also cancels and joins the exact response body.
      original.cancel ??= reader.cancel();
      try { await original.cancel; } finally { reader.releaseLock(); }
    }
  }
  #stopSubscription(original) {
    if (original.stop) return original.stop;
    original.stopped = true; original.controller.abort();
    original.stop = (async () => {
      const opened = await Promise.allSettled([original.open]);
      if (original.reader) original.cancel ??= original.reader.cancel();
      const joined = await Promise.allSettled([original.pump, ...(original.cancel ? [original.cancel] : [])]);
      // An aborted open or pump can reject after its original has settled.
      // Cancellation failure is not a successful body join.
      if (original.cancel && joined.at(-1)?.status === 'rejected') fail('CALL_SUBSCRIPTION_CLEANUP_UNKNOWN');
      return { acquisitionJoined: opened.length === 1, pumpJoined: joined.length > 0, agentSettlementProof: false };
    })();
    original.stop.catch(() => {}); return original.stop;
  }
  async reconnect() {
    if (this.#closed) fail('CALL_CLOSED'); if (this.#connecting) fail('CALL_CONNECTION_CONFLICT');
    if (this.#subscription) await this.#stopSubscription(this.#subscription);
    this.#state = 'disconnected'; return this.connect(); // No messages are replayed.
  }
  deliver({ requestId, text, delivery = 'queue' }) {
    if (this.#closed || this.#state !== 'attached' || !id(requestId) || !['queue', 'steer'].includes(delivery)
      || typeof text !== 'string' || !text.trim() || [...text].length > 2000) return Promise.reject(Object.assign(new Error('CALL_MESSAGE_INVALID'), { code: 'CALL_MESSAGE_INVALID' }));
    const fingerprint = digest(JSON.stringify([text, delivery])), previous = this.#deliveries.get(requestId);
    if (previous) { if (previous.fingerprint !== fingerprint) return Promise.reject(new Error('CALL_MESSAGE_CONFLICT')); return previous.original; }
    if (this.#deliveries.size >= 128) return Promise.reject(new Error('CALL_MESSAGE_CAPACITY'));
    const nativeMessageId = 'msg_veyra_call_' + digest(JSON.stringify([this.#scope, requestId]));
    const retained = { requestId, nativeMessageId, fingerprint, state: 'pending' }; this.#deliveries.set(requestId, retained);
    retained.original = Promise.resolve().then(async () => {
      await this.#current('message');
      // SAME canonical chat admission/queue, not a new Voice agent operation.
      const receipt = await this.#owner.deliverMessage(this.#context, this.#scope, { requestId, nativeMessageId, text, delivery });
      if (receipt?.nativeMessageId !== nativeMessageId || receipt.sessionId !== this.#scope.conversationId
        || !['delivered', 'rejected'].includes(receipt.state)) fail('CALL_MESSAGE_DELIVERY_UNKNOWN');
      retained.state = receipt.state; return Object.freeze({ requestId, nativeMessageId, state: receipt.state, executionCompleted: false });
    }).catch(error => { retained.state = 'unknown'; throw error; });
    retained.original.catch(() => {}); return retained.original;
  }
  #ownSpeech(run) {
    if (this.#closed || this.#speechFenced || this.#state !== 'attached') return Promise.reject(new Error('CALL_SPEECH_FENCED'));
    const generation = this.#speechGeneration;
    const current = () => { if (this.#closed || this.#speechFenced || generation !== this.#speechGeneration) fail('CALL_SPEECH_FENCED'); };
    const original = Promise.resolve().then(() => { current(); return run(current); });
    this.#speechOriginals.add(original); original.finally(() => this.#speechOriginals.delete(original)).catch(() => {}); return original;
  }
  async transcribeAndDeliver({ pcm, requestId, delivery = 'queue' }) {
    const generation = this.#speechGeneration;
    const result = await this.#ownSpeech(async current => { await this.#current('speech'); current(); return this.#speech.transcribe({ context: this.#context, scope: this.#scope, callId: this.#callId, pcm }); });
    if (this.#closed || generation !== this.#speechGeneration) fail('CALL_SPEECH_FENCED');
    if (result.text === '') return { state: 'no-speech', executionCompleted: false };
    return this.deliver({ requestId, text: result.text, delivery });
  }
  speakObserved(eventId) {
    const source = this.#texts.get(eventId); if (!source) return Promise.reject(new Error('CALL_SPEECH_SOURCE_REQUIRED'));
    return this.#ownSpeech(async current => { await this.#current('speech'); current(); return this.#speech.speak({ context: this.#context,
      scope: this.#scope, callId: this.#callId, text: source.text, source: { eventId, messageId: source.messageId, sessionId: this.#scope.conversationId } }); });
  }
  bargeIn() {
    if (this.#closed) return Promise.reject(new Error('CALL_CLOSED')); if (this.#barging) return this.#barging;
    ++this.#speechGeneration; this.#speechFenced = true;
    const original = (async () => {
      await this.#speech.cancelOwned({ context: this.#context, scope: this.#scope, callId: this.#callId, reason: 'barge-in' });
      await Promise.allSettled([...this.#speechOriginals]);
      return { speechJoined: true, agentContinues: true, agentSettlementProof: false };
    })(); this.#barging = original;
    original.then(() => { if(this.#barging===original){this.#barging=undefined;this.#speechFenced=false;} },()=>{});
    return original; // Failed cleanup retains both original and speech fence.
  }
  cancelAgent({ requestId, intent }) {
    if (this.#closed || intent !== 'explicit-user-cancel-agent' || !id(requestId)) return Promise.reject(new Error('CALL_EXPLICIT_AGENT_CANCEL_REQUIRED'));
    const previous = this.#controls.get(requestId); if (previous) return previous.original;
    if (this.#controls.size >= 16) return Promise.reject(new Error('CALL_CONTROL_CAPACITY'));
    const retained = { requestId, state: 'pending' }; this.#controls.set(requestId, retained);
    retained.original = Promise.resolve().then(async () => {
      await this.#current('cancel-agent');
      const receipt = await this.#owner.cancelAgent(this.#context, this.#scope, { requestId, intent });
      // This is only dispatch status. Original agent owner retains settlement.
      if (!['pending', 'unknown', 'rejected'].includes(receipt?.state)) fail('CALL_AGENT_CONTROL_UNKNOWN');
      retained.state = receipt.state; return { requestId, state: retained.state, agentSettlementProof: false };
    }).catch(error => { retained.state = 'unknown'; throw error; }); retained.original.catch(() => {}); return retained.original;
  }
  end() {
    if (this.#ending) return this.#ending;
    this.#closed = true; this.#state = 'closing'; ++this.#connection; ++this.#speechGeneration;
    this.#ending = (async () => {
      // No inbox deletion, session interrupt, model shutdown, quota release or
      // agent proof. Already admitted message/control originals stay retained.
      const stop = this.#subscription ? this.#stopSubscription(this.#subscription) : Promise.resolve();
      const speech = this.#barging ?? Promise.resolve().then(() => this.#speech.cancelOwned({ context: this.#context, scope: this.#scope, callId: this.#callId, reason: 'call-end' }));
      const joins = await Promise.allSettled([stop, speech, ...this.#speechOriginals,
        ...(this.#connecting ? [this.#connecting] : []), ...(this.#barging ? [this.#barging] : []),
        ...[...this.#deliveries.values(), ...this.#controls.values()].map(v => v.original)]);
      if (joins[0].status !== 'fulfilled' || joins[1].status !== 'fulfilled') { this.#state = 'cleanup-unknown'; fail('CALL_CLEANUP_UNKNOWN'); }
      this.#state = 'closed'; this.#texts.clear(); this.#seen.clear();
      return { ...this.snapshot(), speechAndSubscriptionJoined: true, agentContinues: true, agentSettlementProof: false };
    })(); this.#ending.catch(() => {}); return this.#ending;
  }
}
