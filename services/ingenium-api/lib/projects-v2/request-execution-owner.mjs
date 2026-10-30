import {createHash} from "node:crypto";

export class RequestExecutionError extends Error {
  constructor(code,status=503) {super(code);this.name="RequestExecutionError";this.code=code;this.status=status;}
}
const deny=(code,status=503)=>{throw new RequestExecutionError(code,status);};
const text=(value,maximum=512)=>typeof value==="string" && value.length>0 && value.length<=maximum && value===value.trim() && !/[\u0000-\u001f\u007f]/.test(value);
const hash=value=>typeof value==="string" && /^[a-f0-9]{64}$/.test(value);
const snapshot=value=>JSON.parse(JSON.stringify(value));
const signature=identity=>JSON.stringify({
  type:identity.principal.type,id:identity.principal.id,scopes:[...new Set(identity.principal.scopes??[])].sort(),
  tokenId:identity.principal.tokenId,sessionId:identity.principal.session?.id,securityEpoch:identity.principal.session?.security_epoch,
  organizationId:identity.principal.organizationId,projectId:identity.principal.projectId,
  projectIds:identity.principal.projectIds && [...new Set(identity.principal.projectIds)].sort(),workspaceId:identity.principal.workspaceId,
  audience:identity.principal.audience,launcherWorktree:identity.principal.launcherWorktree,
  storageMappingHash:identity.principal.storageMappingHash,attestation:identity.attestation,
});
const axes=["organizationId","ownerUserId","projectId","workspaceId","bindingHash","bindingEpoch",
  "status","runtimeId","mode","hostId","environmentId","available"];
function selection(value) {
  if(!value || typeof value!=="object" || Array.isArray(value) ||
    Object.keys(value).sort().join(",")!=="projectId,runtimeId,workspaceId" ||
    !(value.projectId===null || text(value.projectId)) || !text(value.workspaceId) || !text(value.runtimeId))
    deny("INVALID_EXECUTION_SELECTION",422);
  return Object.freeze({...value});
}
function identityFor(ports,request) {
  const current=ports.revalidateIdentity(request);
  if(!current || !["user","service"].includes(current.principal?.type))deny("EXECUTION_IDENTITY_UNAVAILABLE",401);
  return snapshot(current);
}
function future(value,now) {return typeof value==="string" && Number.isFinite(Date.parse(value)) && Date.parse(value)>now;}

/** All authority is read through existing owners. No writes, caches, network or effects. */
export function createRequestExecutionResolvers(ports) {
  function resolveRequestExecution(request,value) {
    const selected=selection(value),identity=identityFor(ports,request),key=signature(identity);
    if(selected.projectId===null)deny("PROJECTLESS_EXECUTION_OWNER_UNAVAILABLE");
    const mode=ports.deploymentMode();
    if(!["control-plane","user-runtime"].includes(mode))deny("COMPATIBILITY_EXECUTION_OWNER_UNAVAILABLE");
    const workspace=snapshot(ports.getWorkspace(selected.workspaceId)??null);
    const runtime=snapshot(ports.getRuntime(selected.runtimeId)??null);
    if(!workspace || workspace.id!==selected.workspaceId || workspace.projectId!==selected.projectId ||
      workspace.status!=="authorized" || !text(workspace.organizationId) || !text(workspace.ownerUserId) ||
      !hash(workspace.storageMappingHash) || !Number.isSafeInteger(workspace.securityEpoch) || workspace.securityEpoch<0 ||
      !text(workspace.storagePath,1024) || workspace.storageMappingHash!==createHash("sha256").update(workspace.id+"\0"+workspace.storagePath).digest("hex"))
      deny("EXECUTION_SCOPE_UNAVAILABLE",404);
    if(!runtime || runtime.id!==selected.runtimeId || runtime.workspaceId!==workspace.id ||
      runtime.organizationId!==workspace.organizationId || runtime.projectId!==workspace.projectId ||
      runtime.ownerUserId!==workspace.ownerUserId || runtime.securityEpoch!==workspace.securityEpoch ||
      !["READY","IDLE"].includes(runtime.state))deny("EXECUTION_RUNTIME_UNAVAILABLE",404);
    const now=ports.now();
    if(!Number.isSafeInteger(now) || !Number.isSafeInteger(runtime.revision) || runtime.revision<0 ||
      !text(runtime.backendName) || !hash(runtime.backendContainerId) ||
      !future(runtime.absoluteExpiresAt,now) || !future(runtime.idleExpiresAt,now) ||
      (runtime.leaseExpiresAt!==null && !future(runtime.leaseExpiresAt,now)))
      deny("EXECUTION_RUNTIME_UNAVAILABLE",404);
    const principal=identity.principal;
    if(principal.type==="user" && principal.id!==workspace.ownerUserId)deny("EXECUTION_SCOPE_UNAVAILABLE",404);
    if(principal.type==="service" && (
      !["mcp","runtime"].includes(principal.audience) || !text(principal.tokenId) ||
      principal.workspaceId!==workspace.id || principal.organizationId!==workspace.organizationId ||
      principal.projectId!==workspace.projectId || !principal.projectIds?.includes(workspace.projectId) ||
      principal.storageMappingHash!==workspace.storageMappingHash ||
      identity.attestation?.credentialId!==principal.tokenId || identity.attestation?.workspaceId!==workspace.id ||
      identity.attestation?.storageMappingHash!==workspace.storageMappingHash))
      deny("EXECUTION_SCOPE_UNAVAILABLE",404);
    const owned=ports.resolveOwnership(identity,selected);
    if(!owned || owned.organizationId!==workspace.organizationId || owned.ownerUserId!==workspace.ownerUserId ||
      owned.projectId!==workspace.projectId || owned.workspaceId!==workspace.id ||
      ports.authorizeProject(identity,workspace)!==true)deny("EXECUTION_SCOPE_UNAVAILABLE",404);
    const placement=snapshot(ports.resolvePlacement(Object.freeze({
      organizationId:workspace.organizationId,ownerUserId:workspace.ownerUserId,projectId:workspace.projectId,
      workspaceId:workspace.id,bindingHash:workspace.storageMappingHash,bindingEpoch:workspace.securityEpoch,
      runtimeId:runtime.id,runtimeRevision:runtime.revision,backendName:runtime.backendName,
      backendContainerId:runtime.backendContainerId,now,
    }))??null);
    const after=ports.now();
    if(!placement || placement.runtimeId!==runtime.id || placement.workspaceId!==workspace.id ||
      placement.organizationId!==workspace.organizationId || placement.projectId!==workspace.projectId ||
      placement.ownerUserId!==workspace.ownerUserId ||
      placement.bindingHash!==workspace.storageMappingHash || placement.bindingEpoch!==workspace.securityEpoch ||
      placement.runtimeRevision!==runtime.revision || placement.backendName!==runtime.backendName ||
      placement.backendContainerId!==runtime.backendContainerId ||
      !text(placement.hostId) || !text(placement.environmentId) ||
      !Number.isSafeInteger(placement.observedAt) || !Number.isSafeInteger(placement.expiresAt) ||
      placement.observedAt>now || after<now || after-placement.observedAt>30_000 ||
      placement.expiresAt<=after || placement.expiresAt-placement.observedAt>30_000)
      deny("EXECUTION_PLACEMENT_UNAVAILABLE");
    if(signature(identityFor(ports,request))!==key)deny("EXECUTION_IDENTITY_CHANGED",401);
    if(JSON.stringify(ports.getWorkspace(selected.workspaceId)??null)!==JSON.stringify(workspace) ||
      JSON.stringify(ports.getRuntime(selected.runtimeId)??null)!==JSON.stringify(runtime) ||
      ports.authorizeProject(identity,workspace)!==true)
      deny("EXECUTION_BINDING_CHANGED",409);
    const finalNow=ports.now();
    if(!Number.isSafeInteger(finalNow) || finalNow<after || finalNow-placement.observedAt>30_000 ||
      placement.expiresAt<=finalNow || !future(runtime.absoluteExpiresAt,finalNow) ||
      !future(runtime.idleExpiresAt,finalNow) || (runtime.leaseExpiresAt!==null && !future(runtime.leaseExpiresAt,finalNow)))
      deny("EXECUTION_PLACEMENT_UNAVAILABLE");
    return Object.freeze({
      organizationId:workspace.organizationId,ownerUserId:workspace.ownerUserId,projectId:workspace.projectId,
      workspaceId:workspace.id,bindingHash:workspace.storageMappingHash,bindingEpoch:workspace.securityEpoch,
      status:"authorized",runtimeId:runtime.id,mode:"runtime",hostId:placement.hostId,
      environmentId:placement.environmentId,available:true,
    });
  }
  function resolveRequestChatBinding(request,execution,chatId) {
    if(!text(chatId) || !execution || typeof execution!=="object")deny("INVALID_CHAT_BINDING",422);
    const original=snapshot(execution);
    const current=resolveRequestExecution(request,{
      projectId:original.projectId,workspaceId:original.workspaceId,runtimeId:original.runtimeId,
    });
    if(axes.some(axis=>current[axis]!==original[axis]))deny("EXECUTION_BINDING_CHANGED",409);
    const identity=identityFor(ports,request),key=signature(identity);
    const candidates=snapshot(ports.findConversations(current,chatId)??null);
    if(!Array.isArray(candidates) || candidates.length!==1)deny("CHAT_BINDING_UNAVAILABLE",404);
    const chat=candidates[0];
    if(!chat || !text(chat.id) || chat.project_id!==current.projectId ||
      chat.organization_id!==current.organizationId || chat.owner_user_id!==current.ownerUserId ||
      chat.visibility!=="private" || ports.authorizeConversation(identity,chat)!==true)
      deny("CHAT_BINDING_UNAVAILABLE",404);
    let metadata;
    try{metadata=JSON.parse(chat.metadata);}catch{deny("CHAT_BINDING_UNAVAILABLE",404);}
    if(!metadata || metadata.source!=="opencode-chat" || metadata.sourceRuntimeId!==current.runtimeId ||
      metadata.sourceSessionId!==chatId || ports.conversationIsActive(current.projectId,chat.id)!==true)
      deny("CHAT_BINDING_UNAVAILABLE",404);
    // Revalidate again after Context/authorization callbacks; no serialized execution is authority.
    const final=resolveRequestExecution(request,{
      projectId:current.projectId,workspaceId:current.workspaceId,runtimeId:current.runtimeId,
    });
    if(axes.some(axis=>final[axis]!==current[axis]) || signature(identityFor(ports,request))!==key)
      deny("EXECUTION_BINDING_CHANGED",409);
    const retained=snapshot(ports.findConversations(final,chatId)??null);
    if(!Array.isArray(retained) || retained.length!==1 || JSON.stringify(retained[0])!==JSON.stringify(chat) ||
      ports.conversationIsActive(final.projectId,chat.id)!==true)
      deny("CHAT_BINDING_UNAVAILABLE",404);
    return Object.freeze({...final,chatId,contextConversationId:chat.id,visibility:"private",engineSessionId:chatId});
  }
  return Object.freeze({resolveRequestExecution,resolveRequestChatBinding});
}
