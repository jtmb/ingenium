import type { Actor, DotScope, Followup, Schedule, Suggestion } from "../../../../packages/veyra-automation/contracts.js";
import type { MissedPolicy } from "../../../../packages/veyra-automation/contracts.js";
import { DotConflict } from "./repository.js";
import { DotError, type DotService } from "./service.js";
export type DotCommand =
 | { type:"propose"; input:Pick<Suggestion,"title"|"prompt"|"source"|"capabilities"|"expiresAt"> }
 | { type:"approve"; id:string; revision:number; input:{jobId:string;schedule:Schedule;missedPolicy:MissedPolicy;notificationPolicy:Followup["notificationPolicy"]} }
 | { type:"dismiss"|"cancel"|"read"|"skip-missed"; id:string; revision:number }
 | { type:"pause"; id:string; revision:number; paused:boolean };
export function executeDotCommand(service: DotService, actor: Actor, scope: DotScope, command: DotCommand): unknown {
  if (!command || typeof command !== "object") throw new DotError("DOT_VALIDATION");
  if (command.type !== "propose") {
    if (typeof command.id !== "string" || !command.id.length || !Number.isSafeInteger(command.revision) || command.revision < 0) throw new DotError("DOT_VALIDATION");
  }
  switch (command.type) {
    case "propose": return service.propose(actor,scope,command.input);
    case "approve": return service.approve(actor,scope,command.id,command.revision,command.input);
    case "dismiss": return service.dismiss(actor,scope,command.id,command.revision);
    case "cancel": return service.cancel(actor,scope,command.id,command.revision);
    case "skip-missed": return service.skipMissed(actor,scope,command.id,command.revision);
    case "read": return service.markRead(actor,scope,command.id,command.revision);
    case "pause":
      if (typeof command.paused !== "boolean") throw new DotError("DOT_VALIDATION");
      return service.setPaused(actor,scope,command.id,command.revision,command.paused);
    default: throw new DotError("DOT_VALIDATION");
  }
}
export function dotErrorResponse(error: unknown): { status:number; body:{error:{code:string;message:string}} } {
  const code = error instanceof DotConflict ? error.code : error instanceof DotError ? error.code : error instanceof RangeError ? "DOT_VALIDATION" : "DOT_INTERNAL_ERROR";
  const status = code === "DOT_REVISION_CONFLICT" ? 409 : code === "DOT_NOT_FOUND" ? 404 : ["DOT_FORBIDDEN","DOT_MEMORY_DISABLED","DOT_SOURCE_REVOKED"].includes(code) ? 403 : code === "DOT_INTERNAL_ERROR" ? 500 : ["DOT_JOB_BINDING_CHANGED","DOT_SOURCE_CONFLICT"].includes(code) ? 409 : 422;
  return {status,body:{error:{code,message:status===500 ? "Dot could not complete this operation. Inspect operation status before retrying." : code.replaceAll("_"," ")}}};
}
