import {CORE126_PROTOCOL,SOURCE_INPUTS,IMAGE_INPUTS,PROTOCOL_CASES,hash,canonical,hex,imageId,integer,scopes,validateManifest,unavailable} from '../../packages/veyra-operations/core126-image-contract.mjs';
/** Root supplies actual build/image reader and inert image-harness owners. No Docker
 * call, process launch, credential or approval implementation is hidden here. */
export async function produceCore126ImageManifest(ports,{imageId:expectedImageId,approvedScopes}){
 if(!imageId(expectedImageId)||!['frozenSource','sourceFile','imageConfig','imageFile','inertProtocolCase','harnessIdentity'].every(k=>typeof ports?.[k]==='function'))unavailable('actual producer owners missing');
 const source=await ports.frozenSource();if(!/^[a-f0-9]{40}$/.test(source?.revision??'')||!hex(source?.sha256)||!Array.isArray(source?.files))unavailable('exact frozen source owner');
 const rawConfig=await ports.imageConfig(expectedImageId);if(!Buffer.isBuffer(rawConfig)||rawConfig.length>1024*1024||'sha256:'+hash(rawConfig)!==expectedImageId)unavailable('actual immutable config bytes');
 const config=JSON.parse(rawConfig.toString('utf8'));if(config.os!=='linux'||config.architecture!=='amd64'||config.config?.Labels?.['org.opencontainers.image.revision']!==source.revision||config.config?.Labels?.['org.ingenium.source.sha256']!==source.sha256)unavailable('source-bound image config');
 const sourceFiles=[];for(const path of SOURCE_INPUTS){const bytes=await ports.sourceFile(path);if(!Buffer.isBuffer(bytes)||!bytes.length||bytes.length>16*1024**2)unavailable('missing bounded source: '+path);const declared=source.files.find(row=>row.path===path);if(declared?.sha256!==hash(bytes)||declared.bytes!==bytes.length)unavailable('critical Source does not match frozen original: '+path);sourceFiles.push({path,bytes:bytes.length,sha256:hash(bytes)});}
 const files=[];for(const path of IMAGE_INPUTS){const f=await ports.imageFile(expectedImageId,path);if(!f||!Buffer.isBuffer(f.bytes)||!f.bytes.length||f.bytes.length>256*1024**2||f.uid!==0||f.gid!==0||f.kind!=='file'||!integer(f.mode)||(f.mode&0o022))unavailable('missing immutable artifact: '+path);files.push({path,bytes:f.bytes.length,sha256:hash(f.bytes),uid:f.uid,gid:f.gid,kind:f.kind,mode:f.mode});}
 const closureFile=await ports.imageFile(expectedImageId,'/app/services/ingenium-api/dist/veyra-runtime-closure.json');if(hash(closureFile.bytes)!==files.find(row=>row.path==='/app/services/ingenium-api/dist/veyra-runtime-closure.json').sha256)unavailable('image closure changed during measurement');const closure=JSON.parse(closureFile.bytes.toString('utf8'));
 for(const sourcePath of ['services/ingenium-api/lib/dot-v2/managed-job-child.mjs','services/ingenium-api/lib/dot-v2/core126-http.mjs']){
  const row=closure.files?.find(row=>row.source===sourcePath),original=sourceFiles.find(row=>row.path===sourcePath),emitted=files.find(row=>row.path==='/app/services/ingenium-api/dist/'+sourcePath.slice('services/ingenium-api/'.length));
  if(!row||row.path!==sourcePath.slice('services/ingenium-api/'.length)||row.sourceSha256!==original.sha256||row.emittedSha256!==emitted.sha256)unavailable('actual emitted/source closure mismatch');
 }
 const filesSha256=hash(files),harnessSha256=await ports.harnessIdentity();if(!hex(harnessSha256))unavailable('actual inert harness identity');
 const evidence=[];for(const [caseId,expected]of Object.entries(PROTOCOL_CASES)){
  const result=await ports.inertProtocolCase({imageId:expectedImageId,filesSha256,harnessSha256,caseId});
  if(result?.imageId!==expectedImageId||result.filesSha256!==filesSha256||result.harnessSha256!==harnessSha256||result.caseId!==caseId||result.exitCode!==0||JSON.stringify(canonical(result.trace))!==JSON.stringify(canonical(expected))||result.evidenceClass!=='actual-image-inert-protocol-harness')unavailable('missing actual image protocol case: '+caseId);
  evidence.push({caseId,imageId:expectedImageId,filesSha256,harnessSha256,traceSha256:hash(result.trace),exitCode:0,evidenceClass:result.evidenceClass});
 }
 const after=await ports.frozenSource();if(after.revision!==source.revision||after.sha256!==source.sha256)unavailable('Source changed during qualification');
 const manifest=validateManifest({schemaVersion:1,format:'core126-immutable-image-qualification',target:'user-runtime',transport:CORE126_PROTOCOL,jobRunAudience:'job-run',imageId:expectedImageId,configSha256:hash(rawConfig),config:{User:config.config.User,WorkingDir:config.config.WorkingDir,Entrypoint:config.config.Entrypoint,Cmd:config.config.Cmd??null},source:{revision:source.revision,sha256:source.sha256,files:sourceFiles},files,filesSha256,harnessSha256,approvedScopes:scopes(approvedScopes),protocolEvidence:evidence});
 const bytes=Buffer.from(JSON.stringify(canonical(manifest),null,2)+'\n');return{manifest,bytes,sha256:hash(bytes),approvalGranted:false,evidenceClass:'exact-image-file-and-inert-protocol; no model dispatch or final platform acceptance'};
}
