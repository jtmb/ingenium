import { VoiceError } from './session.mjs';

/** FIR low-pass before decimation, adapted conceptually from Stratus's normalized receive path. */
export class PcmNormalizer {
  constructor(rate) {
    if (![16000, 32000, 44100, 48000, 96000].includes(rate)) throw new VoiceError('VOICE_SAMPLE_RATE_UNSUPPORTED');
    this.rate = rate; this.history = new Float64Array(63); this.index = 0; this.phase = 0;
    const cutoff = 7200 / rate;
    this.taps = Array.from({ length: 63 }, (_, i) => {
      const x = i - 31;
      return (x === 0 ? 2 * cutoff : Math.sin(2 * Math.PI * cutoff * x) / (Math.PI * x)) * (0.54 - 0.46 * Math.cos(2 * Math.PI * i / 62));
    });
    const sum = this.taps.reduce((a, b) => a + b, 0); this.taps = this.taps.map(x => x / sum);
  }
  push(samples) {
    if (!(samples instanceof Float32Array) || samples.length > this.rate || samples.some(x => !Number.isFinite(x))) throw new VoiceError('VOICE_FRAME_INVALID');
    const pcm = new Uint8Array(Math.ceil(samples.length * 16000 / this.rate) * 2 + 2); const view = new DataView(pcm.buffer); let bytes = 0;
    for (const sample of samples) {
      this.history[this.index] = Math.max(-1, Math.min(1, sample)); this.index = (this.index + 1) % 63;
      this.phase += 16000;
      if (this.phase < this.rate) continue;
      this.phase -= this.rate;
      let value = 0;
      for (let k = 0; k < 63; k++) value += this.history[(this.index - 1 - k + 63) % 63] * this.taps[k];
      view.setInt16(bytes, Math.max(-32768, Math.min(32767, Math.round(value * 32767))), true); bytes += 2;
    }
    return pcm.subarray(0, bytes);
  }
}

/** Normalized 16 kHz mono s16le only. Energy segmentation is not neural VAD or echo cancellation. */
export class UtteranceSegmenter {
  constructor(onUtterance, { silenceMs = 700, maxMs = 15000, minVoicedMs = 250, threshold = 160, onOverflow } = {}) {
    if (![silenceMs, maxMs, minVoicedMs, threshold].every(Number.isFinite) || silenceMs < 200 || silenceMs > 2000 || maxMs < 1000 || maxMs > 15000 || minVoicedMs < 250 || minVoicedMs > maxMs || threshold <= 0) throw new VoiceError('VOICE_SEGMENT_CONFIG_INVALID');
    Object.assign(this, { onUtterance, silenceMs, maxMs, minVoicedMs, threshold, onOverflow }); this.reset();
  }
  reset() { this.chunks = []; this.bytes = 0; this.voicedMs = 0; this.silentMs = 0; this.preRoll = new Uint8Array(); this.overflowed = false; }
  retainedPcm() {
    const result = new Uint8Array(this.bytes); let offset = 0;
    for (const chunk of this.chunks) { result.set(chunk, offset); offset += chunk.length; }
    return result;
  }
  push(pcm) {
    if (!(pcm instanceof Uint8Array) || !pcm.length || pcm.length % 2 || pcm.length > 6400) throw new VoiceError('VOICE_FRAME_INVALID');
    if (this.overflowed) return false; // Caller must release capture; never consume another frame.
    const view = new DataView(pcm.buffer, pcm.byteOffset, pcm.byteLength); let energy = 0;
    for (let i = 0; i < pcm.length; i += 2) energy += view.getInt16(i, true) ** 2;
    const voiced = Math.sqrt(energy / (pcm.length / 2)) >= this.threshold;
    if (!this.bytes && !voiced) {
      const next = new Uint8Array(Math.min(6400, this.preRoll.length + pcm.length));
      const keep = Math.min(this.preRoll.length, next.length - pcm.length);
      next.set(this.preRoll.subarray(this.preRoll.length - keep)); next.set(pcm, keep); this.preRoll = next; return;
    }
    if (!this.bytes) { this.chunks.push(this.preRoll); this.bytes = this.preRoll.length; this.preRoll = new Uint8Array(); }
    const accepted = pcm.slice(); // Retain the entire crossing frame, including its tail.
    this.chunks.push(accepted); this.bytes += accepted.length;
    if (voiced) { this.voicedMs += accepted.length / 32; this.silentMs = 0; } else this.silentMs += accepted.length / 32;
    if (this.bytes > this.maxMs * 32 || (this.bytes >= this.maxMs * 32 && this.silentMs < this.silenceMs)) {
      this.overflowed = true; this.onOverflow?.(this.retainedPcm()); return false;
    }
    if (this.silentMs >= this.silenceMs) this.flush();
    return true;
  }
  flush() {
    if (this.overflowed) return false; // No partial prompt and no implicit discard.
    const chunks = this.chunks, bytes = this.bytes, accepted = this.voicedMs >= this.minVoicedMs;
    this.reset();
    if (accepted) { const result = new Uint8Array(bytes); let offset = 0; for (const chunk of chunks) { result.set(chunk, offset); offset += chunk.length; } this.onUtterance(result); }
  }
}

export function validateWav(wav) {
  if (!(wav instanceof Uint8Array) || wav.length < 44 || wav.length > 2880128) throw new VoiceError('VOICE_WAV_INVALID');
  const view = new DataView(wav.buffer, wav.byteOffset, wav.byteLength);
  const tag = offset => String.fromCharCode(...wav.subarray(offset, offset + 4));
  if (tag(0) !== 'RIFF' || tag(8) !== 'WAVE' || view.getUint32(4, true) !== wav.length - 8) throw new VoiceError('VOICE_WAV_INVALID');
  let format, bytes, offset = 12;
  while (offset < wav.length) {
    if (offset + 8 > wav.length) throw new VoiceError('VOICE_WAV_INVALID');
    const id = tag(offset), size = view.getUint32(offset + 4, true); offset += 8;
    if (size > wav.length - offset) throw new VoiceError('VOICE_WAV_INVALID');
    if (id === 'fmt ') {
      if (format || size !== 16) throw new VoiceError('VOICE_WAV_INVALID');
      const channels = view.getUint16(offset + 2, true), rate = view.getUint32(offset + 4, true);
      if (view.getUint16(offset, true) !== 1 || ![1, 2].includes(channels) || ![8000, 16000, 22050, 24000, 44100, 48000].includes(rate) || view.getUint16(offset + 14, true) !== 16 || view.getUint16(offset + 12, true) !== channels * 2 || view.getUint32(offset + 8, true) !== rate * channels * 2) throw new VoiceError('VOICE_WAV_INVALID');
      format = { rate, channels };
    } else if (id === 'data') { if (bytes !== undefined) throw new VoiceError('VOICE_WAV_INVALID'); bytes = size; }
    offset += size + size % 2;
  }
  if (offset !== wav.length || !format || !bytes || bytes % (format.channels * 2) || bytes > format.rate * format.channels * 2 * 15) throw new VoiceError('VOICE_WAV_INVALID');
  return { ...format, durationMs: bytes / (format.rate * format.channels * 2) * 1000 };
}
