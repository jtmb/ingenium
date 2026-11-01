// Additive role contract. Original Core126 validation/independent approval remains mandatory.
import {createHash} from 'node:crypto';
import {validateManifest,hash} from '../../../../packages/veyra-operations/core126-image-contract.mjs';
export const WORKSPACE_V2_ARTIFACTS=Object.freeze([
 '/app/scripts/derive-workspace-opencode-config.mjs','/usr/local/share/ingenium/opencode-managed/opencode-workspace.json',
 '/app/scripts/runtime-entrypoint.sh','/app/scripts/start-runtime-opencode-web.sh','/app/scripts/project-agent-profiles.mjs','/app/scripts/start-ttyd.sh',
 '/app/services/ingenium-api/dist/scripts/runtime-workspace-bootstrap.mjs',
 '/app/packages/ingenium-extension/dist/scripts/mcp-server.js',
 '/app/packages/ingenium-extension/dist/scripts/workspace-runtime-mcp-client.js',
 '/app/packages/ingenium-extension/dist/scripts/workspace-runtime-mcp-transport.js',
 '/app/packages/ingenium-core/dist/lib/tools/workspace-runtime-auth.mjs',
]);
export const WORKSPACE_V2_SOURCE_INPUTS=Object.freeze([
 'packages/ingenium-core/data/migrations/138_workspace_successor_executions.sql','packages/ingenium-core/data/migrations/migration-138.mjs','packages/ingenium-core/data/migrations/migration-138.d.mts','packages/ingenium-core/lib/db.ts',
 "packages/ingenium-core/lib/tools/mcp-tool-catalog.ts","packages/ingenium-core/lib/tools/mcp-authorization-policy.ts","services/ingenium-api/lib/projects-v2/workspace-mcp-identity.mjs","services/ingenium-api/lib/projects-v2/workspace-mcp-identity.d.mts","services/ingenium-api/lib/projects-v2/workspace-mcp-memory-owner.ts","services/ingenium-api/lib/projects-v2/workspace-chat-binding.mjs","services/ingenium-api/lib/projects-v2/workspace-chat-binding.d.mts","services/ingenium-api/lib/memory-v2/adapters.mjs","services/ingenium-api/lib/memory-v2/adapters.d.mts","services/ingenium-api/lib/memory-v2/bounded-snapshot.mjs","services/ingenium-api/lib/memory-v2/bounded-snapshot.d.mts","services/ingenium-api/lib/memory-v2/lifecycle.mjs","services/ingenium-api/lib/memory-v2/lifecycle.d.mts","services/ingenium-api/lib/memory-v2/opencode-context-pair.mjs","services/ingenium-api/lib/memory-v2/opencode-context-pair.d.mts","services/ingenium-api/lib/memory-v2/opencode-snapshot.mjs","services/ingenium-api/lib/memory-v2/opencode-snapshot.d.mts","services/ingenium-api/lib/memory-v2/recall-availability.mjs","services/ingenium-api/lib/memory-v2/recall-availability.d.mts","services/ingenium-api/lib/memory-v2/source-state.mjs","services/ingenium-api/lib/memory-v2/source-state.d.mts","services/ingenium-api/lib/memory-v2/core-session.ts","services/ingenium-api/lib/memory-v2/recall-availability.ts",
 'packages/ingenium-core/data/migrations/137_workspace_execution.sql','packages/ingenium-core/data/migrations/migration-137.mjs','packages/ingenium-core/data/migrations/migration-137.d.mts',
 'packages/ingenium-core/lib/tools/workspace-runtime-auth.mjs','packages/ingenium-core/lib/tools/workspace-runtime-auth.d.mts',
 'packages/ingenium-core/lib/tools/workspace-runtime-credentials.mjs','packages/ingenium-core/lib/tools/workspace-runtime-credentials.d.mts',
 'packages/ingenium-core/lib/tools/runtimes.ts','packages/ingenium-core/lib/tools/runtime-original-provision.ts',
 'packages/ingenium-extension/scripts/mcp-server.ts','packages/ingenium-extension/scripts/workspace-runtime-mcp-client.ts','packages/ingenium-extension/scripts/workspace-runtime-mcp-transport.ts','packages/ingenium-extension/scripts/build-distributions.mjs',
 'services/ingenium-api/scripts/runtime-workspace-bootstrap.mjs','services/ingenium-api/scripts/runtime-manager.ts','services/ingenium-api/scripts/copy-domain-runtime.mjs',
 'services/ingenium-api/lib/projects-v2/workspace-manager-wire.mjs','services/ingenium-api/lib/projects-v2/workspace-manager-wire.d.mts',
 'services/ingenium-api/lib/projects-v2/workspace-v2-control.mjs','services/ingenium-api/lib/projects-v2/workspace-v2-mcp.mjs','services/ingenium-api/lib/projects-v2/workspace-v2-opencode.mjs','services/ingenium-api/lib/projects-v2/workspace-v2-placement.mjs','services/ingenium-api/lib/projects-v2/workspace-v2-gateway.mjs','services/ingenium-api/lib/projects-v2/workspace-v2-image.mjs',
 'services/ingenium-api/lib/dot-v2/core126-installed-image-owner.ts','services/ingenium-api/lib/runtime-manager-client.ts','services/ingenium-api/lib/runtime-manager-contract.ts',
 'scripts/derive-workspace-opencode-config.mjs','config/opencode-managed/opencode.json',
 'scripts/runtime-entrypoint.sh','scripts/start-runtime-opencode-web.sh','scripts/project-agent-profiles.mjs','scripts/start-ttyd.sh','runtime-supervisord.conf','Dockerfile',
]);
const workspaceRawBindings=[
 ['/app/scripts/derive-workspace-opencode-config.mjs','scripts/derive-workspace-opencode-config.mjs'],
 ['/app/scripts/runtime-entrypoint.sh','scripts/runtime-entrypoint.sh'],
 ['/app/scripts/start-runtime-opencode-web.sh','scripts/start-runtime-opencode-web.sh'],
 ['/app/scripts/project-agent-profiles.mjs','scripts/project-agent-profiles.mjs'],
 ['/app/scripts/start-ttyd.sh','scripts/start-ttyd.sh'],
 ['/app/services/ingenium-api/dist/scripts/runtime-workspace-bootstrap.mjs','services/ingenium-api/scripts/runtime-workspace-bootstrap.mjs'],
 ['/app/packages/ingenium-core/dist/lib/tools/workspace-runtime-auth.mjs','packages/ingenium-core/lib/tools/workspace-runtime-auth.mjs'],
];
export const WORKSPACE_V2_CREDENTIAL_SCOPES=Object.freeze(['child-mcp:runtime','runtime:activity','workspace-runtime:bootstrap','memory:read']);
export const WORKSPACE_V2_CASES=Object.freeze({
 'memory-read-mcp-catalog':{scopeOnlyTools:1,readProfileTools:3,canonicalToolNames:true,unknownToolRejected:true},
 'memory-read-mcp-wire':{sameAudience:true,identitySelectorsAdded:0,mutatingToolAdded:false,untrustedPayloadPreserved:true},
 'memory-read-mcp-denials':{wrongScopeAccepted:false,broaderCatalogAccepted:false,writeCatalogAccepted:false},
 'managed-workspace-config':{projectEnvironmentKeys:[],workspaceLauncher:true,rootPoliciesPreserved:true},
 'no-project-bootstrap':{projectId:null,projectRowsCreated:0,engineStarts:1,mcpProtocol:2},
 'wrong-workspace-credential':{status:401,engineStarts:0},
 'revoked-credential':{status:401,engineStarts:0},
 'wrong-attach-nonce':{acknowledged:false,engineStarts:0},
 'missing-mcp-v2-interface':{acknowledged:false,engineStarts:0},
 'same-original-opencode-auth':{sameCredential:true,sameBirth:true,apiMatchesChild:true,gatewayMatchesChild:true,globalSecretReads:0},
 'changed-birth-opencode-auth-denial':{reusedPassword:false,authorized:false},
 'original-attach-ack':{credentialValidated:true,mcpProtocol:2,retainedOriginalSocket:true},
});
const deny=()=>{throw Object.assign(Error('WORKSPACE_V2_IMAGE_QUALIFICATION_UNAVAILABLE'),{code:'WORKSPACE_V2_IMAGE_QUALIFICATION_UNAVAILABLE',status:503});};
/** Immutable source/artifact preflight, before any inert image process is run. */
export function validateWorkspaceV2ImageInputs(sourceFiles,files){
 if(!Array.isArray(sourceFiles)||sourceFiles.length!==WORKSPACE_V2_SOURCE_INPUTS.length||new Set(sourceFiles.map(r=>r?.path)).size!==WORKSPACE_V2_SOURCE_INPUTS.length
 ||WORKSPACE_V2_SOURCE_INPUTS.some(path=>!sourceFiles.some(r=>r&&r.path===path&&/^[a-f0-9]{64}$/.test(r.sha256)&&Number.isSafeInteger(r.bytes)&&r.bytes>0&&r.bytes<=16*1024*1024))
 ||!Array.isArray(files)||files.length!==WORKSPACE_V2_ARTIFACTS.length||new Set(files.map(r=>r?.path)).size!==WORKSPACE_V2_ARTIFACTS.length
 ||WORKSPACE_V2_ARTIFACTS.some(path=>!files.some(r=>r&&r.path===path&&/^[a-f0-9]{64}$/.test(r.sha256)&&Number.isSafeInteger(r.bytes)&&r.bytes>0&&r.bytes<=4*1024*1024&&r.uid===0&&r.gid===0&&r.kind==='file'&&Number.isSafeInteger(r.mode)&&r.mode>=0&&r.mode<=0o7777&&(r.mode&0o022)===0)))return deny();
 for(const [artifact,source]of workspaceRawBindings){const from=sourceFiles.find(r=>r.path===source),to=files.find(r=>r.path===artifact);if(!from||!to||from.sha256!==to.sha256||from.bytes!==to.bytes)return deny();}
 return {sourceFilesSha256:hash(sourceFiles),artifactSetSha256:hash(files)};
}
/** Pure structural validation only. This grants no image approval or execution. */
export function validateWorkspaceV2ImageManifest(manifest){
 validateManifest(manifest); // Every original Project/job canary remains mandatory.
 const x=manifest.workspaceRuntimeV2;
 if(!x||Object.keys(x).sort().join('|')!=='credentialScopes|files|harnessSha256|protocolEvidence|schemaVersion|sourceFiles|sourceFilesSha256'||x.schemaVersion!==2
 ||JSON.stringify(x.credentialScopes)!==JSON.stringify(WORKSPACE_V2_CREDENTIAL_SCOPES)
 ||!/^[a-f0-9]{64}$/.test(x.harnessSha256)||!Array.isArray(x.protocolEvidence)||x.protocolEvidence.length!==Object.keys(WORKSPACE_V2_CASES).length||new Set(x.protocolEvidence.map(r=>r?.caseId)).size!==x.protocolEvidence.length)return deny();
 const digests=validateWorkspaceV2ImageInputs(x.sourceFiles,x.files);if(x.sourceFilesSha256!==digests.sourceFilesSha256)return deny();
 for(const [id,trace]of Object.entries(WORKSPACE_V2_CASES)){
  const e=x.protocolEvidence.find(e=>e.caseId===id);
  if(!e||e.imageId!==manifest.imageId||e.artifactSetSha256!==digests.artifactSetSha256||e.sourceFilesSha256!==digests.sourceFilesSha256||e.harnessSha256!==x.harnessSha256||e.traceSha256!==hash(trace)||e.exitCode!==0||e.evidenceClass!=='actual-image-inert-workspace-v2-harness')return deny();
 }
 return manifest;
}
export function workspaceV2ImageDefinition(manifest,approval){
 validateWorkspaceV2ImageManifest(manifest);
 if(!approval||manifest.imageId!==approval.imageId||manifest.source.revision!==approval.sourceRevision||manifest.source.sha256!==approval.sourceSha256||!Number.isSafeInteger(approval.validUntil)||approval.validUntil<=Date.now())return deny();
 const x=manifest.workspaceRuntimeV2;
 return Object.freeze({schemaVersion:2,imageId:manifest.imageId,manifestSha256:approval.manifestSha256,sourceRevision:approval.sourceRevision,sourceSha256:approval.sourceSha256,validUntil:approval.validUntil,imageConfig:manifest.config,credentialScopes:Object.freeze([...x.credentialScopes]),files:Object.freeze(x.files.map(r=>Object.freeze({...r})))});
}
/** Strict one-file unextended ustar extraction. Refuses links, PAX/GNU extensions,
 * duplicate entries, traversal, wrong owners/mode, checksum faults and trailing payload.
 * Docker supplies bytes through the original bounded complete-response owner.
 */
export function verifyWorkspaceArchive(bytes,expected){
 if(!Buffer.isBuffer(bytes)||bytes.length>expected.bytes+64*1024||bytes.length%512!==0)return deny();
 let offset=0,seen=false,zeros=0;
 const oct=b=>{const s=b.toString('ascii').replace(/\0.*$/s,'').trim();if(!/^[0-7]+$/.test(s))return deny();const n=parseInt(s,8);if(!Number.isSafeInteger(n))return deny();return n;};
 while(offset<bytes.length){
  const h=bytes.subarray(offset,offset+512);if(h.every(b=>b===0)){zeros++;offset+=512;continue;}if(zeros)return deny();
  const checksum=oct(h.subarray(148,156)),copy=Buffer.from(h);copy.fill(32,148,156);if(copy.reduce((a,b)=>a+b,0)!==checksum)return deny();
  const field=(a,z)=>h.subarray(a,z).toString('utf8').replace(/\0.*$/s,'');
  const name=field(0,100),prefix=field(345,500),kind=h[156],size=oct(h.subarray(124,136));
  if(h.subarray(257,263).toString('ascii')!=='ustar\0'||h.subarray(263,265).toString('ascii')!=='00')return deny();
  if(seen||prefix||name!==expected.path.split('/').at(-1)||![0,48].includes(kind)||field(157,257)||oct(h.subarray(108,116))!==expected.uid||oct(h.subarray(116,124))!==expected.gid||oct(h.subarray(100,108))!==expected.mode||size!==expected.bytes)return deny();
  const content=bytes.subarray(offset+512,offset+512+size);if(content.length!==size||createHash('sha256').update(content).digest('hex')!==expected.sha256)return deny();
  seen=true;offset+=512+Math.ceil(size/512)*512;
 }
 if(!seen||zeros<2)return deny();return {path:expected.path,sha256:expected.sha256,bytes:expected.bytes};
}
