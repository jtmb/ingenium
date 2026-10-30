import type { ManagedCpuSupervisor, CpuSupervisorStatus } from './managed-supervisor.mjs';
import type { VoiceScope, VoiceTurn } from '../../../../packages/veyra-voice/session.mjs';
interface CpuSpeechEnvelope<C> { context: C; scope: VoiceScope; turn: VoiceTurn; deadlineAt: number; signal?: AbortSignal }
export class ManagedCpuSpeech<C> {
  constructor(dependencies: { supervisor: ManagedCpuSupervisor<C>; redactSpeech(text: string): string });
  readonly ownedSequence: true;
  openOwned(input: { context: C; scope: VoiceScope; sessionId: string; deadlineAt: number; signal?: AbortSignal }): Promise<CpuSupervisorStatus>;
  releaseOwned(input: { scope: VoiceScope; sessionId: string }): Promise<void>;
  health(signal?: AbortSignal): CpuSupervisorStatus;
  transcribe(input: CpuSpeechEnvelope<C> & { pcm: Uint8Array }): Promise<{ text: string; final: true }>;
  synthesizeSequence(input: CpuSpeechEnvelope<C> & { text: string; parentOperationId: string }): AsyncGenerator<{ wav: Uint8Array; operation: { accepted: true; operationId: string; requestId: string; parentOperationId: string; parentRequestId: string; generation: number; sourceDigest: string; digest: string; sourceStart: number; sourceEnd: number }; segment: { text: string; sourceDigest: string; digest: string; sourceStart: number; sourceEnd: number }; originalDigest: string; redactedDigest: string }>;
  synthesize(): Promise<never>;
}
