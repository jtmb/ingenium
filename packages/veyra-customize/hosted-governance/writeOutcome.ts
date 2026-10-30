
import type {OperationReceipt} from "./contracts";
import type {SkillWriteResult} from "./skill-write-outcomes.mjs";
/** A Root success receipt is stronger than a malformed create-response body. */
export function adaptSkillResult(value:SkillWriteResult,receipt:OperationReceipt|null):SkillWriteResult {
  const result=normalizeOriginalRefusal(value),command=receipt?.original.command,attempt=result.attempt;
  if(["unknown","verified"].includes(result.status)&&receipt?.outcome==="succeeded"&&command?.op==="create"&&attempt
    &&command.name===attempt.name&&command.content===attempt.content&&command.description===attempt.description
    &&receipt.original.binding.apiProject===attempt.project) {
    if(result.status==="verified")return {...result,writeConfirmed:true,message:"Stored content verified and the original owner confirmed creation; no upload was replayed."};
    return {...result,status:"saved-refresh-failed",writeConfirmed:true,
      message:"The original owner acknowledged creation, but its response or readback could not be verified. Verify stored content before another upload."};
  }
  return result;
}

/** Explicit Root receipt proof adapts C4's HTTP-only classifier without inventing a status. */
export function normalizeOriginalRefusal<T extends {status:string;message:string;failure?:{original?:unknown}}>(result:T):T {
  const cause=result.failure?.original;
  return result.status==="unknown"&&cause!==null&&typeof cause==="object"&&"rootOutcome" in cause&&cause.rootOutcome==="refused"
    ? {...result,status:"refused",message:"The original owner refused this change: "+("message" in cause&&typeof cause.message==="string"?cause.message:"No write was confirmed.")} : result;
}
