import type Database from 'better-sqlite3';
export interface EvolutionResult {installed:boolean;version:number;dataBefore?:Record<string,unknown>;schema?:Record<string,string>}
export function installKubernetesWorkspace141(db:Database.Database):EvolutionResult;
export function verifiedKubernetesWorkspaceDefinitions(db:Database.Database):Record<string,string>|undefined;
export function requireKubernetesWorkspace141(db:{prepare(sql:string):{get(...args:unknown[]):unknown}}):Record<string,string>;
