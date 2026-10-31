// AUTHORED UNRUN: Root's future noEmit controls, no runtime invocation.
import type {VoiceControl} from './voice-operation-contract.js';
import type {CpuIdentity,VoiceOriginal} from './voice-operation-ledger.js';
import type {VoiceGpuDescriptor,VoiceGpuIdentity,VoiceGpuControlOriginal,SpeechParentKind} from './voice-gpu-contract.js';
declare const cpu:CpuIdentity,gpu:VoiceGpuIdentity,descriptor:VoiceGpuDescriptor;
declare const gpuControl:VoiceGpuControlOriginal;
const oldCpuControl:VoiceControl={instanceId:'unchanged',profileDigest:'a'.repeat(64),recoveryEndpointIdentity:'unchanged',retirementSecretSha256:'b'.repeat(64)};
// @ts-expect-error GPU identity is not a CpuIdentity or CPU cleanup proof.
const forbiddenCpu:CpuIdentity=gpu;
// @ts-expect-error CPU identity is not a GPU identity (no provider/device owner).
const forbiddenGpu:VoiceGpuIdentity=cpu;
// @ts-expect-error CPU kind cannot represent a GPU parent.
const forbiddenOriginal:VoiceOriginal=gpuControl;
// @ts-expect-error exact CPU control literal has no backend/device fields.
const forbiddenControl:VoiceControl={...oldCpuControl,backend:descriptor.backend};
const cpuParent:SpeechParentKind='voice-cpu-supervisor';
const gpuParent:SpeechParentKind='voice-gpu-supervisor';
declare const common:Omit<VoiceGpuDescriptor,'backend'|'platform'>;
const wslDirectml:VoiceGpuDescriptor={...common,backend:'directml',platform:'linux-wsl'};
const windowsDirectml:VoiceGpuDescriptor={...common,backend:'directml',platform:'win32'};
// @ts-expect-error plain Linux does not discriminate the pinned WSL deployment.
const bareLinuxDirectml:VoiceGpuDescriptor={...common,backend:'directml',platform:'linux'};
void [wslDirectml,windowsDirectml,bareLinuxDirectml];
void [forbiddenCpu,forbiddenGpu,forbiddenOriginal,forbiddenControl,cpuParent,gpuParent];
