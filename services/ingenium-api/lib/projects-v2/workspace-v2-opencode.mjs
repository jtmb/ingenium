/** Actual API request target: same scoped117 custody, no global password getter/fallback. */
import {workspaceRuntimeCredentialsV2 as credentials} from 'ingenium-core';
import {runtimes,getDb} from 'ingenium-core';
import {withManagedWorkspaceV2Placement,resolveCurrentWorkspaceV2Execution} from './workspace-v2-placement.mjs';
import {withOpenCodeRuntimeTarget} from '../runtime-opencode-context.js';
export function runtimeWorkspaceOpenCodeContextV2(req,res,next,runtimeId){
 if(!getDb(process.env.INGENIUM_CORE_DB_PATH).prepare("SELECT 1 FROM sqlite_schema WHERE type='table' AND name='veyra_evolution_137'").get())return false;
 const r=runtimes.getWorkspaceRuntimeV2(runtimeId);if(!r)return false;
 const selection={projectId:null,workspaceId:r.workspaceId,runtimeId:r.id};
 void withManagedWorkspaceV2Placement(req,selection,()=>new Promise((resolve,reject)=>{
  let done=false;const complete=()=>{if(done)return;done=true;res.off('finish',complete);res.off('close',complete);resolve();};res.once('finish',complete);res.once('close',complete);
  try{
   const scope=resolveCurrentWorkspaceV2Execution(req,selection),header=credentials.workspaceRuntimeOpenCodeAuthV2(scope.runtimeId);
   if(resolveCurrentWorkspaceV2Execution(req,selection).bindingHash!==scope.bindingHash)throw Error('WORKSPACE_V2_AUTH_BINDING_CHANGED');
   withOpenCodeRuntimeTarget({baseUrl:'http://'+r.backendName+':4098',directory:'/workspace',authHeader:header},next);
  }catch(error){complete();reject(error);}
 })).catch(()=>{if(!res.headersSent)res.status(503).json({error:{code:'WORKSPACE_V2_OPENCODE_SCOPE_UNAVAILABLE'}});else res.end();});
 return true;
}
