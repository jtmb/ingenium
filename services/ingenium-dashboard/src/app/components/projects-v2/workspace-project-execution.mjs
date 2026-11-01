/** Project folders are metadata; only the original execution confirmer supplies
 * an available runtime. No path, label, URL or catalog row grants execution. */
export function workspaceProjectMatchesExecution(project,execution){
 if(!project||project.archived||!execution||execution.available!==true||execution.schemaVersion!==2||execution.scopeKind!=='workspace'||execution.projectId!==null)return false;
 if(!project.scope||['instanceId','organizationId','ownerUserId'].some(k=>project.scope[k]!==execution[k]))return false;
 const canonical='workspace-v2:'+execution.workspaceId+':'+execution.bindingHash;
 return Array.isArray(project.roots)&&project.roots.filter(root=>root.id===execution.workspaceId&&root.canonicalRootId===canonical&&root.hostId===execution.hostId&&root.environmentId===execution.environmentId).length===1;
}
export async function confirmWorkspaceProjectExecution(client,project){
 if(!project||project.archived||!Array.isArray(project.roots))throw Error('The project is unavailable.');
 const roots=project.roots.filter(root=>root.isPrimary===true);if(roots.length!==1)throw Error('The project has no unique primary folder.');
 const root=roots[0],options=await client.list();
 const rows=options.filter(row=>row.runtimeId&&['instanceId','organizationId','ownerUserId'].every(k=>row[k]===project.scope?.[k])&&row.workspaceId===root.id&&root.canonicalRootId==='workspace-v2:'+row.workspaceId+':'+row.bindingHash);
 if(rows.length!==1)throw Error('This project has no current execution target. Select its workspace to start or recover it.');
 const actual=await client.confirm(rows[0]);
 if(!workspaceProjectMatchesExecution(project,actual))throw Error('The project folder no longer matches its execution target. Refresh the project and workspace.');
 return actual;
}
