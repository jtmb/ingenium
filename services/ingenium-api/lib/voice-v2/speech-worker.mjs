import { VoiceError, validateTurn } from '../../../../packages/veyra-voice/session.mjs';
import { validateWav } from '../../../../packages/veyra-voice/audio.mjs';
import { planTextSpeech, sourceDigest } from '../../../../packages/veyra-voice/segments.mjs';

async function readBounded(response, limit) {
  const length = response.headers.get('content-length');
  if (length !== null && (!Number.isSafeInteger(Number(length)) || Number(length) < 0 || Number(length) > limit)) { await response.body?.cancel(); throw new VoiceError('VOICE_WORKER_RESPONSE_LIMIT'); }
  if (!response.body) throw new VoiceError('VOICE_WORKER_EMPTY');
  const reader = response.body.getReader(), chunks = []; let bytes = 0;
  try {
    while (true) {
      const item = await reader.read(); if (item.done) break;
      bytes += item.value.length;
      if (bytes > limit) { await reader.cancel(); throw new VoiceError('VOICE_WORKER_RESPONSE_LIMIT'); }
      chunks.push(item.value);
    }
  } finally { reader.releaseLock(); }
  if (length !== null && bytes !== Number(length)) throw new VoiceError('VOICE_WORKER_TRUNCATED');
  const body = new Uint8Array(bytes); let offset = 0;
  for (const chunk of chunks) { body.set(chunk, offset); offset += chunk.length; }
  if (!response.ok) throw new VoiceError('VOICE_WORKER_UNAVAILABLE');
  return body;
}

/** Server-only consumer of Veyra's Stratus-compatible speech protocol. No automatic backend fallback. */
export class SpeechWorker {
  #plans = new WeakMap();
  constructor({ baseUrl, token, voice, backend = 'directml', instanceId, redactSpeech, fetch: request = globalThis.fetch }) {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !token || !voice || !['directml', 'cpu-onnx'].includes(backend) || (instanceId !== undefined && (typeof instanceId !== 'string' || !instanceId || instanceId.length > 160)) || typeof redactSpeech !== 'function') throw new VoiceError('VOICE_WORKER_CONFIG_INVALID');
    Object.assign(this, { baseUrl: url.origin, token, voice, backend, instanceId, redactSpeech, request });
  }
  async #call(path, options, limit, signal) {
    const response = await this.request(new URL(path, this.baseUrl), { ...options, headers: { ...options.headers, Authorization: `Bearer ${this.token}` }, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000) });
    return readBounded(response, limit);
  }
  async health(signal) {
    const body = JSON.parse(new TextDecoder().decode(await this.#call('/health', {}, 4096, signal)));
    if (body.service !== 'veyra-speech' || (this.instanceId !== undefined && body.instanceId !== this.instanceId)) throw new VoiceError('VOICE_WORKER_IDENTITY_MISMATCH');
    const matchesBackend = this.backend === 'directml' ? body.backend === 'torch-directml' && body.gpuReady === true : body.backend === 'cpu-onnx' && body.gpuReady === false;
    if (body.ready !== true || body.stt !== true || body.tts !== true || !matchesBackend || (body.voice !== this.voice && !body.voices?.includes(this.voice))) throw new VoiceError('VOICE_WORKER_NOT_QUALIFIED');
    return { ready: true, gpuReady: body.gpuReady, backend: this.backend };
  }
  async #withCancel(requestId, signal, work) {
    if (typeof requestId !== 'string' || requestId.length > 160 || !requestId.length) throw new VoiceError('VOICE_REQUEST_INVALID');
    signal?.throwIfAborted();
    const cancel = () => { void this.#call('/v1/cancel', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId }) }, 4096).catch(() => undefined); };
    signal?.addEventListener('abort', cancel, { once: true });
    try { const result = await work(); signal?.throwIfAborted(); return result; }
    finally { signal?.removeEventListener('abort', cancel); }
  }
  async transcribe({ pcm, turn, signal }) {
    if (!(pcm instanceof Uint8Array) || pcm.length < 8000 || pcm.length > 480000 || pcm.length % 2) throw new VoiceError('VOICE_PCM_INVALID');
    return this.#withCancel(turn.requestId, signal, async () => {
      const body = JSON.parse(new TextDecoder().decode(await this.#call('/v1/transcriptions', { method: 'POST', headers: { 'Content-Type': 'application/octet-stream', 'X-Request-Id': turn.requestId }, body: pcm }, 16384, signal)));
      if (typeof body.text !== 'string' || [...body.text].length > 2000 || body.language !== 'en' || body.durationMs !== pcm.length / 32) throw new VoiceError('VOICE_TRANSCRIPTION_INVALID');
      return { text: body.text.trim(), final: true };
    });
  }
  async synthesize({ text, turn, signal }) {
    const safe = this.redactSpeech(text);
    if (typeof safe !== 'string' || !safe.trim()) throw new VoiceError('VOICE_SPEECH_REDACTED');
    if ([...safe].length > 600 || new TextEncoder().encode(safe).length > 2400) throw new VoiceError('VOICE_SPEECH_TEXT_LIMIT');
    return this.#withCancel(turn.requestId, signal, async () => {
      const wav = await this.#call('/v1/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: turn.requestId, text: safe, voice: this.voice }) }, 2880128, signal);
      validateWav(wav); return wav;
    });
  }
  async planSpeech({ text, turn, signal }) {
    validateTurn(turn);
    if (typeof text !== 'string' || [...text].length > 32000) throw new VoiceError('VOICE_TEXT_INVALID');
    signal?.throwIfAborted();
    const safe = this.redactSpeech(text);
    if (typeof safe !== 'string') throw new VoiceError('VOICE_SPEECH_REDACTED');
    // Redact the whole original BEFORE partitioning; secret/code boundaries must
    // never be broken up and redacted independently. Preserve both source hashes.
    const spoken = safe.replaceAll('\r', '\n');
    const plan = spoken.length ? await planTextSpeech(spoken) : { sourceDigest: await sourceDigest(new Uint8Array()), sourceBytes: 0, segments: [] };
    const result = Object.freeze({ ...plan, redactedDigest: await sourceDigest(new TextEncoder().encode(safe)), originalDigest: await sourceDigest(new TextEncoder().encode(text)) });
    this.#plans.set(result, { requestId: turn.requestId, generation: turn.generation });
    return result;
  }
  async *synthesizeSequence({ text, turn, signal, children }) {
    if (typeof children?.reserve !== 'function' || typeof children?.settle !== 'function') throw new VoiceError('VOICE_SPEECH_CHILD_OWNER_REQUIRED');
    const plan = await this.planSpeech({ text, turn, signal });
    for (const segment of plan.segments) {
      signal?.throwIfAborted();
      if (segment.kind === 'text-gap') continue;
      const owned = this.#plans.get(plan);
      if (!owned || owned.requestId !== turn.requestId || owned.generation !== turn.generation) throw new VoiceError('VOICE_SPEECH_PLAN_INVALID');
      const operation = await children.reserve({ turn, segment, originalDigest: plan.originalDigest });
      if (operation?.accepted !== true || operation.parentRequestId !== turn.requestId || operation.generation !== turn.generation
        || typeof operation.requestId !== 'string' || !operation.requestId || operation.requestId.length > 160
        || operation.sourceDigest !== segment.sourceDigest || operation.digest !== segment.digest
        || operation.sourceStart !== segment.sourceStart || operation.sourceEnd !== segment.sourceEnd) throw new VoiceError('VOICE_SPEECH_CHILD_OWNER_REQUIRED');
      let settled = false;
      try {
        const wav = await this.#withCancel(operation.requestId, signal, async () => {
          const data = await this.#call('/v1/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ requestId: operation.requestId, text: segment.text, voice: this.voice }) }, 2880128, signal);
          validateWav(data); return data;
        });
        await children.settle({ turn, operation, segment, outcome: 'completed' }); settled = true;
        // The caller advances the iterator only after its existing playback owner
        // completes/stops this WAV. There is no whole-reply audio cache or replay.
        yield { wav, operation, segment, originalDigest: plan.originalDigest };
      } catch (error) {
        if (!settled) await children.settle({ turn, operation, segment, outcome: 'unknown' });
        throw error;
      }
    }
  }
}
