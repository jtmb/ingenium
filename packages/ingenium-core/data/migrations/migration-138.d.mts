import type Database from 'better-sqlite3';
export interface EvolutionResult {installed:boolean;version:number;dataBefore?:Record<string,unknown>;schema?:Record<string,string>}
export function installWorkspaceSuccessors138(db:Database.Database):EvolutionResult;
export function verifiedWorkspaceExecutionDefinitions(db:Database.Database):Record<string,string>|undefined;
