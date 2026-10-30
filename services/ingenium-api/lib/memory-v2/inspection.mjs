import {MemoryError} from './lifecycle.mjs';

/** Management read orchestration only. Root supplies the actual current placement
 * and authorization barrier before consume; no actor/engine authority is invented.
 */
export async function readBoundedMemoryInspection({memory,scope,reader,candidateOffset=0,limit=25,maxSources=32,consume}) {
  if(!reader||typeof reader.prime!=='function'||typeof reader.withVerifiedSources!=='function'
    ||typeof reader.invalidate!=='function'||typeof consume!=='function')throw new MemoryError('INVALID_ADAPTER');
  try {
    const plan=memory.planInspectionSources(scope,{candidateOffset,limit,maxSources});
    const qualification=await reader.prime(plan.sourceRefs);
    return await consume(()=>reader.withVerifiedSources(()=>{
      const page=memory.inspectSourcePlan(scope,plan);
      return {...page,sourceWindow:{...page.sourceWindow,verifiedSources:qualification.verifiedSources,
        unavailableSourceCount:qualification.unavailableSources.length}};
    }));
  }finally{reader.invalidate();}
}
