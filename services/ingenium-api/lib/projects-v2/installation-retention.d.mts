import type {OwnerScope} from '../../../../packages/veyra-projects/contracts.js';
import type {DatabasePort} from './catalog.mjs';
export interface InstallationRetentionValue {key:'archive_retention_days';value:string|null;revision:number;valueHash:string;}
export interface InstallationRetentionIntent {operationId:string;expectedRevision:number;expectedValueHash:string;value:string;}
export interface InstallationRetentionResult {data:InstallationRetentionValue;receipt:{operationId:string;replayed:boolean;appliedRevision:number;};}
interface WriterPorts {db:DatabasePort;transaction:<T>(action:()=>T)=>T;checkpointAfterWrite:()=>void;}
export function bindInstallationSettingsOwner(ports:WriterPorts,legacyProjectId:string):boolean;
export class InstallationRetentionOwner {
 constructor(ports:WriterPorts & {authorize:(scope:OwnerScope,action:string,key:string)=>boolean;readPreference:(legacyProjectId:string,key:string)=>string|undefined;writePreference:(legacyProjectId:string,key:string,value:string)=>unknown;});
 read(scope:OwnerScope):InstallationRetentionValue;
 write(scope:OwnerScope,intent:InstallationRetentionIntent):InstallationRetentionResult;
}