import {verifyCore126AgentMaterial,BROKER_PLUGIN,JOB_AGENT_PLUGIN,JOB_MCP} from './core126-agent-material.mjs';
import {hash,originalJsonHash,freeze,unavailable} from './core126-image-contract.mjs';
export const JOB_PLUGIN_ID='ingenium.enforce-job-agent';
export const JOB_BUILTINS=Object.freeze(['opencode.models.dev','opencode.provider.opencode','opencode.config.policy']);
export const JOB_CONFIG_DIRECTORY='/run/ingenium-runtime/job/config';
/** Source-verified v2.0.11 switches; actual candidate-image isolation remains a gate. */
export function core126ClosedJobConfig(){return freeze({plugins:['-*',...JOB_BUILTINS,BROKER_PLUGIN,JOB_AGENT_PLUGIN],permissions:[{action:'*',resource:'*',effect:'deny'}],mcp:{servers:{}}});}
function checkSnapshot(s,now){
 if(!s||typeof s.agentName!=='string'||!s.admission||!s.material||!s.broker||!s.mcpEnvironment)unavailable('original private job bootstrap binding');
 const material=verifyCore126AgentMaterial(s.material,s.admission,s.agentName,now);
 const b=s.broker;if(b.id!=='ingenium-llm-broker'||b.name!==b.id||b.mode!=='subagent'||b.hidden!==true||typeof b.system!=='string'||!Array.isArray(b.permissions))unavailable('original protected broker definition');
 const e=s.mcpEnvironment;let api;try{api=new URL(e.INGENIUM_API_URL);}catch{unavailable('original job API URL');}if(api.protocol!=='http:'||api.username||api.password||api.pathname!=='/api/v1'||api.search||api.hash)unavailable('original job API URL');if(e.INGENIUM_MCP_AUDIENCE!=='job-run'||e.INGENIUM_JOB_RUN_ID!==s.admission.runId||e.INGENIUM_JOB_ATTEMPT_ID!==s.admission.attemptId||e.INGENIUM_MCP_CREDENTIAL_FILE!=='/run/ingenium-runtime/capability'||e.INGENIUM_RUNTIME_CREDENTIAL_FILE!=='/run/ingenium-runtime/capability')unavailable('original job broker environment');
 if(Object.keys(e).some(k=>!['PATH','INGENIUM_API_URL','INGENIUM_MCP_AUDIENCE','INGENIUM_JOB_RUN_ID','INGENIUM_JOB_ATTEMPT_ID','INGENIUM_MCP_CREDENTIAL_FILE','INGENIUM_RUNTIME_CREDENTIAL_FILE'].includes(k))||Object.values(e).some(v=>typeof v!=='string'||v.includes('\0')))unavailable('closed broker environment');
 return freeze(structuredClone({...s,material}));
}
/** This returns the ORIGINAL native Promise plugin shape from v2.0.11; no npm
 * dependency or upstream edit. Root must supply original private bootstrap ports.
 * No default production export, fake ctx, label proof or authority is supplied. */
export function createCore126JobAgentPlugin(ports){
 if(['loadOriginalBinding','assertOriginalIsolation','assertStaticImageFiles','revokeOriginalDispatch'].some(k=>typeof ports?.[k]!=='function'))unavailable('original job plugin producer missing');
 const now=ports.now??Date.now;
 return Object.freeze({id:JOB_PLUGIN_ID,async setup(ctx){
  if(ctx?.app?.version!=='2.0.11'||['agent','permission','tool','session','mcp','plugin'].some(k=>!ctx[k]))unavailable('actual pinned native plugin context');
  const initial=checkSnapshot(await ports.loadOriginalBinding(),now()),binding=hash(initial.material.binding),selected=initial.agentName;
  await ports.assertOriginalIsolation(initial);await ports.assertStaticImageFiles(initial);
  let fault=false,closed=false,lastMcpHash=null;const registrations=[];
  const abort=async()=>{fault=true;await ports.revokeOriginalDispatch(initial.admission,'CORE126_JOB_ENFORCEMENT_LOST');unavailable('original dispatch revoked');};
  // Never intentionally throw inside grouped transforms: native state.ts disables
  // the entire failing registration group and rebuilds without its protections.
  registrations.push(await ctx.agent.transform(editor=>{
   for(const a of editor.list())if(![selected,'ingenium-llm-broker'].includes(a.id))editor.remove(a.id);
   for(const [id,definition]of[[selected,{...initial.material.agentConfig,id:selected,name:selected}],[initial.broker.id,initial.broker]])editor.update(id,a=>{
    for(const key of Object.keys(a))if(!['id','name','description','mode','system','hidden','permissions','request'].includes(key))delete a[key];
    Object.assign(a,structuredClone(definition),{request:{settings:{},headers:{},body:{}}});
   });
   // Do not change original mode/hidden to manufacture a selectable default.
   editor.default(selected);
  }));
  const mcp={type:'local',command:['node',JOB_MCP],cwd:'/workspace',environment:initial.mcpEnvironment,disabled:false,codemode:false};
  registrations.push(await ctx.mcp.transform(editor=>{
   for(const [name]of editor.list())if(name!=='ingenium')editor.remove(name);
   editor.set('ingenium',structuredClone(mcp));lastMcpHash=hash(editor.get('ingenium'));
  }));
  let originalSession;
  const current=async(sessionID)=>{
   if(fault||closed)return abort();
   try{
    const latest=checkSnapshot(await ports.loadOriginalBinding(),now());
    if(hash(latest.material.binding)!==binding||latest.agentName!==selected||originalJsonHash(latest.material.agentConfig)!==initial.admission.agentHash)throw Error();
    await ports.assertOriginalIsolation(latest);await ports.assertStaticImageFiles(latest);
    const [agents,plugins,servers]=await Promise.all([ctx.agent.list(),ctx.plugin.list(),ctx.mcp.list()]);
    if(!Array.isArray(agents?.data)||agents.data.length!==2||agents.data.some(a=>![selected,'ingenium-llm-broker'].includes(a.id)))throw Error();
    const agent=agents.data.find(a=>a.id===selected),broker=agents.data.find(a=>a.id==='ingenium-llm-broker');
    if(!agent||originalJsonHash(Object.fromEntries(Object.keys(initial.material.agentConfig).map(k=>[k,agent[k]])))!==initial.admission.agentHash||agent.name!==selected||agent.model!==undefined||agent.steps!==undefined||JSON.stringify(agent.request)!==JSON.stringify({settings:{},headers:{},body:{}})||!broker||broker.system!==initial.broker.system||broker.hidden!==true||broker.mode!=='subagent'||hash(broker.permissions)!==hash(initial.broker.permissions))throw Error();
    const expected=[...JOB_BUILTINS,'ingenium.enforce-reserved-broker',JOB_PLUGIN_ID].sort();
    if(!Array.isArray(plugins?.data)||JSON.stringify(plugins.data.map(p=>p.id).sort())!==JSON.stringify(expected)||plugins.data.some(p=>p.state?.status!=='active'||(JOB_BUILTINS.includes(p.id)?p.source?.type!=='builtin':p.source?.type!=='local'||p.source.path!==(p.id===JOB_PLUGIN_ID?JOB_AGENT_PLUGIN:BROKER_PLUGIN))))throw Error();
    if(!Array.isArray(servers?.data)||servers.data.length!==1||servers.data[0].name!=='ingenium'||servers.data[0].status?.status!=='connected'||lastMcpHash!==hash(mcp))throw Error();
    if(sessionID){if(originalSession&&originalSession!==sessionID)throw Error();const session=await ctx.session.get({sessionID});if(!session?.data||session.data.agent!==selected||(session.data.permissions!==undefined&&(!Array.isArray(session.data.permissions)||session.data.permissions.length)))throw Error();originalSession=sessionID;}
    return latest;
   }catch{return abort();}
  };
  // Core source exposes no typed rejection channel for session hooks. Throwing
  // below is only a proposed gate until the ACTUAL pinned image proves no dispatch
  // on error/unload/reload and the original process owner supplies positive stop.
  for(const hook of ['context','compaction','generate','title','model.request','http.request'])registrations.push(await ctx.session.hook(hook,async event=>{
   await current(event.sessionID);if(hook!=='title'&&event.agent!==selected)return abort();
   if(hook==='title'){event.result='Managed JobRun';return;}
   if(event.model&&event.model.providerID+'/'+event.model.id!==initial.admission.model)return abort();
  }));
  registrations.push(await ctx.permission.hook('evaluate',async e=>{try{await current(e.sessionID);if(e.agent!==selected)e.effect='deny';}catch{e.effect='deny';}}));
  registrations.push(await ctx.tool.hook('execute.before',async e=>{await current(e.sessionID);if(e.agent!==selected)return abort();}));
  return async()=>{closed=true;fault=true;await ports.revokeOriginalDispatch(initial.admission,'CORE126_JOB_PLUGIN_UNLOADED');for(const r of registrations.reverse())await r.dispose();};
 }});
}