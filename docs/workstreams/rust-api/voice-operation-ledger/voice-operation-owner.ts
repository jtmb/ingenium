import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { createCoreVoiceOperationLedger, type VoiceLedgerPorts } from "./voice-operation-ledger.js";
import type { CoreVoiceLedger } from "./contract-v1.js";

export type VoiceOperationAuthorities<C> = Pick<VoiceLedgerPorts<C>,"currentScope"|"verifyRetirement"|"requireOriginalResource">;
/** Core-owned connection/transaction; API supplies actual closed request and private retirement authorities. */
export function createVoiceOperationOwner<C>(authorities:VoiceOperationAuthorities<C>):CoreVoiceLedger<C> {
  return createCoreVoiceOperationLedger({
    ...authorities,db:()=>getDb(),
    transaction:(work,mode)=>execTransaction(work,1,mode),checkpoint:checkpointAfterWrite,now:Date.now,
  });
}
