import type {CustomizeEntry} from './catalog.mjs';
export interface PublishedCatalogBinding {actorUserId:string;projectId:string;apiProject:string;visibility:'public'|'personal'}
export function createPublishedCatalogPageReader(request:<T>(path:string,options?:RequestInit)=>Promise<T>,binding:PublishedCatalogBinding):(kind:'plugin'|'skill')=>Promise<CustomizeEntry[]>;
