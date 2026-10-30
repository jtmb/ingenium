export interface CaptureSamples { frames: Float32Array[]; rate: number }
export interface CaptureResource { stream: MediaStream; context: AudioContext; source: MediaStreamAudioSourceNode; processor: ScriptProcessorNode; gain: GainNode }
export interface CapturePorts {
  media: Pick<MediaDevices, 'getUserMedia'>;
  createContext(): AudioContext;
  isCurrent(): boolean;
  claim(): boolean;
  release(): void;
  onPcm(frame: Float32Array, rate: number): void;
  onEnded(): void;
  onProblem(message: string): void;
}
export class LocalCapture {
  readonly intent: boolean;
  readonly resource: CaptureResource | null;
  readonly failures: { resource: unknown; error: unknown }[];
  readonly blocked: boolean;
  readonly closing: boolean;
  begin(): number;
  current(ticket: number): boolean;
  stop(): { released: boolean; pending: boolean };
  open(ticket: number, ports: CapturePorts): Promise<boolean>;
}
export function retainUnsubmitted(queued: CaptureSamples | null, capture: { frames: Float32Array[] } | null, resource: CaptureResource | null): CaptureSamples | null;
