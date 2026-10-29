import { PcmNormalizer, validateWav } from '../../../../../../packages/veyra-voice/audio.mjs';
import { VoiceError } from '../../../../../../packages/veyra-voice/session.mjs';

/** Created by a user gesture. Never requests a device during module load or rendering. */
export class BrowserAudio {
  #stream;
  #context;
  #processor;
  #source;
  #sink;
  #playback;
  #epoch = 0;
  #starting = false;

  constructor(environment = globalThis) { this.environment = environment; }
  async devices() {
    const devices = await this.environment.navigator.mediaDevices.enumerateDevices();
    return devices.filter(device => ['audioinput', 'audiooutput'].includes(device.kind)).map(device => ({ id: device.deviceId, kind: device.kind, label: device.label || (device.kind === 'audioinput' ? 'Microphone' : 'Speaker') }));
  }
  async startCapture({ deviceId, onPcm, onError }) {
    if (this.#starting || this.#stream) throw new VoiceError('VOICE_CAPTURE_BUSY');
    this.#starting = true; const epoch = ++this.#epoch;
    let stream, context;
    try {
      stream = await this.environment.navigator.mediaDevices.getUserMedia({ audio: { ...(deviceId ? { deviceId: { exact: deviceId } } : {}), echoCancellation: true, noiseSuppression: true, autoGainControl: true }, video: false });
      if (epoch !== this.#epoch) { stream.getTracks().forEach(track => track.stop()); return false; }
      this.#stream = stream;
      context = new this.environment.AudioContext(); this.#context = context;
      await context.resume();
      if (epoch !== this.#epoch) return false;
      const normalizer = new PcmNormalizer(context.sampleRate);
      this.#source = context.createMediaStreamSource(stream);
      // This compatibility path avoids an unowned public worklet asset; no PCM is retained here.
      this.#processor = context.createScriptProcessor(2048, 1, 1);
      this.#sink = context.createGain(); this.#sink.gain.value = 0;
      this.#processor.onaudioprocess = event => {
        if (epoch !== this.#epoch) return;
        try { const pcm = normalizer.push(event.inputBuffer.getChannelData(0)); if (pcm.length) onPcm(pcm); }
        catch { this.stopCapture(); onError?.('VOICE_CAPTURE_FAILED'); }
      };
      this.#source.connect(this.#processor); this.#processor.connect(this.#sink); this.#sink.connect(context.destination);
      const track = stream.getAudioTracks()[0];
      track.onended = () => { if (epoch === this.#epoch) { this.stopCapture(); onError?.('VOICE_DEVICE_DISCONNECTED'); } };
      return { echoCancellation: track.getSettings().echoCancellation === true };
    } catch (error) {
      stream?.getTracks().forEach(track => track.stop());
      if (epoch === this.#epoch) this.stopCapture();
      else if (context && context.state !== 'closed') await context.close();
      throw error;
    } finally { this.#starting = false; }
  }
  stopCapture() {
    this.#epoch++;
    if (this.#processor) this.#processor.onaudioprocess = null;
    this.#processor?.disconnect(); this.#source?.disconnect(); this.#sink?.disconnect();
    this.#stream?.getTracks().forEach(track => { track.onended = null; track.stop(); });
    const context = this.#context;
    this.#stream = this.#processor = this.#source = this.#sink = this.#context = undefined;
    if (context && context.state !== 'closed') void context.close().catch(() => undefined);
  }
  async play({ wav, signal, outputDeviceId }) {
    signal.throwIfAborted(); validateWav(wav); this.stopPlayback();
    const blob = new this.environment.Blob([wav], { type: 'audio/wav' });
    const url = this.environment.URL.createObjectURL(blob), audio = new this.environment.Audio(url);
    return new Promise((resolve, reject) => {
      let settled = false;
      const finish = error => {
        if (settled) return; settled = true;
        signal.removeEventListener('abort', abort); audio.onended = audio.onerror = null;
        audio.pause(); audio.removeAttribute('src'); audio.load(); this.environment.URL.revokeObjectURL(url);
        if (this.#playback?.audio === audio) this.#playback = undefined;
        if (error) reject(error); else resolve();
      };
      const abort = () => finish(new VoiceError('VOICE_PLAYBACK_CANCELLED'));
      this.#playback = { audio, stop: abort }; signal.addEventListener('abort', abort, { once: true });
      audio.onended = () => finish(); audio.onerror = () => finish(new VoiceError('VOICE_PLAYBACK_FAILED'));
      void (async () => {
        try {
          if (outputDeviceId) {
            if (typeof audio.setSinkId !== 'function') throw new VoiceError('VOICE_OUTPUT_SELECTION_UNSUPPORTED');
            await audio.setSinkId(outputDeviceId);
          }
          signal.throwIfAborted(); if (!settled) await audio.play();
        } catch (error) { finish(error); }
      })();
    });
  }
  stopPlayback() { this.#playback?.stop(); }
  dispose() { this.stopCapture(); this.stopPlayback(); }
}
