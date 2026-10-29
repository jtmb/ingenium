import type { VoiceScope, VoiceMode, VoicePorts, VoiceSession } from '../../../../../../packages/veyra-voice/session.mjs';
export class VoiceClient {
  constructor(options: { scope: VoiceScope; mode: VoiceMode; sessionId: string; ports: Omit<VoicePorts, 'play' | 'stopPlayback' | 'stopCapture'>; speechGate?: { inspect(pcm: Uint8Array): { speechConfirmed: boolean; echoCancelled: boolean } }; onError?: (code: string) => void });
  session: VoiceSession;
  media: { devices(): Promise<{ id: string; kind: string; label: string }[]> };
  inputDeviceId: string; outputDeviceId: string;
  start(): Promise<void>;
  mute(muted: boolean): Promise<void>;
  selectDevices(input: string, output: string): Promise<void>;
  reconnect(): Promise<void>;
  end(): Promise<void>;
}
