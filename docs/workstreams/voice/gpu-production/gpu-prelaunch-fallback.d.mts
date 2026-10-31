declare const prelaunch:unique symbol;
export interface GpuPreferredPrelaunch {readonly [prelaunch]:true}
export function beginGpuPreferredPrelaunch():GpuPreferredPrelaunch;
export function inspectGpuPreferredPrelaunch(handle:GpuPreferredPrelaunch):Readonly<{preferred:'gpu';selected:'cpu-onnx';gpuAttempted:false;gpuQualified:false;reason:'GPU_MANAGED_PRODUCER_UNAVAILABLE';selectionBoundary:'before-call-resource';implementationIncomplete:true}>;
export function takeKnownNoGpuStartCpuBackup(handle:GpuPreferredPrelaunch):'cpu-onnx';
