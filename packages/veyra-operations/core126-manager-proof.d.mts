import type {Core126ManagerProof} from './core126-image-owner.mjs';
/** The original manager's private Docker request closure. Only GETs are issued. */
export function createCore126ManagerProofProducer(ports:{docker:(method:'GET',path:string)=>Promise<{status:number;data:unknown}>;now?:()=>number}):Readonly<{observe(runtimeId:string):Promise<Readonly<Core126ManagerProof>>}>;