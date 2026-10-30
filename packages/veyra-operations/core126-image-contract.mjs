import {createHash} from 'node:crypto';
export const CORE126_PROTOCOL='scoped-core126-mcp-v1';
export const SOURCE_INPUTS=Object.freeze(['Dockerfile','package-lock.json','scripts/runtime-entrypoint.sh','services/ingenium-api/scripts/runtime-job-child.ts','services/ingenium-api/lib/dot-v2/managed-job-child.mjs','services/ingenium-api/lib/dot-v2/core126-http.mjs','services/ingenium-api/lib/runtime-manager-contract.ts','services/ingenium-api/scripts/runtime-manager.ts','services/ingenium-api/scripts/copy-domain-runtime.mjs','services/ingenium-api/scripts/runtime-job-mcp.ts','packages/veyra-operations/core126-agent-material.mjs','config/opencode-managed/job-opencode.json','config/opencode-managed/plugins/enforce-job-agent/index.mjs','config/opencode-managed/plugins/enforce-reserved-broker/index.mjs','.opencode/agents/execution/ingenium-llm-broker.md','packages/veyra-operations/core126-job-plugin.mjs','packages/veyra-operations/core126-job-bootstrap.mjs','services/ingenium-api/scripts/runtime-job-bootstrap.ts']);
export const IMAGE_INPUTS=Object.freeze(['/app/scripts/runtime-entrypoint.sh','/app/services/ingenium-api/dist/scripts/runtime-job-child.js','/app/services/ingenium-api/dist/lib/dot-v2/managed-job-child.mjs','/app/services/ingenium-api/dist/lib/dot-v2/core126-http.mjs','/app/services/ingenium-api/dist/scripts/runtime-job-mcp.js','/app/services/ingenium-api/dist/veyra-runtime-closure.json','/usr/local/bin/opencode','/usr/local/share/ingenium/opencode-managed/opencode.json','/app/services/ingenium-api/dist/veyra-packages/veyra-operations/core126-agent-material.mjs','/usr/local/share/ingenium/opencode-managed/job-opencode.json','/usr/local/share/ingenium/opencode-managed/plugins/enforce-job-agent/index.mjs','/usr/local/share/ingenium/opencode-managed/plugins/enforce-reserved-broker/index.mjs','/usr/local/share/ingenium/opencode-managed/agents/ingenium-llm-broker.md','/app/services/ingenium-api/dist/veyra-packages/veyra-operations/core126-job-plugin.mjs','/app/services/ingenium-api/dist/veyra-packages/veyra-operations/core126-job-bootstrap.mjs','/app/services/ingenium-api/dist/scripts/runtime-job-bootstrap.js']);
export const UUID=/^[a-f0-9]{8}-[a-f0-9]{4}-[1-8][a-f0-9]{3}-[89ab][a-f0-9]{3}-[a-f0-9]{12}$/i;
export const hex=v=>typeof v==='string'&&/^[a-f0-9]{64}$/.test(v);
export const imageId=v=>typeof v==='string'&&/^sha256:[a-f0-9]{64}$/.test(v);
export const text=v=>typeof v==='string'&&v.length>0&&v.length<=512&&!/[\u0000-\u001f\u007f]/u.test(v);
export const integer=v=>Number.isSafeInteger(v)&&v>=0;
export const canonical=v=>Array.isArray(v)?v.map(canonical):v&&typeof v==='object'?Object.fromEntries(Object.keys(v).sort().map(k=>[k,canonical(v[k])])):v;
export const hash=v=>createHash('sha256').update(Buffer.isBuffer(v)?v:typeof v==='string'?v:JSON.stringify(canonical(v))).digest('hex');
export const originalJsonHash=v=>createHash('sha256').update(JSON.stringify(v)).digest('hex');
export const freeze=v=>{if(v&&typeof v==='object'){for(const item of Object.values(v))freeze(item);Object.freeze(v);}return v;};
export const unavailable=reason=>{throw Object.assign(new Error('Core126 image qualification unavailable: '+reason),{code:'CORE126_IMAGE_UNAVAILABLE',status:503});};
export function scopes(value){if(!Array.isArray(value)||!value.length||value.length>64||new Set(value).size!==value.length||value.some(v=>typeof v!=='string'||!/^[a-z][a-z0-9:._-]{0,127}$/.test(v)||['user:admin','child-mcp:runtime'].includes(v)))unavailable('scope contract');return [...value].sort();}
export const AGENT_CANARY=freeze({description:'Core126 qualification canary',mode:'primary',system:'Qualification canary only.',hidden:false,permissions:[{action:'*',resource:'*',effect:'deny'},{action:'read',resource:'/workspace/canary',effect:'allow'}]});
export const PROTOCOL_CASES=freeze({
 'hostile-project-config-excluded':{projectSources:0,agents:['qualification','ingenium-llm-broker'],genericBootstrapRequests:0},
 'plugin-unload-denial':{postUnloadModelDispatches:0,originalRevocation:true,positiveOriginalScopeRetirement:true},
 'plugin-transform-fault-denial':{modelDispatches:0,defaultAgentFallbacks:0},
 'session-rule-override-denial':{modelDispatches:0,toolExecutions:0},
 'native-reload-definition-stable':{effectiveAgentHash:originalJsonHash(AGENT_CANARY),defaultAgentFallbacks:0},
 'agent-definition-binding':{coreAgentHash:originalJsonHash(AGENT_CANARY),effectiveAgentHash:originalJsonHash(AGENT_CANARY),projection:'native-v2-agents',modelDispatches:0},
 'changed-agent-denial':{childSpawns:0,modelDispatches:0},'changed-permissions-denial':{childSpawns:0,modelDispatches:0},
 'closed-job-config':{mcpCommand:['node','/app/services/ingenium-api/dist/scripts/runtime-job-mcp.js'],plugins:['/usr/local/share/ingenium/opencode-managed/plugins/enforce-reserved-broker','/usr/local/share/ingenium/opencode-managed/plugins/enforce-job-agent'],genericBootstrapRequests:0},
 'reserved-broker-denial':{toolExecutions:0,effect:'deny'},
 'child-model-binding':{executable:'opencode',argv:['run','qualification-canary','--agent','qualification','--model','opencode/qualification-canary','--auto','--standalone','--format','json'],cwd:'/workspace',shell:false},
 'job-broker-route':{credentialAudience:'job-run',path:'/api/v1/runtime/job-runs/original-run/mcp/original-tool',genericPreflightRequests:0},
 'wrong-audience-denial':{status:401,modelDispatches:0},'wrong-run-attempt-denial':{status:401,modelDispatches:0},
 'private-tool-denial':{status:403,modelDispatches:0},'changed-grant-denial':{status:403,modelDispatches:0},
 'unqualified-assignment-denial':{childSpawns:0},'original-result-route':{path:'/api/v1/runtime/job-runs/original-run/result',attemptBinding:'original-attempt',contentRetained:false},
});
export function validateManifest(m){
 if(!m||m.schemaVersion!==1||m.format!=='core126-immutable-image-qualification'||m.transport!==CORE126_PROTOCOL||m.jobRunAudience!=='job-run'||m.target!=='user-runtime'||!imageId(m.imageId)||!hex(m.configSha256)||m.imageId!=='sha256:'+m.configSha256||!hex(m.source?.sha256)||!/^[a-f0-9]{40}$/.test(m.source?.revision??'')||!hex(m.harnessSha256))unavailable('immutable manifest identity');
 if(m.qualified!==undefined||m.config?.User!=='appuser'||m.config?.WorkingDir!=='/app'||JSON.stringify(m.config?.Entrypoint)!==JSON.stringify(['/app/scripts/runtime-entrypoint.sh'])||(m.config?.Cmd!==null&&(!Array.isArray(m.config?.Cmd)||m.config.Cmd.length!==0)))unavailable('image role configuration');
 for(const [rows,names]of[[m.source.files,SOURCE_INPUTS],[m.files,IMAGE_INPUTS]])if(!Array.isArray(rows)||rows.length!==names.length||rows.some(r=>!r||typeof r!=='object')||new Set(rows.map(r=>r.path)).size!==names.length||names.some(path=>!rows.some(r=>r.path===path&&hex(r.sha256)&&integer(r.bytes)&&r.bytes>0)))unavailable('exact source/artifact closure');
 if(m.files.some(r=>r.uid!==0||r.gid!==0||r.kind!=='file'||!integer(r.mode)||(r.mode&0o022)))unavailable('immutable root-owned artifact');
 if(m.filesSha256!==hash(m.files))unavailable('artifact set digest');scopes(m.approvedScopes);
 if(!Array.isArray(m.protocolEvidence)||m.protocolEvidence.length!==Object.keys(PROTOCOL_CASES).length||m.protocolEvidence.some(r=>!r||typeof r!=='object')||new Set(m.protocolEvidence.map(r=>r.caseId)).size!==m.protocolEvidence.length)unavailable('protocol case set');
 for(const [id,expected]of Object.entries(PROTOCOL_CASES)){const r=m.protocolEvidence.find(r=>r.caseId===id);if(!r||r.imageId!==m.imageId||r.filesSha256!==m.filesSha256||r.harnessSha256!==m.harnessSha256||r.traceSha256!==hash(expected)||r.exitCode!==0||r.evidenceClass!=='actual-image-inert-protocol-harness')unavailable('actual image protocol evidence');}
 return m;
}
export function publicContainer(container){
 const c=container?.Config,h=container?.HostConfig,s=container?.State,l=c?.Labels??{};
 if(!container||!hex(container.Id)||!imageId(container.Image)||typeof container.Name!=='string'||c?.User!=='1000:1000'||c.WorkingDir!=='/workspace'||s?.Running!==true||s.Status!=='running'||s.Health?.Status!=='healthy'||h?.ReadonlyRootfs!==true||h.Privileged===true||h.NetworkMode==='host'||h.PidMode||h.IpcMode==='host'||h.UsernsMode==='host'||h.CapAdd?.length||h.Devices?.length||h.DeviceRequests?.length||!Array.isArray(h.CapDrop)||!h.CapDrop.includes('ALL')||!Array.isArray(h.SecurityOpt)||!h.SecurityOpt.includes('no-new-privileges:true'))unavailable('actual parent isolation/state');
 const required=['id','organization','project','owner','workspace','storage','security-epoch','revision'];
 const labels=Object.fromEntries(required.map(k=>[k,l['com.ingenium.runtime.'+k]]));
 if(l['com.ingenium.managed']!=='runtime-manager'||!UUID.test(labels.id??'')||container.Name!=='/ingenium-runtime-'+labels.id.replaceAll('-','')||!hex(labels.storage)||required.some(k=>!text(labels[k])))unavailable('actual parent scope');
 const epoch=Number(labels['security-epoch']),revision=Number(labels.revision);if(!/^(0|[1-9][0-9]*)$/.test(labels['security-epoch'])||!/^(0|[1-9][0-9]*)$/.test(labels.revision)||!integer(epoch)||!integer(revision))unavailable('parent epoch/revision');
 if(!integer(h.Memory)||h.Memory<=0||!integer(h.NanoCpus)||h.NanoCpus<=0||!integer(h.PidsLimit)||h.PidsLimit<=0)unavailable('actual parent resource limits');
 if(!text(s.StartedAt)||!Number.isFinite(Date.parse(s.StartedAt))||!integer(container.RestartCount))unavailable('parent start identity');
 return {id:container.Id,name:container.Name,startIdentity:hash([s.StartedAt,container.RestartCount]),imageId:container.Image,runtimeId:labels.id,organizationId:labels.organization,projectId:labels.project,ownerUserId:labels.owner,workspaceId:labels.workspace,bindingHash:labels.storage,bindingEpoch:epoch,provisioningRevision:revision,
  publicProfileSha256:hash({User:c.User,WorkingDir:c.WorkingDir,Entrypoint:c.Entrypoint,Cmd:c.Cmd,HostConfig:h,Mounts:container.Mounts,AppArmorProfile:container.AppArmorProfile}),
  memoryBytes:h.Memory,nanoCpus:h.NanoCpus,effectivePids:h.PidsLimit};
}
