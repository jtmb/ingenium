// Uses only original Core catalog/state/project owners. No HTTP bearer, principal or dispatcher fallback.
const TOOL="ingenium_project_detail";
const deny=()=>{throw Object.assign(Error("JobRun tool denied"),{status:403});};
export const projectDetailSchema=Object.freeze({type:"object",properties:{name:{type:"string"}},required:["name"],additionalProperties:false});
export function createCore126Broker({owner,authorizeTool,toolStates,projects}){
 const toolCatalog={getTool(name){return toolStates.getAllTools().get(name);}};
 function permitted(credential,name,input){
  owner.assignment(credential.runId,credential);
  if(name!==TOOL||!toolStates.getToolState(credential.projectId,name))deny();
  const authorized=authorizeTool(credential,name,input);
  const project=projects.getProjectById(credential.projectId);
  if(!project||project.archived_at||project.organization_id!==credential.organizationId)deny();
  return {authorized,project};
 }
 return {toolCatalog,
  list(credential){
   // Even an empty catalog must validate the current run/attempt/capability.
   owner.assignment(credential.runId,credential);
   try{permitted(credential,TOOL,{});const entry=toolCatalog.getTool(TOOL);return [{name:TOOL,description:entry.description,inputSchema:projectDetailSchema}];}
   catch(error){if(error?.status===403)return [];throw error;}
  },
  async dispatch(authorized,input,credential){
   if(!input||typeof input!=="object"||Array.isArray(input)||Object.keys(input).sort().join("|")!=="name"||typeof input.name!=="string")deny();
   const {authorized:current,project}=permitted(credential,authorized.toolName,input);
   if(input.name!==project.name||current.credentialId!==authorized.credentialId||current.attemptId!==authorized.attemptId||current.jobRunId!==authorized.jobRunId)deny();
   // Same synchronous original Core handler as projectsRouter GET /:name/detail.
   // No asynchronous gap or generic Auth context exists before this read.
   const data=projects.getProjectDetail(project.name);
   if(!data)throw Object.assign(Error("Resource not found"),{status:404});
   return {content:[{type:"text",text:JSON.stringify(data)}]};
  },
 };
}
