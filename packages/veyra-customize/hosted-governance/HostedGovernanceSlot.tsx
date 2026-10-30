import type {BoundGovernanceTransport,Skill,Binding} from "./contracts";
import {HostedGovernance} from "./HostedGovernance";
import {bindingKey} from "./client";
/** Presentation metadata from an EXISTING Root-minted original, never transport enrollment. */
export function hostedGovernanceSlotFromOriginal(transport:BoundGovernanceTransport,
  onOpenSkillInSession?:(skill:Skill,binding:Binding)=>void) {
  try{bindingKey(transport.binding);if(!transport.current())return undefined;}catch{return undefined;}
  const b=transport.binding;
  return {serviceInstanceId:b.nativeServiceInstanceId,projectId:b.nativeProjectId,projectRevision:b.nativeProjectRevision,
    actorId:b.actorId,installationId:b.installationId,hostedProjectId:b.hostedProjectId,
    content:<HostedGovernance transport={transport} onOpenSkillInSession={onOpenSkillInSession}/>};
}
