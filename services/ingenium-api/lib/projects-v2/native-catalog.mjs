import {requireValue, scopeKey, text} from "../../../../packages/veyra-projects/domain.mjs";

// This adapter never writes API catalog rows for a native-owned project.
export class NativeProjectCatalogAdapter {
  constructor({owner, authorize, resolveRoot, instanceId}) {
    Object.assign(this,{owner,authorize,resolveRoot,instanceId});
  }
  async access(scope, action, id) {
    scopeKey(scope);
    requireValue(await this.authorize(scope,action,id) === true,"FORBIDDEN",403);
  }
  async map(scope, envelope, expectedProjectId) {
    requireValue(envelope?.instanceId === this.instanceId,"NATIVE_INSTANCE_CHANGED",409);
    const p=envelope.project;
    requireValue(p && p.id === expectedProjectId && text(p.id) && text(p.name) && Number.isSafeInteger(p.revision) &&
      p.revision>0 && Array.isArray(p.roots) && p.roots.includes(p.primary_root) &&
      typeof p.archived==="boolean" && typeof p.pinned==="boolean","INVALID_NATIVE_PROJECT",502);
    requireValue(["windows","wsl"].includes(p.environment?.kind),"UNSUPPORTED_ENVIRONMENT",422);
    const roots=[];
    for (const path of p.roots) {
      const proof=await this.resolveRoot(scope,{instanceId:this.instanceId,project:p,directory:path});
      requireValue(proof && text(proof.id) && text(proof.canonicalRootId) && text(proof.hostId) &&
        text(proof.environmentId) && proof.directory===path,"ROOT_UNRESOLVED",503);
      roots.push({id:proof.id,canonicalRootId:proof.canonicalRootId,hostId:proof.hostId,
        environmentId:proof.environmentId,displayPath:path,isPrimary:path===p.primary_root,
        repositoryIdentity:proof.repositoryIdentity ?? null});
    }
    return {version:1,id:p.id,scope:{...scope},label:p.name,revision:p.revision,
      archived:p.archived,archivedAt:null,pinned:p.pinned,roots,
      source:{system:"native",instanceId:this.instanceId,revision:p.revision}};
  }
  async get(scope,id) {
    await this.access(scope,"projects:read",id);
    return this.map(scope,await this.owner.getProject({scope,projectId:id,expectedInstanceId:this.instanceId}),id);
  }
  async list(scope,{after="",limit=50,archived=false}={}) {
    await this.access(scope,"projects:list",null);
    requireValue(typeof after==="string" && Number.isInteger(limit) && limit>0 && limit<=100);
    const reply=await this.owner.listProjects({scope,after,limit,archived,expectedInstanceId:this.instanceId});
    requireValue(reply.instanceId===this.instanceId && Array.isArray(reply.projects),"NATIVE_INSTANCE_CHANGED",409);
    const data=[];
    for (const project of reply.projects) {
      if (await this.authorize(scope,"projects:read",project.id) === true)
        data.push(await this.map(scope,{instanceId:reply.instanceId,project},project.id));
    }
    return {data,pagination:{hasMore:reply.next_cursor!==null,cursor:reply.next_cursor}};
  }
  async create(scope,draft,id) {
    await this.access(scope,"projects:create",null);
    // The native adapter receives the exact native draft; no path translation or target inference.
    requireValue(text(id) && draft && text(draft.name) && Array.isArray(draft.roots) &&
      draft.roots.includes(draft.primary_root),"VALIDATION_ERROR");
    return this.map(scope,await this.owner.createProject({scope,expectedInstanceId:this.instanceId,
      request:{project_id:id,draft}}),id);
  }
  async update(scope,id,expectedRevision,patch) {
    await this.access(scope,"projects:write",id);
    requireValue(Number.isSafeInteger(expectedRevision) && expectedRevision>0 &&
      patch && Object.keys(patch).length>0 &&
      Object.keys(patch).every(key=>["label","pinned","archived"].includes(key)));
    requireValue(patch.label===undefined || text(patch.label));
    requireValue(patch.pinned===undefined || typeof patch.pinned==="boolean");
    requireValue(patch.archived===undefined || typeof patch.archived==="boolean");
    return this.map(scope,await this.owner.updateProject({scope,projectId:id,expectedInstanceId:this.instanceId,
      request:{expected_revision:expectedRevision,name:patch.label,pinned:patch.pinned,archived:patch.archived}}),id);
  }
}
