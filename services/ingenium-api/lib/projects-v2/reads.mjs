import {requireValue, resolveExecution, text, readTerminalWindow} from "../../../../packages/veyra-projects/domain.mjs";

export class WorkspaceReads {
  constructor({catalog, resolveAdmission, readOwner}) {Object.assign(this,{catalog,resolveAdmission,readOwner});}
  async read(scope,{projectId,binding,kind,args={}}) {
    const capabilities={terminals:"terminal:read",output:"terminal:read",actions:"projects:read",
      worktrees:"git:read",git:"git:read"};
    requireValue(Object.hasOwn(capabilities,kind) && (projectId===null || text(projectId)));
    requireValue(args && typeof args==="object" && !Array.isArray(args));
    const allowed=kind==="output" ? ["terminalId","afterSequence","maxBytes"] : [];
    requireValue(Object.keys(args).every(key=>allowed.includes(key)));
    const project=projectId===null ? null : await this.catalog.get(scope,projectId);
    const admission=await this.resolveAdmission(scope,{projectId,bindingId:binding?.id,action:"read."+kind,args});
    const target=resolveExecution({scope,project,binding,admission,capability:capabilities[kind]});
    if (kind==="output") requireValue(text(args.terminalId) && admission.terminalId===args.terminalId,
      "TERMINAL_SCOPE_MISMATCH",403);
    if (kind==="output") readTerminalWindow([],args.afterSequence ?? 0,args.maxBytes ?? 262144);
    const result=await this.readOwner({scope,projectId,binding:target,kind,args});
    if (kind==="output") {
      requireValue(result && Array.isArray(result.chunks),"INVALID_TERMINAL_OUTPUT",502);
      return {...readTerminalWindow(result.chunks,args.afterSequence ?? 0,args.maxBytes ?? 262144),
        terminalId:args.terminalId,state:result.state};
    }
    return result;
  }
}
