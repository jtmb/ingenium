import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import * as skills from "./skills.js";
import * as skillGovernance from "./skill-governance.js";
import * as maintenanceLocks from "./maintenance-locks.js";
import { createHostedGovernance, HostedRefusal, type Ports, type Row, type SqlDb } from "./hosted-governance.js";

import { deriveHostedProjectionPlan, createHostedProjectionObserver } from "./hosted-projection-plan.js";

export type HostedGovernanceAuthentication = Pick<Ports,
  "actor"|"allow"|"systemAllowed"|"verifyEnrollment"|"verifyNativeOwner"|"read">;

/** Existing Core domain/projection owners execute inside the new outer effect transaction. */
export function createHostedGovernanceOwner(authentication: HostedGovernanceAuthentication) {
  return createHostedGovernance({
    ...authentication,
    db:()=>getDb() as unknown as SqlDb,
    transaction:work=>execTransaction(work,1,"immediate"),
    checkpoint:checkpointAfterWrite,
    isSafeSkillName:skills.isSafeSkillName,
    isValidSkillFileTree:skills.isValidSkillFileTree,
    locks:projectId=>maintenanceLocks.listActiveLocks("skills")
      .filter(lock=>lock.resource==="skills"&&(lock.project_id===projectId||lock.project_id==="*")),
    projectionPlan:original=>deriveHostedProjectionPlan(getDb() as unknown as SqlDb,original),
    execute(command:Row,binding:Row,actor,operationId,projection) {
      if(!projection.plan||projection.plan.operationId!==operationId)throw new Error("Original projection plan required");
      return skills.withStrictSkillProjection(createHostedProjectionObserver(projection.plan,projection.events),()=>{
      const project=binding.hostedProjectId,name=command.name;
      switch(command.op) {
        case "create":
          return skills.createSkillAbsentInCurrentTransaction(project,name,command.description,command.content) as unknown as Row;
        case "save":
          return skills.updateSkill(project,name,command.content,undefined,command.extra.tags,
            command.extra.always_apply,command.extra.files) as unknown as Row|undefined;
        case "archive":return skills.archiveSkill(project,name) as unknown as Row|undefined;
        case "restore":return skills.restoreSkill(project,name) as unknown as Row|undefined;
        case "enable":return skills.enableSkill(project,name) as unknown as Row|undefined;
        case "disable":return skills.disableSkill(project,name) as unknown as Row|undefined;
        case "submit":return skillGovernance.submitProposal(project,command.id) as unknown as Row|undefined;
        case "approve":return skillGovernance.approveProposal(project,command.id,actor.id,command.reason) as unknown as Row;
        case "reject":return skillGovernance.rejectProposal(project,command.id,actor.id,command.reason) as unknown as Row;
        case "rollback":return skillGovernance.rollbackProposal(project,command.id,actor.id,command.reason) as unknown as Row;
        default:throw new HostedRefusal("UNSUPPORTED_COMMAND",422);
      }
      });
    },
  });
}
