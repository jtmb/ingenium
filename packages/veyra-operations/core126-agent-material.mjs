import {UUID,hash,originalJsonHash,freeze,hex,imageId,unavailable} from './core126-image-contract.mjs';
export const JOB_CONFIG='/usr/local/share/ingenium/opencode-managed/job-opencode.json';
export const JOB_AGENT_PLUGIN='/usr/local/share/ingenium/opencode-managed/plugins/enforce-job-agent';
export const BROKER_PLUGIN='/usr/local/share/ingenium/opencode-managed/plugins/enforce-reserved-broker';
export const BROKER_PROFILE='/usr/local/share/ingenium/opencode-managed/agents/ingenium-llm-broker.md';
export const JOB_MCP='/app/services/ingenium-api/dist/scripts/runtime-job-mcp.js';
const fields=['description','mode','system','hidden','permissions'];
const sameKeys=(o,keys)=>o&&typeof o==='object'&&!Array.isArray(o)&&Object.keys(o).sort().join('|')===[...keys].sort().join('|');
const safeName=n=>typeof n==='string'&&/^[A-Za-z0-9_-]{1,128}$/.test(n)&&n!=='ingenium-llm-broker'&&!['__proto__','constructor','prototype'].includes(n);
const bindingKeys=['runId','attemptId','runtimeId','projectId','organizationId','ownerUserId','workspaceId','bindingHash','bindingEpoch','profileHash','imageId','agentHash','deadlineAt'];
function binding(a){
 if(!a||!['runId','attemptId','runtimeId','projectId','organizationId','ownerUserId','workspaceId'].every(k=>UUID.test(a[k]??''))||!['bindingHash','profileHash','agentHash'].every(k=>hex(a[k]))||!imageId(a.imageId)||!Number.isSafeInteger(a.bindingEpoch)||a.bindingEpoch<0||!Number.isFinite(Date.parse(a.deadlineAt)))unavailable('original agent-material admission binding');
 return Object.fromEntries(bindingKeys.map(k=>[k,a[k]]));
}
function configuration(c){
 if(!sameKeys(c,fields)||typeof c.description!=='string'||c.description.length>16000||!['primary','subagent','all'].includes(c.mode)||typeof c.system!=='string'||c.system.length>256*1024||typeof c.hidden!=='boolean'||!Array.isArray(c.permissions)||!c.permissions.length||c.permissions.length>1024)unavailable('exact original agent projection');
 if(c.permissions.some(r=>!sameKeys(r,['action','resource','effect'])||typeof r.action!=='string'||!r.action||r.action.length>256||typeof r.resource!=='string'||!r.resource||r.resource.length>4096||!['allow','deny','ask'].includes(r.effect))||c.permissions[0].action!=='*'||c.permissions[0].resource!=='*'||c.permissions[0].effect!=='deny')unavailable('exact ordered default-deny agent permissions');
 return c;
}
/** Original Core calls synchronously inside its existing launchMaterial transaction.
 * This projection grants no authority; the original one-use handoff remains owner. */
export function projectCore126AgentMaterial({admission,agentName,agentConfig},now=Date.now()){
 const b=binding(admission);if(!safeName(agentName)||Date.parse(b.deadlineAt)<=now)unavailable('current original agent name/deadline');
 configuration(agentConfig);if(originalJsonHash(agentConfig)!==b.agentHash)unavailable('same original Core agentHash');
 const material=freeze({schemaVersion:1,format:'core126-original-agent-material',binding:b,agentName,agentConfig:JSON.parse(JSON.stringify(agentConfig))});
 if(Buffer.byteLength(JSON.stringify(material))>384*1024)unavailable('bounded agent material');return material;
}
/** Manager/child use the original authenticated admission, never self-asserted material alone. */
export function verifyCore126AgentMaterial(material,admission,expectedAgentName,now=Date.now()){
 if(!sameKeys(material,['schemaVersion','format','binding','agentName','agentConfig'])||material.schemaVersion!==1||material.format!=='core126-original-agent-material'||!sameKeys(material.binding,bindingKeys)||hash(material.binding)!==hash(binding(admission))||material.agentName!==expectedAgentName)unavailable('original handoff agent material changed');
 return projectCore126AgentMaterial({admission,agentName:material.agentName,agentConfig:material.agentConfig},now);
}
/** Derived native V2 agent overlay; separate immutable job-only base MUST own MCP,
 * plugins and reserved broker. This does not claim OpenCode merge isolation. */
export function core126AgentOverlay(material,admission,agentName,now=Date.now()){
 const checked=verifyCore126AgentMaterial(material,admission,agentName,now);
 return freeze({agents:Object.fromEntries([[agentName,checked.agentConfig]])});
}
/** Actual native merged-profile observation from Root's protected image plugin.
 * Call before model/spawn/tool dispatch and on config/plugin/registry reload.
 * Hash only the exact original fields in ORIGINAL Core order; no name-only proof. */
export function assertCore126EffectiveJobProfile({material,admission,agentName,effective,staticProfile},now=Date.now()){
 const m=verifyCore126AgentMaterial(material,admission,agentName,now);
 if(!staticProfile||staticProfile.imageId!==admission.imageId||!hex(staticProfile.jobConfigSha256)||!hex(staticProfile.brokerProfileSha256)||!hex(staticProfile.brokerPluginSha256)||!hex(staticProfile.jobAgentPluginSha256)||!effective||effective.jobConfigSha256!==staticProfile.jobConfigSha256||effective.brokerProfileSha256!==staticProfile.brokerProfileSha256||effective.brokerPluginSha256!==staticProfile.brokerPluginSha256||effective.jobAgentPluginSha256!==staticProfile.jobAgentPluginSha256)unavailable('actual immutable job/protected files');
 const selected=effective.agent;
 const emptyRequest=selected?.request===undefined||sameKeys(selected.request,[])||(sameKeys(selected.request,['settings','headers','body'])&&Object.values(selected.request).every(v=>sameKeys(v,[])));
 if(!selected||Object.keys(selected).some(k=>![...fields,'id','name','disabled','model','steps','request'].includes(k))||selected.id!==agentName||selected.name!==agentName||(selected.disabled!==undefined&&selected.disabled!==false)||selected.model!==undefined||selected.steps!==undefined||!emptyRequest)unavailable('actual selected native agent identity/override');
 const originalFields=Object.fromEntries(Object.keys(m.agentConfig).map(k=>[k,selected[k]]));
 if(originalJsonHash(configuration(originalFields))!==admission.agentHash)unavailable('actual merged native definition/permissions changed');
 if(JSON.stringify(effective.plugins)!==JSON.stringify([BROKER_PLUGIN,JOB_AGENT_PLUGIN])||effective.genericBootstrapRequests!==0||effective.configAuthority!=='original-manager-job-only'||!sameKeys(effective.mcpServers,['ingenium']))unavailable('job-only original configuration/bootstrap');
 const server=effective.mcpServers.ingenium;
 if(!sameKeys(server,['type','command','disabled','audience','runId','attemptId','credentialFile'])||server.type!=='local'||JSON.stringify(server.command)!==JSON.stringify(['node',JOB_MCP])||server.disabled!==false||server.audience!=='job-run'||server.runId!==admission.runId||server.attemptId!==admission.attemptId||server.credentialFile!=='/run/ingenium-runtime/capability')unavailable('actual original protected job broker');
 if(effective.reservedBroker?.id!=='ingenium-llm-broker'||effective.reservedBroker?.hidden!==true||effective.reservedBroker?.mode!=='subagent'||effective.reservedBroker?.profileSha256!==staticProfile.brokerProfileSha256||effective.reservedBroker?.enforcementPluginSha256!==staticProfile.brokerPluginSha256)unavailable('actual protected reserved broker');
 return true;
}