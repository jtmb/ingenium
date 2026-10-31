// Actual current source has NO managed GPU producer. This gate implements only
// fixed known-no-start CPU backup, never post-start GPU retirement. No status DTO,
// provider/CPU proof, filesystem observation or callback can create GPU authority.
const originals=new WeakMap();
const fail=code=>{throw Object.assign(Error(code),{code,status:503});};
export function beginGpuPreferredPrelaunch(){
 const handle=Object.freeze({});
 // There is deliberately no provider import, device open, warmup or GPU effect
 // in this implementation. Root must replace this closure with a genuine owner
 // integration to make GPU selectable; changing a flag cannot qualify GPU.
 originals.set(handle,{consumed:false});return handle;
}
export function inspectGpuPreferredPrelaunch(handle){
 if(!originals.has(handle))fail('GPU_PRELAUNCH_ORIGINAL_REQUIRED');
 return Object.freeze({preferred:'gpu',selected:'cpu-onnx',gpuAttempted:false,gpuQualified:false,
  reason:'GPU_MANAGED_PRODUCER_UNAVAILABLE',selectionBoundary:'before-call-resource',implementationIncomplete:true});
}
export function takeKnownNoGpuStartCpuBackup(handle){
 const held=originals.get(handle);if(!held||held.consumed)fail('GPU_PRELAUNCH_ORIGINAL_REQUIRED');
 held.consumed=true;
 // Authorizes no CPU effect. Existing ManagedCpuProfile/resource approval/Core
 // admission must still succeed. No replay of any message/PCM/plan is performed.
 return 'cpu-onnx';
}
