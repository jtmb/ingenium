export interface VoiceScope { actorId: string; accountId: string; organizationId: string | null; projectId: string | null; conversationId: string; runtimeId: string; executionBindingId: string; executionRevision: string; agentId: string }
export type VoiceMode = 'dictation' | 'agent-call' | 'conversation';
export interface VoiceTurn { sessionId: string; turnId: number; generation: number; requestId: string }
export interface VoiceSnapshot { phase: string; muted: boolean; transcript: string; reply: string; tools: { callId: string; label: string; status: string }[]; approval: { id: string; label: string } | null; error: string | null; generation: number }
export interface VoiceRequest { scope: VoiceScope; turn: VoiceTurn; signal: AbortSignal }
export interface SpeechSegment { index: number; total: number; sourceStart: number; sourceEnd: number; sourceDigest: string; digest: string; kind: string; text: string }
export interface SpeechChildOperation { requestId: string; parentRequestId: string; generation: number; sourceStart: number; sourceEnd: number; sourceDigest: string; digest: string }
export interface VoiceEvent extends VoiceTurn { scope: VoiceScope; type: 'tool' | 'approval' | 'transcript.partial'; callId?: string; label?: string; status?: string; approvalId?: string; text?: string }
export interface VoicePorts {
  connect(request: { scope: VoiceScope; mode: VoiceMode; sessionId: string; signal: AbortSignal }): Promise<{ scope: VoiceScope; sessionId: string; allowed: boolean }>;
  transcribe(request: VoiceRequest & { pcm: Uint8Array }): Promise<{ text: string }>;
  dictation(request: VoiceRequest & { text: string }): Promise<void>;
  submit(request: VoiceRequest & { text: string; delivery: 'prompt' | 'steer' | 'queue'; onEvent(event: VoiceEvent): boolean }): Promise<{ scope: VoiceScope; requestId: string; text: string }>;
  synthesize(request: VoiceRequest & { text: string }): Promise<Uint8Array>;
  speechSequence?(request: VoiceRequest & { text: string }): AsyncIterable<{ wav: Uint8Array; operation: SpeechChildOperation; segment: SpeechSegment }>;
  complete(request: VoiceRequest): Promise<void>;
  approve(request: VoiceRequest & { approvalId: string; decision: 'allow-once' | 'deny' }): Promise<void>;
  steer(request: VoiceRequest & { operationId: string; text: string; delivery: 'steer' | 'queue' }): Promise<{ scope: VoiceScope; requestId: string; operationId: string; accepted: boolean }>;
  interrupt(request: VoiceRequest): Promise<{ acknowledged: boolean; requestId: string; scope: VoiceScope }>;
  disconnect(request: { scope: VoiceScope; sessionId: string }): Promise<void>;
  play(request: { wav: Uint8Array; turn: VoiceTurn; signal: AbortSignal; speechOperation?: SpeechChildOperation; segment?: SpeechSegment }): Promise<void>;
  stopPlayback(): void;
  stopCapture(): void;
}
export class VoiceError extends Error { code: string; constructor(code: string) }
export function validateScope(scope: unknown): Readonly<VoiceScope>;
export function sameScope(a: unknown, b: unknown): boolean;
export function validateTurn(turn: unknown): VoiceTurn;
export class VoiceSession {
  constructor(options: { scope: VoiceScope; mode: VoiceMode; sessionId: string; ports: VoicePorts; interruptDeadlineMs?: number });
  readonly scope: Readonly<VoiceScope>; readonly mode: VoiceMode;
  subscribe(listener: () => void): () => void;
  getSnapshot(): VoiceSnapshot;
  reportError(code: string): void;
  connect(): Promise<boolean>;
  receive(pcm: Uint8Array): Promise<void>;
  sendText(text: string, delivery?: 'prompt' | 'steer' | 'queue'): Promise<void>;
  acceptEvent(event: VoiceEvent): boolean;
  decideApproval(decision: 'allow-once' | 'deny'): Promise<void>;
  interrupt(): Promise<void>;
  bargeIn(options: { echoCancelled: boolean; speechConfirmed: boolean }): Promise<boolean>;
  mute(muted: boolean): Promise<void>;
  reconnect(): Promise<boolean>;
  end(): Promise<void>;
}
