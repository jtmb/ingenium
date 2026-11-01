// Pure invocation producer shared by original production and candidate runners.
// This data constructor supplies no grant/profile/readiness or process lifetime authority.
export function originalManagedJobInvocation(a,identity,environment){
  const names=["PATH","HOME","XDG_CONFIG_HOME","XDG_DATA_HOME","XDG_STATE_HOME","TMPDIR","INGENIUM_API_URL","INGENIUM_PROJECT","INGENIUM_PROJECT_ID","INGENIUM_ORGANIZATION_ID","INGENIUM_RUNTIME_ID","INGENIUM_RUNTIME_OWNER_ID","INGENIUM_WORKSPACE_ID","INGENIUM_STORAGE_MAPPING_HASH"];
  const env=Object.fromEntries(names.filter(n=>environment[n]!==undefined).map(n=>[n,environment[n]]));
  Object.assign(env,{PWD:"/app",OPENCODE_CONFIG_PROJECT_DISABLE:"1",OPENCODE_CONFIG_DIR:"/run/ingenium-runtime/job/config",OPENCODE_CONFIG:"/usr/local/share/ingenium/opencode-managed/job-opencode.json",INGENIUM_WORKTREE:"/workspace",INGENIUM_MCP_AUDIENCE:"job-run",INGENIUM_MCP_CREDENTIAL_FILE:"/run/ingenium-runtime/capability",INGENIUM_RUNTIME_CREDENTIAL_FILE:"/run/ingenium-runtime/capability",INGENIUM_JOB_RUN_ID:identity.runId,INGENIUM_JOB_ATTEMPT_ID:identity.attemptId});
 return {binary:"opencode",args:["run",a.prompt,"--agent",a.agent,"--model",a.model,"--auto","--standalone","--format","json"],options:{cwd:"/workspace",env,stdio:["ignore","pipe","pipe"],shell:false,detached:false}};
}
