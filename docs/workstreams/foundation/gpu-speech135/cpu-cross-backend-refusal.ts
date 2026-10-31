import type {VoiceSqlDb} from './voice-operation-ledger.js';
/** Negative only. Called with the ACTUAL fixed installation voice instance,
 * after original CPU owner validation. Never merge GPU rows into CPU controls.
 * Missing135 is allowed only for exact old CPU fixtures/pre135 startup; partial
 * schema or outstanding GPU originals refuse, never a data->admit conversion. */
export function refuseOutstandingGpuForCpu(database:VoiceSqlDb,instanceId:string):void {
 const names=['veyra_voice_gpu_schema','veyra_voice_gpu_controls','veyra_voice_gpu_operations'];
 const present=names.filter(name=>database.prepare("SELECT 1 FROM sqlite_master WHERE type='table' AND name=?").get(name));
 const fail=():never=>{throw Object.assign(Error('VOICE_CPU_GPU_ORIGINAL_CLEANUP_REQUIRED'),{code:'VOICE_CPU_GPU_ORIGINAL_CLEANUP_REQUIRED',status:503});};
 if(present.length===0){
  if(database.prepare("SELECT 1 FROM sqlite_master WHERE name GLOB 'gpu135_*' LIMIT 1").get())return fail();
  return;
 }
 if(present.length!==names.length)return fail();
 const marker=database.prepare('SELECT singleton,version FROM veyra_voice_gpu_schema').all() as {singleton:number;version:number}[];
 if(marker.length!==1||marker[0]?.singleton!==1||marker[0]?.version!==1)return fail();
 if(database.prepare(`SELECT 1 FROM veyra_voice_gpu_controls WHERE instance_id=? AND resource_retired=0 LIMIT 1`).get(instanceId))return fail();
 if(database.prepare(`SELECT 1 FROM veyra_voice_gpu_operations o JOIN veyra_voice_gpu_controls c ON c.control_id=o.control_id WHERE c.instance_id=? AND o.resource_retired=0 LIMIT 1`).get(instanceId))return fail();
}
