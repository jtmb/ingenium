import type Database from 'better-sqlite3';
export interface LearnedMemorySuppressionLedger {
 version:1;
 entries:Array<{scope_key:string;kind:'memory'|'source'|'content';target:string;receipt_id:string}>;
 receipts:Array<{scope_key:string;operation_id:string;request_hash:string;receipt_json:string}>;
 sha256:string;
}
export function captureLearnedMemorySuppressions(db:Database.Database):LearnedMemorySuppressionLedger;
export function mergeLearnedMemorySuppressions(db:Database.Database,ledger:LearnedMemorySuppressionLedger):{erased:number};
