import { VoiceSession, VoiceError } from '../../../../../../packages/veyra-voice/session.mjs';
import { UtteranceSegmenter } from '../../../../../../packages/veyra-voice/audio.mjs';
import { BrowserAudio } from './browser-audio.mjs';

export class VoiceClient {
  constructor({ scope, mode, sessionId, ports, media = new BrowserAudio(), speechGate, onError = () => undefined }) {
    this.media = media; this.onError = onError; this.inputDeviceId = ''; this.outputDeviceId = ''; this.disposed = false;
    this.speechGate = speechGate; this.barging = false; this.preRoll = new Uint8Array();
    this.segmenter = new UtteranceSegmenter(pcm => {
      if (this.session.getSnapshot().phase === 'ready' && !this.session.getSnapshot().muted) void this.session.receive(pcm).catch(() => onError('VOICE_TURN_FAILED'));
    });
    this.session = new VoiceSession({ scope, mode, sessionId, ports: { ...ports,
      play: request => media.play({ ...request, outputDeviceId: this.outputDeviceId }),
      stopPlayback: () => media.stopPlayback(), stopCapture: () => { media.stopCapture(); this.segmenter.reset(); },
    } });
  }
  async start() {
    if (this.disposed) throw new VoiceError('VOICE_CLIENT_DISPOSED');
    if (await this.session.connect()) await this.capture();
  }
  async capture() {
    if (this.disposed || this.session.getSnapshot().phase !== 'ready') return;
    try {
      await this.media.startCapture({ deviceId: this.inputDeviceId, onPcm: pcm => {
        const state = this.session.getSnapshot();
        if (state.muted) { this.segmenter.reset(); return; }
        if (state.phase === 'ready' && !this.barging) { this.segmenter.push(pcm); return; }
        this.segmenter.reset();
        if (!this.speechGate || this.session.mode === 'dictation') return;
        const next = new Uint8Array(Math.min(6400, this.preRoll.length + pcm.length));
        const keep = Math.min(this.preRoll.length, next.length - pcm.length);
        next.set(this.preRoll.subarray(this.preRoll.length - keep)); next.set(pcm, keep); this.preRoll = next;
        // A qualified VAD + echo processor supplies this evidence; device settings alone cannot.
        const evidence = this.speechGate.inspect(pcm);
        if (!this.barging && evidence?.speechConfirmed === true && evidence.echoCancelled === true) {
          this.barging = true;
          void this.session.bargeIn(evidence).then(ready => {
            if (ready && !this.disposed && !this.session.getSnapshot().muted) this.segmenter.push(this.preRoll);
          }).catch(() => this.onError('VOICE_INTERRUPT_UNKNOWN')).finally(() => { this.barging = false; this.preRoll = new Uint8Array(); });
        }
      }, onError: code => { this.onError(code); this.session.reportError(code); void this.session.mute(true); } });
    } catch { this.onError('VOICE_MICROPHONE_UNAVAILABLE'); this.session.reportError('VOICE_MICROPHONE_UNAVAILABLE'); await this.session.mute(true); }
  }
  async mute(muted) {
    await this.session.mute(muted);
    if (!muted) await this.capture();
  }
  async selectDevices(input, output) {
    const wasMuted = this.session.getSnapshot().muted;
    await this.session.mute(true); this.inputDeviceId = input; this.outputDeviceId = output;
    if (!wasMuted) await this.mute(false);
  }
  async reconnect() {
    if (await this.session.reconnect()) await this.capture();
  }
  async end() { this.disposed = true; this.media.dispose(); this.segmenter.reset(); this.preRoll = new Uint8Array(); await this.session.end(); }
}
