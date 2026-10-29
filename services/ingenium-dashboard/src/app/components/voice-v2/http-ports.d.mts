import type { VoicePorts } from '../../../../../../packages/veyra-voice/session.mjs';
export function createHttpVoicePorts(options: { request?: typeof fetch; basePath?: string; dictation: VoicePorts['dictation'] }): Omit<VoicePorts, 'play' | 'stopPlayback' | 'stopCapture'>;
