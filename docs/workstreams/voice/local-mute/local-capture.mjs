/** Local device lifetime only. No session, request, agent, playback or receipt API. */
export class LocalCapture {
  #epoch = 0;
  #opening = null;
  #disposed = new WeakSet();
  #closing = 0;
  #problem;
  intent = false;
  resource = null;
  failures = [];
  get blocked() { return this.failures.length > 0; }
  get closing() { return this.#closing > 0; }
  begin() {
    if (this.blocked) throw new Error('Microphone cleanup needs attention before another capture.');
    if (this.closing) throw new Error('Microphone cleanup is still pending. Unmute explicitly after it finishes.');
    if (this.resource || this.intent) throw new Error('Microphone capture is already active or pending.');
    this.intent = true; return ++this.#epoch;
  }
  current(ticket) { return Number.isSafeInteger(ticket) && ticket > 0 && this.intent && ticket === this.#epoch && !this.blocked; }
  #failed(resource, error) {
    this.failures.push({ resource, error });
    this.#problem?.('Microphone release could not be fully confirmed. Capture remains blocked; the original call is unchanged.');
  }
  #dispose(resource) {
    if (!resource || this.#disposed.has(resource)) return;
    this.#disposed.add(resource);
    const attempt = action => { try { action(); } catch (error) { this.#failed(resource, error); } };
    if (resource.processor) resource.processor.onaudioprocess = null;
    // Stop tracks before potentially slow/failed graph teardown. Keep every failed
    // original handle; do not open a replacement capture over unknown cleanup.
    attempt(() => { for (const track of resource.stream.getTracks()) {
      track.onended = null;
      attempt(() => { track.stop(); if (track.readyState !== 'ended') throw new Error('Track did not confirm ended'); });
    } });
    for (const node of [resource.source, resource.processor, resource.gain]) if (node) attempt(() => node.disconnect());
    if (resource.context) attempt(() => {
      this.#closing++;
      let closing;
      try { closing = resource.context.close(); }
      catch (error) { this.#closing--; throw error; }
      void Promise.resolve(closing).catch(error => this.#failed(resource, error)).finally(() => { this.#closing--; });
    });
  }
  stop() {
    this.intent = false; this.#epoch++;
    const resource = this.resource; this.resource = null;
    this.#dispose(resource); this.#dispose(this.#opening); this.#opening = null;
    return { released: !this.blocked, pending: this.closing };
  }
  async open(ticket, ports) {
    const valid = () => this.current(ticket) && ports.isCurrent();
    if (!valid()) return false;
    if (!ports.claim()) throw new Error('The existing audio lease is unavailable.');
    this.#problem = ports.onProblem;
    let candidate;
    try {
      const stream = await ports.media.getUserMedia({ audio: { channelCount: 1, echoCancellation: true, noiseSuppression: true }, video: false });
      candidate = { stream, context: null, source: null, processor: null, gain: null }; this.#opening = candidate;
      if (!valid()) { this.#dispose(candidate); return false; }
      const audioTracks = stream.getAudioTracks();
      if (!audioTracks.length || audioTracks.some(track => track.readyState !== 'live')) throw new Error('Microphone returned no live audio track.');
      const context = ports.createContext(); candidate.context = context;
      await context.resume();
      if (!valid()) { this.#dispose(candidate); return false; }
      if (audioTracks.some(track => track.readyState !== 'live')) throw new Error('Microphone ended before capture became active.');
      const source = context.createMediaStreamSource(stream); candidate.source = source;
      const processor = context.createScriptProcessor(2048, 1, 1); candidate.processor = processor;
      const gain = context.createGain(); candidate.gain = gain; gain.gain.value = 0;
      processor.onaudioprocess = event => {
        event.outputBuffer.getChannelData(0).fill(0);
        if (valid() && this.resource === candidate) ports.onPcm(event.inputBuffer.getChannelData(0), event.inputBuffer.sampleRate);
      };
      for (const track of stream.getAudioTracks()) track.onended = () => { if (valid() && this.resource === candidate) ports.onEnded(); };
      source.connect(processor); processor.connect(gain); gain.connect(context.destination);
      if (!valid()) { this.#dispose(candidate); return false; }
      if (!ports.claim()) throw new Error('The audio lease changed before microphone publication.');
      this.resource = candidate; return true;
    } catch (error) {
      this.#dispose(candidate);
      if (!valid()) return false;
      throw error;
    } finally {
      if (this.#opening === candidate) this.#opening = null;
      if (this.resource !== candidate && !this.resource && (ticket === this.#epoch || !this.intent)) ports.release();
    }
  }
}

export function retainUnsubmitted(queued, capture, resource) {
  const source = queued || (capture?.frames?.length && resource ? { frames: capture.frames, rate: resource.context.sampleRate } : null);
  return source?.frames?.length ? { frames: [...source.frames], rate: source.rate } : null;
}
