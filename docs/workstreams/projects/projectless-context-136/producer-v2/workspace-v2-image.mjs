// Additive role contract. Original Core126 validation/independent approval remains mandatory.
import {createHash} from 'node:crypto';
import {validateManifest,hash} from '../../../../packages/veyra-operations/core126-image-contract.mjs';
export const WORKSPACE_V2_ARTIFACTS=Object.freeze([
 '/app/scripts/runtime-entrypoint.sh','/app/scripts/start-runtime-opencode-web.sh','/app/scripts/project-agent-profiles.mjs','/app/scripts/start-ttyd.sh',
 '/app/services/ingenium-api/dist/scripts/runtime-workspace-bootstrap.mjs',
 '/app/packages/ingenium-extension/dist/scripts/mcp-server.js',
 '/app/packages/ingenium-extension/dist/scripts/workspace-runtime-mcp-client.js',
 '/app/packages/ingenium-extension/dist/scripts/workspace-runtime-mcp-transport.js',
 '/app/packages/ingenium-core/dist/lib/tools/workspace-runtime-auth.mjs',
]);
export const WORKSPACE_V2_CASES=Object.freeze({
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
export function workspaceV2ImageDefinition(manifest,approval){
 validateManifest(manifest); // Does not change or bypass ANY original Project/job canary.
 const x=manifest.workspaceRuntimeV2;
 if(!approval||manifest.imageId!==approval.imageId||manifest.source.revision!==approval.sourceRevision||manifest.source.sha256!==approval.sourceSha256||approval.validUntil<=Date.now()
 ||!x||Object.keys(x).sort().join('|')!=='credentialScopes|files|harnessSha256|protocolEvidence|schemaVersion'||x.schemaVersion!==2||!Array.isArray(x.files)||x.files.length!==WORKSPACE_V2_ARTIFACTS.length
 ||JSON.stringify(x.credentialScopes)!==JSON.stringify(['child-mcp:runtime','runtime:activity','workspace-runtime:bootstrap'])
 ||new Set(x.files.map(r=>r?.path)).size!==WORKSPACE_V2_ARTIFACTS.length||WORKSPACE_V2_ARTIFACTS.some(path=>!x.files.some(r=>r.path===path&&/^[a-f0-9]{64}$/.test(r.sha256)&&Number.isSafeInteger(r.bytes)&&r.bytes>0&&r.bytes<=4*1024*1024&&r.uid===0&&r.gid===0&&r.kind==='file'&&Number.isSafeInteger(r.mode)&&r.mode>=0&&r.mode<=0o7777&&(r.mode&0o022)===0))
 ||!/^[a-f0-9]{64}$/.test(x.harnessSha256)||!Array.isArray(x.protocolEvidence)||x.protocolEvidence.length!==Object.keys(WORKSPACE_V2_CASES).length||new Set(x.protocolEvidence.map(r=>r?.caseId)).size!==x.protocolEvidence.length)return deny();
 for(const [id,trace]of Object.entries(WORKSPACE_V2_CASES)){
  const e=x.protocolEvidence.find(e=>e.caseId===id);
  if(!e||e.imageId!==manifest.imageId||e.artifactSetSha256!==hash(x.files)||e.harnessSha256!==x.harnessSha256||e.traceSha256!==hash(trace)||e.exitCode!==0||e.evidenceClass!=='actual-image-inert-workspace-v2-harness')return deny();
 }
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
