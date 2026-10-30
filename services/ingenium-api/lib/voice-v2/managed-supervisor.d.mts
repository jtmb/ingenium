import type { CoreVoiceLedger, VoiceOperationAuthorities, voiceOperations } from 'ingenium-core';
import type { VoiceScope, VoiceTurn } from '../../../../packages/veyra-voice/session.mjs';
import type { ManagedCpuProfile } from './managed-profile.mjs';
import type { ChildProcess } from 'node:child_process';
declare const originalScope: unique symbol;
declare const originalDispatch: unique symbol;
export interface CpuAdmission { readonly deadlineAt: number }
export interface SupervisedCpuScope<C> {
  readonly [originalScope]: never;
  readonly context: C;
  readonly scope: VoiceScope;
  readonly owner: voiceOperations.VoiceOwner;
  readonly controlOperationId: string;
  readonly deadlineAt: number;
  readonly child: ChildProcess | null;
  readonly closing: boolean;
  readonly physicalRetired: boolean;
  readonly admission: CpuAdmission | null;
}
export interface CpuDispatch {
  readonly [originalDispatch]: never;
  readonly operationId: string;
  readonly requestId: string;
  readonly parentOperationId: string | null;
  readonly turnGeneration: number;
}
export interface CpuSupervisorStatus {
  ready: boolean; gpuReady: false; backend: 'cpu-onnx'; qualified: false;
  instanceId: string; voices: readonly string[]; configuredDefaultVoice: string;
}
export interface ManagedCpuDependencies<C> {
  profile: ManagedCpuProfile;
  ledger: CoreVoiceLedger<C>;
  bindContext(context: C, scope: SupervisedCpuScope<C>, producer: ManagedCpuSupervisor<C>): C;
  admitCpu(input: { context: C; scope: VoiceScope; owner: voiceOperations.VoiceOwner; profileDigest: string; memoryBytes: number; cpuThreads: number; deadlineAt: number; signal?: AbortSignal }): CpuAdmission | Promise<CpuAdmission>;
  requireCpuAdmission(admission: CpuAdmission | null, scope: SupervisedCpuScope<C>): void;
  releaseCpu(admission: CpuAdmission | null, proof: object, producer: ManagedCpuSupervisor<C>): void | Promise<void>;
  admitCpuWitness(input: {context:C;scope:SupervisedCpuScope<C>;profileDigest:string;deadlineAt:number}):CpuAdmission|Promise<CpuAdmission>;
  releaseCpuWitness(admission:CpuAdmission,proof:object,producer:ManagedCpuSupervisor<C>):void|Promise<void>;
  fetch?: typeof globalThis.fetch;
  /** Fixture-only override. Product omits it and retains the actual spawn API. */
  spawn?: typeof import('node:child_process').spawn;
}
export class ManagedCpuSupervisor<C> {
  constructor(dependencies: ManagedCpuDependencies<C>);
  status(): CpuSupervisorStatus;
  inspectResourceRetirement(proof:object):Readonly<{manager:ManagedCpuSupervisor<C>;scope:SupervisedCpuScope<C>;owner:voiceOperations.VoiceOwner;admission:CpuAdmission|null;retired:true;kind:"physical"|"sealed-before-fork"|"witness-retired"|"witness-before-fork"}>;
  isOwnedScope(value: unknown): value is SupervisedCpuScope<C>;
  requireOriginalResource: VoiceOperationAuthorities<C>['requireOriginalResource'];
  verifyRetirement: VoiceOperationAuthorities<C>['verifyRetirement'];
  openScope(input: { context: C; scope: VoiceScope; sessionId: string; deadlineAt: number; signal?: AbortSignal }): Promise<CpuSupervisorStatus>;
  releaseSession(input: { sessionId: string; scope: VoiceScope }): Promise<void>;
  reserveCpu(input: { context: C; scope: VoiceScope; turn: VoiceTurn; requestId: string; parentOperationId?: string | null; deadlineAt: number; kind: 'transcribe' | 'synthesize'; pcm?: Uint8Array; text?: string; voice?: string }): CpuDispatch;
  executeCpu(handle: CpuDispatch, options?: { signal?: AbortSignal }): Promise<{ retired: true; resultAvailable: boolean; bytes?: Uint8Array; status?: number; operationId: string; requestId: string }>;
  inspectCpu(handle: CpuDispatch): voiceOperations.VoiceMetadata;
  cancelPrepared(handle: CpuDispatch): void;
  stopScope(scope?: SupervisedCpuScope<C>, deadlineAt?: number): Promise<void>;
}
