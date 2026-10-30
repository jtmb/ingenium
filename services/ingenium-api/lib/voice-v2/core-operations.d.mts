import type { CoreVoiceLedger, voiceOperations } from 'ingenium-core';
import type { VoiceScope, VoiceTurn } from '../../../../packages/veyra-voice/session.mjs';
declare const originalHandle: unique symbol;
export interface AgentOperationHandle {
  readonly [originalHandle]: never;
  readonly accepted: true;
  readonly operationId: string;
  readonly original: voiceOperations.VoiceOriginal;
}
export interface AgentOriginalRequest<C> {
  context: C; scope: VoiceScope; turn: VoiceTurn; requestId: string;
  kind: 'voice-agent-turn' | 'voice-agent-steer' | 'voice-agent-queue';
  text: string; delivery: 'prompt' | 'steer' | 'queue'; parentOperationId?: string | null; deadlineAt: number;
}
export function voiceOperationId(scope: VoiceScope, requestId: string, kind: AgentOriginalRequest<unknown>['kind']): string;
export function agentResultFingerprint(result: { scope: VoiceScope; requestId: string; text: string }): string;
export function controlResultFingerprint(operationId: string): string;
export function agentInputFingerprint(input: { scope: VoiceScope; turn: VoiceTurn; text: string; delivery: 'prompt' | 'steer' | 'queue'; parentOperationId?: string | null }): string;
export class CoreVoiceOperations<C> {
  constructor(dependencies: { ledger: CoreVoiceLedger<C>; bindOriginal(input: { context: C; original: voiceOperations.VoiceOriginal }): { context: C; owner: voiceOperations.VoiceOwner; deadlineAt: number } });
  readonly contract: 'veyra-core-voice-128';
  reserve(input: AgentOriginalRequest<C>): AgentOperationHandle;
  claim(handle: AgentOperationHandle): void;
  retire(handle: AgentOperationHandle, proof: object): voiceOperations.VoiceMetadata;
  isRetired(handle: AgentOperationHandle): boolean;
  settle(input: { reservation: AgentOperationHandle; outcome: 'completed' | 'unknown'; result?: { scope: VoiceScope; requestId: string; text: string }; proof?: object }): voiceOperations.VoiceMetadata;
}
