import type { VoiceScope, VoiceTurn } from '../../../../packages/veyra-voice/session.mjs';
export interface CurrentAgentBinding {
  verified: true;
  scope: VoiceScope;
  sessionId: string;
  directory: string;
  protocol: 'opencode-v2.0.11';
}
export interface NativeVoiceEvent {
  scope: VoiceScope;
  nativeSessionId: string;
  promptId: string;
  type: 'tool' | 'approval';
  callId?: string;
  label: string;
  status?: 'running' | 'completed' | 'failed';
  approvalId?: string;
}
export interface NativeVoiceObservation {
  ready: Promise<void>;
  result: Promise<{ scope: VoiceScope; nativeSessionId: string; promptId: string; outcome: 'succeeded' | 'failed' | 'interrupted'; text: string; usage?: unknown }>;
  ownsPermission(id: string): boolean;
  ownsExecution(): boolean;
  stop(): void;
}
export interface NativeVoiceRequest { context?: unknown; scope: VoiceScope; turn: VoiceTurn; signal?: AbortSignal }
export interface CurrentAgentDependencies {
  request?: (path: string, options?: { method?: string; body?: unknown; query?: Record<string, string | number | undefined>; signal?: AbortSignal }) => Promise<unknown>;
  resolveBinding?: (request: { context?: unknown; scope: VoiceScope; action: string; signal?: AbortSignal }) => Promise<CurrentAgentBinding | null>;
  withBinding?: <T>(binding: CurrentAgentBinding, work: () => Promise<T>) => Promise<T>;
  observeTurn?: (request: NativeVoiceRequest & { nativeSessionId: string; promptId: string; onEvent(event: NativeVoiceEvent): void }) => Promise<NativeVoiceObservation>;
}
export function nativeVoiceMessageId(scope: VoiceScope, operationId: string): string;
export class CurrentAgentVoiceAdapter {
  constructor(dependencies: CurrentAgentDependencies);
  availability(context: unknown, scope: VoiceScope, signal?: AbortSignal): Promise<{ state: 'available' | 'unavailable'; reason: string | null; duplex: 'half-duplex'; preservesSessionModel: true; scope?: VoiceScope; protocol?: string }>;
  submit(request: NativeVoiceRequest & { text: string; delivery: 'prompt' | 'steer' | 'queue'; onEvent?(event: unknown): void }): Promise<{ scope: VoiceScope; requestId: string; text: string; usage?: unknown }>;
  steer(request: NativeVoiceRequest & { text: string; delivery: 'steer' | 'queue'; operationId: string }): Promise<{ accepted: true; requestId: string; operationId: string; scope: VoiceScope }>;
  approve(request: NativeVoiceRequest & { approvalId: string; decision: 'allow-once' | 'deny' }): Promise<void>;
  interrupt(request: NativeVoiceRequest): Promise<{ acknowledged: true; requestId: string; scope: VoiceScope }>;
  closeVoice(request: { context?: unknown; scope: VoiceScope; sessionId: string }): Promise<void>;
}
