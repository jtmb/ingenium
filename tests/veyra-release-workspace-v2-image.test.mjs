/** Synthetic contract inputs only: no image, runtime or approval is granted. */
import test from 'node:test';import assert from 'node:assert/strict';
import {SOURCE_INPUTS,IMAGE_INPUTS,PROTOCOL_CASES,CORE126_PROTOCOL,hash,validateManifest} from '../packages/veyra-operations/core126-image-contract.mjs';
import {WORKSPACE_V2_SOURCE_INPUTS,WORKSPACE_V2_ARTIFACTS,WORKSPACE_V2_CASES,validateWorkspaceV2ImageManifest,workspaceV2ImageDefinition} from '../services/ingenium-api/lib/projects-v2/workspace-v2-image.mjs';
import {produceCore126ImageManifest} from '../tools/veyra-release/core126-image-qualification.mjs';
function fixture(){
 const imageId='sha256:'+'b'.repeat(64),harnessSha256='c'.repeat(64);
 const files=IMAGE_INPUTS.map(path=>({path,sha256:'a'.repeat(64),bytes:1,uid:0,gid:0,kind:'file',mode:0o555})),filesSha256=hash(files);
 const source={revision:'d'.repeat(40),sha256:'e'.repeat(64),files:SOURCE_INPUTS.map(path=>({path,sha256:'a'.repeat(64),bytes:1}))};
 const m={schemaVersion:1,format:'core126-immutable-image-qualification',target:'user-runtime',transport:CORE126_PROTOCOL,jobRunAudience:'job-run',imageId,configSha256:'b'.repeat(64),config:{User:'appuser',WorkingDir:'/app',Entrypoint:['/app/scripts/runtime-entrypoint.sh'],Cmd:null},source,files,filesSha256,harnessSha256,approvedScopes:['tools:read'],protocolEvidence:Object.entries(PROTOCOL_CASES).map(([caseId,trace])=>({caseId,imageId,filesSha256,harnessSha256,traceSha256:hash(trace),exitCode:0,evidenceClass:'actual-image-inert-protocol-harness'}))};
 const sourceFiles=WORKSPACE_V2_SOURCE_INPUTS.map(path=>({path,sha256:'a'.repeat(64),bytes:1})),sourceFilesSha256=hash(sourceFiles),workspaceFiles=WORKSPACE_V2_ARTIFACTS.map(path=>({path,sha256:'a'.repeat(64),bytes:1,uid:0,gid:0,mode:0o555,kind:'file'}));
 m.workspaceRuntimeV2={schemaVersion:2,sourceFiles,sourceFilesSha256,files:workspaceFiles,credentialScopes:['child-mcp:runtime','runtime:activity','workspace-runtime:bootstrap','memory:read'],harnessSha256,protocolEvidence:Object.entries(WORKSPACE_V2_CASES).map(([caseId,trace])=>({caseId,imageId,artifactSetSha256:hash(workspaceFiles),sourceFilesSha256,harnessSha256,traceSha256:hash(trace),exitCode:0,evidenceClass:'actual-image-inert-workspace-v2-harness'}))};return m;
}
test('structural validation of a source-bound section never supplies independent approval',()=>{const m=fixture();assert.equal(validateWorkspaceV2ImageManifest(m),m);assert.throws(()=>workspaceV2ImageDefinition(m,undefined));assert.equal(Object.hasOwn(m,'qualified'),false);assert.equal(Object.hasOwn(m,'available'),false)});
test('existing legacy role still validates without the additional workspace section',()=>{const m=fixture();delete m.workspaceRuntimeV2;assert.equal(validateManifest(m),m);assert.throws(()=>validateWorkspaceV2ImageManifest(m))});
test('new source closure refuses missing, duplicate and undeclared critical source names',()=>{
 for(const mutate of [x=>x.sourceFiles.pop(),x=>x.sourceFiles[1]={...x.sourceFiles[0]},x=>x.sourceFiles[0].path='untracked-extra-source']){const m=fixture();mutate(m.workspaceRuntimeV2);m.workspaceRuntimeV2.sourceFilesSha256=hash(m.workspaceRuntimeV2.sourceFiles);assert.throws(()=>validateWorkspaceV2ImageManifest(m))}
});
test('a changed source file set digest cannot be hidden behind a previously collected trace',()=>{const m=fixture();m.workspaceRuntimeV2.sourceFiles[0].sha256='f'.repeat(64);m.workspaceRuntimeV2.sourceFilesSha256=hash(m.workspaceRuntimeV2.sourceFiles);assert.throws(()=>validateWorkspaceV2ImageManifest(m))});
test('raw bootstrap image bytes must equal the frozen original source even after metadata hashes are updated',()=>{
 const m=fixture(),x=m.workspaceRuntimeV2;x.files.find(r=>r.path.endsWith('/runtime-workspace-bootstrap.mjs')).sha256='f'.repeat(64);for(const e of x.protocolEvidence)e.artifactSetSha256=hash(x.files);assert.throws(()=>validateWorkspaceV2ImageManifest(m));
});
test('workspace cases cannot replace the original legacy canary requirements',()=>{const m=fixture();m.protocolEvidence.pop();assert.throws(()=>validateWorkspaceV2ImageManifest(m))});
test('one missing, failed or other-image workspace case prevents qualification',()=>{
 for(const mutate of [x=>x.protocolEvidence.pop(),x=>x.protocolEvidence[0].exitCode=1,x=>x.protocolEvidence[0].imageId='sha256:'+'f'.repeat(64)]){const m=fixture();mutate(m.workspaceRuntimeV2);assert.throws(()=>validateWorkspaceV2ImageManifest(m))}
});
test('explicit workspace-role production refuses absent actual harness before invoking any ports',async()=>{let calls=0;await assert.rejects(produceCore126ImageManifest({frozenSource:async()=>{calls++;return {}}},{imageId:'sha256:'+'b'.repeat(64),approvedScopes:['tools:read'],workspaceRuntimeV2:true}));assert.equal(calls,0)});

test('memory image role requires its explicit read grant and every additional protocol case',()=>{const m=fixture();m.workspaceRuntimeV2.credentialScopes.pop();assert.throws(()=>validateWorkspaceV2ImageManifest(m));for(const id of ['memory-read-mcp-catalog','memory-read-mcp-wire','memory-read-mcp-denials']){const current=fixture();current.workspaceRuntimeV2.protocolEvidence=current.workspaceRuntimeV2.protocolEvidence.filter(e=>e.caseId!==id);assert.throws(()=>validateWorkspaceV2ImageManifest(current))}});
