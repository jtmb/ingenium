import type {CustomizeEntry} from './catalog.mjs';
export interface CatalogConnectionResult {outcome:'succeeded'|'unknown'|'refused';operationId:string;targetName:string;sourceChanged:boolean;value?:{installationId:string;kind:'plugin'|'skill';projectId:string;resourceId:string|null;proposalId:string|null;state:'staged-disabled'|'proposal-review-required';sourceSha256:string}}
export interface CatalogConnection {pending():{operationId:string;targetName:string}|null;connect(name:string):Promise<CatalogConnectionResult>;inspect():Promise<CatalogConnectionResult|null>}
export function createCatalogConnection(input:{entry:CustomizeEntry;request:<T>(path:string,options?:RequestInit)=>Promise<T>;storage:Pick<Storage,'getItem'|'setItem'|'key'|'length'>;randomUUID:()=>string}):CatalogConnection;
