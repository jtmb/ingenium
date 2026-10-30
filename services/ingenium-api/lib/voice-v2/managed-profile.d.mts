export interface ManagedCpuSettings {
  readonly version: 1;
  readonly backend: 'cpu-onnx';
  readonly instance_id: string;
  readonly host: '127.0.0.1';
  readonly port: number;
  readonly private_network: false;
  readonly model_root: string;
  readonly model_manifest: string;
  readonly token_file: string;
  readonly scratch_root: string;
  readonly cpu_threads: number;
}
export interface ManagedCpuProfileInput {
  readonly version: 1;
  readonly enableInference: true;
  readonly python: string;
  readonly pythonSha256: string;
  readonly workerRoot: string;
  readonly bundle: Readonly<Record<string, string>>;
  readonly pythonPaths: readonly string[];
  readonly settings: ManagedCpuSettings;
  readonly memoryBytes: number;
  readonly defaultVoice: string;
  readonly recoveryTransport: 'abstract-unix';
}
export class ManagedCpuProfile {
  static load(path: string): ManagedCpuProfile;
  constructor(input: ManagedCpuProfileInput);
  readonly value: ManagedCpuProfileInput;
  readonly settings: ManagedCpuSettings;
  readonly token: string;
  readonly profileDigest: string;
  readonly endpoint: string;
  readonly helperSource: string;
  readonly witnessSource: string;
  bootstrap(key: Uint8Array, owner: { instanceId: string; ownerId: string; ownerGeneration: number }): Uint8Array;
}
