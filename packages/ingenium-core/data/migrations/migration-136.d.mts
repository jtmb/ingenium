import type Database from 'better-sqlite3';
export interface EvolutionResult {installed:boolean;version:number;dataBefore?:Record<string,unknown>;schema?:Record<string,string>}
export function installContext136(db:Database.Database):EvolutionResult;
export function hasVerifiedContext136(db:Database.Database):boolean;
