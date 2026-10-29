import { VoiceError } from '../../../../packages/veyra-voice/session.mjs';
import { validateWav } from '../../../../packages/veyra-voice/audio.mjs';

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

/** Server-only consumer of the Stratus speech protocol. No worker/model startup or CPU fallback. */
export class SpeechWorker {
  constructor({ baseUrl, token, voice, redactSpeech, fetch: request = globalThis.fetch }) {
    const url = new URL(baseUrl);
    if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || !token || !voice || typeof redactSpeech !== 'function') throw new VoiceError('VOICE_WORKER_CONFIG_INVALID');
    Object.assign(this, { baseUrl: url.origin, token, voice, redactSpeech, request });
  }
  async #call(path, options, limit, signal) {
    const response = await this.request(new URL(path, this.baseUrl), { ...options, headers: { ...options.headers, Authorization: `Bearer ${this.token}` }, redirect: 'error', signal: signal ? AbortSignal.any([signal, AbortSignal.timeout(5000)]) : AbortSignal.timeout(5000) });
    return readBounded(response, limit);
  }
  async health(signal) {
    const body = JSON.parse(new TextDecoder().decode(await this.#call('/health', {}, 4096, signal)));
    if (body.ready !== true || body.stt !== true || body.tts !== true || body.gpuReady !== true || (body.voice !== this.voice && !body.voices?.includes(this.voice))) throw new VoiceError('VOICE_WORKER_NOT_QUALIFIED');
    return { ready: true, gpuReady: true };
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
    const bounded = [...safe].slice(0, 600).join('');
    return this.#withCancel(turn.requestId, signal, async () => {
      const wav = await this.#call('/v1/speech', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ requestId: turn.requestId, text: bounded, voice: this.voice }) }, 2880128, signal);
      validateWav(wav); return wav;
    });
  }
}
