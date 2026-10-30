import type {MemoryLifecycle,MemoryScope,InspectionSourcePage} from './lifecycle.mjs';
import type {RecallSourceReader} from './recall-availability.mjs';
export interface BoundedMemoryInspectionPage extends Omit<InspectionSourcePage,'sourceWindow'> {
 sourceWindow:InspectionSourcePage['sourceWindow']&{verifiedSources:number;unavailableSourceCount:number};
}
export function readBoundedMemoryInspection(input:{memory:MemoryLifecycle;scope:MemoryScope;reader:RecallSourceReader;
 candidateOffset?:number;limit?:number;maxSources?:number;
 consume:(read:()=>BoundedMemoryInspectionPage)=>BoundedMemoryInspectionPage|Promise<BoundedMemoryInspectionPage>;
}):Promise<BoundedMemoryInspectionPage>;
