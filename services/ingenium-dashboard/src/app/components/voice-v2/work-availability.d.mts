import type { VoiceScope, VoiceMode } from '../../../../../../packages/veyra-voice/session.mjs';
export interface VoiceWorkReadiness { gateway: boolean; speech: boolean; draft: boolean; agent: boolean }
export interface VoiceWorkAvailability { state: 'available' | 'unavailable'; reason: string | null; modes: VoiceMode[]; duplex: 'half-duplex' }
export function voiceWorkAvailability(input: { scope: VoiceScope | null; readiness: VoiceWorkReadiness; portsPresent: boolean }): VoiceWorkAvailability;
