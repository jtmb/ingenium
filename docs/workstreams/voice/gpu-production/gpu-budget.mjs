// Pure conservative DATA validation. No budget result is an admission grant.
const fail=code=>{throw Object.assign(Error(code),{code});};
const integer=n=>Number.isSafeInteger(n)&&n>=0;
const exact=(v,keys)=>v&&typeof v==='object'&&!Array.isArray(v)&&Object.keys(v).sort().join()===keys.slice().sort().join();
const sha=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
const sum=(...values)=>{if(values.some(v=>!integer(v)))fail('GPU_BUDGET_INTEGER');const total=values.reduce((a,b)=>a+BigInt(b),0n);if(total>BigInt(Number.MAX_SAFE_INTEGER))fail('GPU_BUDGET_OVERFLOW');return Number(total);};
const phases=['cold','hot','retirement'];
export function validateGpuPeakPlan(plan){
 if(!exact(plan,['version','backend','profileDigest','providerDigest','modelSetDigest','measurementDigest','sttMeasured','ttsMeasured','reserveVramBytes','externalGrowthBytes','reserveRamBytes','reserveTasks','cpuMilli','phases'])
  ||plan.version!==1||!['directml','rocm','cuda'].includes(plan.backend)||!['profileDigest','providerDigest','modelSetDigest','measurementDigest'].every(k=>sha(plan[k]))
  ||plan.sttMeasured!==true||plan.ttsMeasured!==true||!exact(plan.phases,phases)
  ||!['reserveVramBytes','externalGrowthBytes','reserveRamBytes','reserveTasks','cpuMilli'].every(k=>integer(plan[k]))
  ||plan.reserveVramBytes<1073741824||plan.externalGrowthBytes<1||plan.reserveRamBytes<1||plan.reserveTasks<1||plan.cpuMilli<1)fail('GPU_PEAK_PLAN_INVALID');
 for(const name of phases){const p=plan.phases[name];
  if(!exact(p,['vramPeakBytes','ramPeakBytes','additionalTasks'])||!['vramPeakBytes','ramPeakBytes','additionalTasks'].every(k=>integer(p[k]))
   ||p.ramPeakBytes<1||p.additionalTasks<1||name!=='retirement'&&p.vramPeakBytes<1)fail('GPU_PEAK_PHASE_INVALID');
  sum(p.vramPeakBytes,plan.reserveVramBytes,plan.externalGrowthBytes);sum(p.ramPeakBytes,plan.reserveRamBytes);sum(p.additionalTasks,plan.reserveTasks);
 }
 return plan; // not a measured-profile original; caller must never promote DATA
}
/** kernel.gpu represents whole visible-driver accounting, including existing
 * allocations. Do not subtract desktop/LLM occupancy twice or claim exclusivity.
 * Source/driver/provider custody and live slot admission are SEPARATE owners.
 */
export function evaluateGpuHeadroom(plan,kernel,host,phase,now){
 validateGpuPeakPlan(plan);
 if(!phases.includes(phase)||!integer(now)||!exact(kernel,['deviceIdentity','bootId','sampleStartedAt','observedAt','totalBytes','usedBytes','availableBytes','scope','observationOnly'])
  ||!sha(kernel.deviceIdentity)||typeof kernel.bootId!=='string'||!/^[a-f0-9]{8}-(?:[a-f0-9]{4}-){3}[a-f0-9]{12}$/.test(kernel.bootId)||kernel.scope!=='visible-amdgpu-driver'||kernel.observationOnly!==true
  ||!['sampleStartedAt','observedAt','totalBytes','usedBytes','availableBytes'].every(k=>integer(kernel[k]))||kernel.totalBytes<1||kernel.usedBytes>kernel.totalBytes
  ||kernel.availableBytes!==kernel.totalBytes-kernel.usedBytes||kernel.sampleStartedAt>kernel.observedAt||kernel.observedAt>now||now-kernel.sampleStartedAt>250
  ||!host||!['memoryHeadroom','pidsHeadroom','cpuMilli'].every(k=>integer(host[k])))fail('GPU_KERNEL_OBSERVATION_INVALID');
 const p=plan.phases[phase],requiredVramBytes=sum(p.vramPeakBytes,plan.reserveVramBytes,plan.externalGrowthBytes),requiredRamBytes=sum(p.ramPeakBytes,plan.reserveRamBytes),requiredTasks=sum(p.additionalTasks,plan.reserveTasks);
 const reasons=[];
 if(kernel.availableBytes<requiredVramBytes)reasons.push('GPU_VRAM_HEADROOM');
 if(host.memoryHeadroom<requiredRamBytes)reasons.push('GPU_RAM_HEADROOM');
 if(host.pidsHeadroom<requiredTasks)reasons.push('GPU_TASK_HEADROOM');
 if(host.cpuMilli<plan.cpuMilli)reasons.push('GPU_CPU_HEADROOM');
 return Object.freeze({fits:reasons.length===0,reasons:Object.freeze(reasons),requiredVramBytes,requiredRamBytes,requiredTasks,
  observationOnly:true,admissionAuthorized:false,deviceIdentity:kernel.deviceIdentity});
}
