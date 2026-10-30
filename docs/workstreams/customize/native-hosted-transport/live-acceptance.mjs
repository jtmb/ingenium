/** Root-only live acceptance. No mocks, database adapters, injected proof or retries of effects. */
import fs from 'node:fs';
import path from 'node:path';
import https from 'node:https';
import http from 'node:http';
import tls from 'node:tls';
import {createHash, randomBytes, randomUUID, X509Certificate} from 'node:crypto';
import {execFileSync} from 'node:child_process';
import {fileURLToPath} from 'node:url';

const here=path.dirname(fileURLToPath(import.meta.url));
export const sha=bytes=>createHash('sha256').update(bytes).digest('hex');
export function requireFact(value,code){if(!value)throw Object.assign(new Error(code),{code});}
export function canonical(value){
  if(value===null||typeof value==='boolean'||typeof value==='string')return JSON.stringify(value);
  if(typeof value==='number'){requireFact(Number.isSafeInteger(value),'UNSAFE_CANONICAL_NUMBER');return Object.is(value,-0)?'0':String(value);}
  if(Array.isArray(value))return '['+value.map(canonical).join(',')+']';
  requireFact(value&&Object.getPrototypeOf(value)===Object.prototype,'INVALID_CANONICAL_VALUE');
  return '{'+Object.keys(value).sort().map(k=>JSON.stringify(k)+':'+canonical(value[k])).join(',')+'}';
}
export function same(actual,expected,code){requireFact(canonical(actual)===canonical(expected),code);}
export function origin(text,local=false){
  const u=new URL(text);
  requireFact(!u.username&&!u.password&&u.pathname==='/'&&!u.search&&!u.hash,'INVALID_ORIGIN');
  requireFact(u.protocol==='https:'||local&&u.protocol==='http:'&&['127.0.0.1','[::1]'].includes(u.hostname),'HTTPS_REQUIRED');
  return u.origin;
}
export function secureCookie(headers,name){
  const rows=(headers??[]).filter(v=>v.split(';')[0].startsWith(name+'='));
  requireFact(rows.length===1,'MISSING_OR_DUPLICATE_COOKIE');
  const [cookie,...rest]=rows[0].split(';'),attrs=rest.map(s=>s.trim().toLowerCase());
  requireFact(['secure','httponly','path=/','samesite=strict'].every(a=>attrs.includes(a))&&!attrs.some(a=>a.startsWith('domain=')),'UNSAFE_COOKIE');
  requireFact(new RegExp('^'+name+'=[A-Za-z0-9_-]{32,2048}$').test(cookie),'INVALID_COOKIE');
  return cookie;
}
export function pinnedOptions(pem,expected){
  requireFact(/^[a-f0-9]{64}$/.test(expected),'INVALID_CERTIFICATE_PIN');
  requireFact(sha(new X509Certificate(pem).raw)===expected,'CERTIFICATE_FILE_PIN_MISMATCH');
  return {ca:pem,rejectUnauthorized:true,minVersion:'TLSv1.2',checkServerIdentity:(host,cert)=>{
    const error=tls.checkServerIdentity(host,cert);
    return error??(cert.raw&&sha(cert.raw)===expected?undefined:new Error('PEER_CERTIFICATE_PIN_MISMATCH'));
  }};
}
export function sourceContract(config){
  const manifest=JSON.parse(fs.readFileSync(path.join(here,'live-source-contract.json'),'utf8'));
  for(const row of manifest.sources){
    const base=row.owner==='app'?config.appSource:config.nativeSource;
    requireFact(path.isAbsolute(base),'SOURCE_ROOT_REQUIRED');
    const bytes=fs.readFileSync(path.join(base,row.path));
    requireFact(sha(bytes.toString('utf8').replace(/\r\n/g,'\n'))===row.lfSha256,'SOURCE_PREIMAGE_MISMATCH:'+row.owner+':'+row.path);
  }
  return sha(canonical(manifest));
}
class Client{
  constructor(base,options={}){this.base=base;this.options=options;this.cookies=new Map();this.csrf='';}
  async request(method,route,body,extra={}){
    requireFact(route.startsWith('/')&&!route.startsWith('//'),'INVALID_LOCAL_ROUTE');
    const url=new URL(route,this.base);requireFact(url.origin===this.base,'CROSS_ORIGIN_REFUSED');
    const bytes=body===undefined?undefined:Buffer.from(JSON.stringify(body));
    const headers={accept:'application/json',...extra.headers};
    if(bytes){headers['content-type']='application/json';headers['content-length']=bytes.length;}
    const wire=url.protocol==='https:'?https:http;
    return new Promise((resolve,reject)=>{
      let settled=false,dropped=false;
      const done=(error,result)=>{if(settled)return;settled=true;error?reject(error):resolve(result);};
      const req=wire.request(url,{...this.options,method,headers,agent:false},res=>{
        if(extra.drop){dropped=true;res.destroy();req.destroy(new Error('CALLER_SIGNAL_CLOSED'));done(Object.assign(new Error('CLIENT_SIGNAL_LOST'),{code:'CLIENT_SIGNAL_LOST'}));return;}
        const chunks=[];let size=0;
        res.on('data',b=>{size+=b.length;if(size>3*1024*1024){res.destroy();done(Object.assign(new Error('RESPONSE_TOO_LARGE'),{code:'RESPONSE_TOO_LARGE'}));}else chunks.push(b);});
        res.on('error',()=>done(Object.assign(new Error('RESPONSE_LOST'),{code:'RESPONSE_LOST'})));
        res.on('end',()=>{try{
          const text=Buffer.concat(chunks).toString('utf8');
          done(null,{status:res.statusCode,headers:res.headers,body:text?JSON.parse(text):null});
        }catch{done(Object.assign(new Error('INVALID_JSON_RESPONSE'),{code:'INVALID_JSON_RESPONSE'}));}});
      });
      req.on('error',error=>done(Object.assign(new Error('TRANSPORT_UNCONFIRMED'),{code:dropped?'CLIENT_SIGNAL_LOST':String(error.code??'TRANSPORT_UNCONFIRMED')})));
      req.setTimeout(30000,()=>req.destroy(new Error('TIMEOUT_UNCONFIRMED')));
      // Drop only at actual response headers, before decoding its body. This
      // proves caller uncertainty, never a durable unknown server outcome.
      req.end(bytes);
    });
  }
  async ok(method,route,body,extra={}){
    const r=await this.request(method,route,body,extra);
    requireFact(r.status>=200&&r.status<300,'HTTP_'+r.status+':'+(r.body?.error?.code??r.body?.code??'REFUSED'));
    return r.body;
  }
  browser(method,route,body,extra={}){
    const headers={cookie:[...this.cookies.values()].join('; '),origin:this.dashboard,'x-ingenium-ui':'dashboard','x-csrf-token':this.csrf,...extra.headers};
    return this.request(method,route,body,{...extra,headers});
  }
  async user(method,route,body){const r=await this.browser(method,route,body);requireFact(r.status>=200&&r.status<300,'HTTP_'+r.status+':'+(r.body?.error?.code??'REFUSED'));return r.body;}
  async stepUp(password){
    const r=await this.browser('POST','/api/v1/auth/step-up',{credential:password});
    requireFact(r.status===200&&r.body?.data?.recentStepUp===true,'ACTUAL_STEP_UP_REQUIRED');
    this.cookies.set('session',secureCookie(r.headers['set-cookie'],'__Host-ingenium_session'));this.csrf=r.body.data.csrfToken;
    const current=data(await this.user('GET','/api/v1/auth/session'));requireFact(current.session.recentStepUp===true,'STEP_UP_SESSION_NOT_RETAINED');
  }
  async login(email,password){
    const pre=await this.request('GET','/api/v1/auth/csrf');requireFact(pre.status===200,'PREAUTH_UNAVAILABLE');
    this.cookies.set('pre',secureCookie(pre.headers['set-cookie'],'__Host-ingenium_pre_auth'));
    this.csrf=pre.body.data.csrfToken;
    const r=await this.browser('POST','/api/v1/auth/login',{email,password,deviceLabel:'Customize live acceptance'});
    requireFact(r.status===200&&!r.body.data.mfaRequired,'REAL_PASSWORD_LOGIN_REQUIRED');
    this.cookies.delete('pre');this.cookies.set('session',secureCookie(r.headers['set-cookie'],'__Host-ingenium_session'));
    this.csrf=r.body.data.csrfToken;
    const current=(await this.user('GET','/api/v1/auth/session')).data;
    same(current.user.id,r.body.data.user.id,'LOGIN_SESSION_ACTOR_MISMATCH');return current;
  }
}
const data=body=>{requireFact(body&&Object.hasOwn(body,'data'),'MISSING_DATA_ENVELOPE');return body.data;};
const wait=()=>new Promise(resolve=>setTimeout(resolve,250));
async function poll(work,accept,code){for(let i=0;i<80;i++){const v=await work();if(accept(v))return v;await wait();}throw Object.assign(new Error(code),{code});}
export function terminal(row,expected){requireFact(row&&['succeeded','refused','unknown'].includes(row.outcome),'INVALID_RECEIPT');same(row.original,expected,'ORIGINAL_CHANGED');return row.outcome!=='unknown';}
export function inside(root,file){const r=path.relative(root,file);return r!==''&&!r.startsWith('..'+path.sep)&&r!=='..'&&!path.isAbsolute(r);}
function noLinks(file){for(let p=file;;p=path.dirname(p)){requireFact(!fs.lstatSync(p).isSymbolicLink(),'REDIRECTED_PATH');if(p===path.dirname(p))break;}}
function restrictToOwner(file,directory=false){
  const sid=execFileSync('whoami',['/user','/fo','csv','/nh'],{encoding:'utf8'}).match(/S-1-[0-9-]+/)?.[0];
  requireFact(sid,'WINDOWS_SID_UNAVAILABLE');execFileSync('icacls',[file,'/inheritance:r','/grant:r','*'+sid+(directory?':(OI)(CI)F':':F')],{stdio:'ignore'});
}
function privateFile(file,bytes){
  requireFact(!fs.existsSync(file),'PRIVATE_FILE_ALREADY_EXISTS');fs.writeFileSync(file,bytes,{flag:'wx',mode:0o600});
  // Native DPAPI runtime is Windows; exclude inherited access before import.
  restrictToOwner(file);
}

export async function run(config){
  requireFact(process.platform==='win32','WINDOWS_DPAPI_RUNTIME_REQUIRED');
  requireFact(process.env.NODE_TLS_REJECT_UNAUTHORIZED!=='0','TLS_BYPASS_ENVIRONMENT_REFUSED');
  requireFact(config.isolatedFreshServices===true,'ISOLATED_FRESH_SERVICES_REQUIRED');
  const sourceHash=sourceContract(config),root=path.resolve(config.runtimeRoot);
  requireFact(path.isAbsolute(config.runtimeRoot)&&fs.statSync(root).isDirectory(),'DECLARED_RUNTIME_ROOT_REQUIRED');noLinks(root);
  const directory=path.join(root,'customize-live-'+randomUUID());

  const report={schemaVersion:1,sourceContractSha256:sourceHash,startedAt:new Date().toISOString(),directory,steps:[],originals:[],removed:[],retained:[],openGates:[],complete:false};
  report.openGates.push(
      {gate:'two-store-full-restore',reason:'No mounted Native authority/journal replacement API found. Requires Root-owned real stopped-store orchestration and Core restore supervisor; this runner does not copy active stores or inject restoration proof.'},
      {gate:'Native-revoked-token-negative-purpose-tests',reason:'Private token remains inside original custodians. Live retirement proves the proof route; existing actual-source tests must independently reject domain/recovery use of revoked token.'},
      {gate:'synthesis-execution',reason:'Fresh isolated project has no real ready runtime owner/broker/model. Status and pipeline reads do not prove execution. Root must qualify original executor without changing model.'},
      {gate:'plugin-archive-restore-and-nonproject-discovery',reason:'Mounted Plugins owner exposes enable/disable/delete, no archive/restore; project-only catalog has no external discover/connect mutation. Do not relabel delete as archive.'}
    );
  const privatePaths=new Map();let retired=false;
  const record=(name,status,detail={})=>{report.steps.push({name,status,...detail});fs.writeFileSync(path.join(directory,'receipt.json'),JSON.stringify(report,null,2)+'\n');};
  const step=async(name,work)=>{try{const v=await work();record(name,'passed');return v;}catch(e){record(name,'failed',{code:String(e.code??'ASSERTION_OR_RUNTIME_FAILURE').replace(/[^A-Za-z0-9_:./-]/g,'').slice(0,220)});throw e;}};
  const keepPrivate=(name,bytes)=>{const file=path.join(directory,name);privatePaths.set(file,{sha256:sha(bytes),bytes:Buffer.byteLength(bytes)});privateFile(file,bytes);return file;};
  const removePrivate=file=>{const owned=privatePaths.get(file),s=fs.lstatSync(file);requireFact(inside(directory,file)&&s.isFile()&&s.nlink===1&&!s.isSymbolicLink()&&sha(fs.readFileSync(file))===owned.sha256,'CLEANUP_PRESERVATION_CHECK_FAILED');fs.unlinkSync(file);report.removed.push({path:file,bytes:owned.bytes});privatePaths.delete(file);};
  try{
    fs.mkdirSync(directory);noLinks(directory);restrictToOwner(directory,true);
    const coreOrigin=origin(config.core.origin),pem=fs.readFileSync(config.core.certificateFile,'utf8');
    const core=new Client(coreOrigin,pinnedOptions(pem,config.core.certificateSha256));core.dashboard=origin(config.core.dashboardOrigin);
    const token=fs.readFileSync(config.core.bootstrapTokenFile,'utf8').trim();requireFact(token.length>=32,'BOOTSTRAP_CAPABILITY_REQUIRED');
    const status=await step('actual-Core-fresh-bootstrap-state',async()=>{const v=data(await core.ok('GET','/api/v1/bootstrap/status',undefined,{headers:{authorization:'Bearer '+token}}));requireFact(v.state==='pending','CORE_ALREADY_CLAIMED_REFUSE_EXISTING_INSTALLATION');return v;});
    requireFact(status.state==='pending','CORE_ALREADY_CLAIMED_REFUSE_EXISTING_INSTALLATION');
    const nativeBase=origin(config.native.origin,true),nativeToken=fs.readFileSync(config.native.tokenFile,'utf8').trim();
    const native=new Client(nativeBase,{...(nativeBase.startsWith('https:')?pinnedOptions(fs.readFileSync(config.native.certificateFile,'utf8'),config.native.certificateSha256):{}),headers:{authorization:'Bearer '+nativeToken}});
    // The local service accepts its actual local bearer and rejects Origin.
    const nativeRequest=native.request.bind(native);native.request=(m,r,b,e={})=>nativeRequest(m,r,b,{...e,headers:{authorization:'Bearer '+nativeToken,...e.headers}});
    let owned=await native.ok('GET','/v1/remote-control/owned/status');
    const accounts=await native.ok('GET','/v1/accounts/');
    requireFact(accounts.supported===true&&accounts.accounts.length===0&&accounts.bindings.length===0&&owned.grants.length===0&&owned.connections.length===0&&owned.preparations.length===0,'FRESH_NATIVE_DPAPI_OWNER_REQUIRED');
    const nativeOwner={library_id:owned.owner.library_id,service_instance_id:owned.owner.service_instance,project:null};
    const id=randomUUID(),email='customize-'+id+'@example.invalid',password=randomBytes(36).toString('base64url')+'aA1!';
    const claim=await step('actual-Core-bootstrap-claim',async()=>data(await core.ok('POST','/api/v1/bootstrap/claim',{email,displayName:'Customize acceptance '+id,password},{headers:{authorization:'Bearer '+token}})));
    const session=await step('actual-HTTPS-password-cookie-CSRF-session',()=>core.login(email,password));
    same(session.user.id,claim.userId,'CLAIM_SESSION_MISMATCH');report.actorId=claim.userId;
    await step('actual-password-step-up-cookie-rotation',()=>core.stepUp(password));
    const project=await step('actual-project-create',async()=>data(await core.user('POST','/api/v1/projects',{name:'accept-'+id,organization_id:claim.organizationId})));
    report.project={id:project.id,name:project.name};const query='?project='+encodeURIComponent(project.name);
    const browser=(m,r,b)=>core.user(m,r+query,b),base='/v1/remote-control/node-hosted';
    await step('actual-project-archive-restore-before-enrollment',async()=>{await core.user('DELETE','/api/v1/projects/'+project.name);await core.user('POST','/api/v1/projects/'+project.name+'/restore',{});});
    await step('missing-original-Native-custody-refuses-enrollment',async()=>{
      const r=await core.browser('POST','/api/v1/native-customize/enrollments',{enrollmentRequestId:randomUUID(),hostedProjectId:project.id,visibility:'project'});
      requireFact([403,404,409,422,503].includes(r.status),'MISSING_CUSTODY_DID_NOT_REFUSE');
    });
    await step('actual-Native-TLS-listener-configure-start',async()=>{
      if(!owned.running){
        requireFact(!owned.configuration,'EXISTING_NATIVE_CONFIGURATION_REQUIRES_REVIEW');
        const c=config.nativeRemote;origin(c.publicOrigin);
        await native.ok('POST','/v1/remote-control/owned/commands',{command:{operation_id:randomUUID(),owner:owned.owner,action:{kind:'configure',configuration:{enabled:true,bind:c.bind,public_origin:c.publicOrigin,certificate_path:c.certificateFile,private_key_path:c.privateKeyFile}}}});
        owned=await native.ok('GET','/v1/remote-control/owned/status');
        await native.ok('POST','/v1/remote-control/owned/commands',{command:{operation_id:randomUUID(),owner:owned.owner,action:{kind:'start'}}});
        owned=await native.ok('GET','/v1/remote-control/owned/status');
      }
      requireFact(owned.running&&owned.configuration.public_origin===config.nativeRemote.publicOrigin,'TLS_LISTENER_UNAVAILABLE');
      const peer=new Client(origin(config.nativeRemote.publicOrigin),pinnedOptions(fs.readFileSync(config.nativeRemote.certificateFile,'utf8'),owned.certificate_sha256));
      const denied=await peer.request('GET','/remote/v1/identity');requireFact(denied.status>=400&&denied.status<500,'UNAUTHENTICATED_NATIVE_TLS_ACCESS');
    });
    const credentialFile=keepPrivate('account-credentials.json',JSON.stringify({NODE_HOSTED_EMAIL_CREDENTIAL:email,NODE_HOSTED_PASSWORD:password}));
    const account=await step('actual-Native-DPAPI-credential-file-import',()=>native.ok('POST','/v1/accounts/import',{service_instance_id:nativeOwner.service_instance_id,original:{request_id:randomUUID(),provider:'ingenium-node-hosted',label:'Customize acceptance '+id,environment:{kind:'windows'},scopes:['hosted-governance'],credential_file:credentialFile}}));
    removePrivate(credentialFile);
    const trustFile=keepPrivate('node-trust.json',JSON.stringify({endpoint:coreOrigin,certificate_pem:pem,certificate_sha256:config.core.certificateSha256,dashboard_origin:core.dashboard}));
    const accountCommand={operation_id:randomUUID(),enrollment_request_id:randomUUID(),native_owner:nativeOwner,account_review:{account:Object.fromEntries(['id','provider','label','environment','scopes','credential_names','created_at','revoked_at'].map(k=>[k,account[k]])),session_revision:null},trust_file:trustFile,trust_sha256:sha(fs.readFileSync(trustFile)),second_factor:false};
    const signIn=await step('actual-Native-retained-sign-in',async()=>{const row=await native.ok('POST',base+'/account-commands',accountCommand);same(row.original.command,accountCommand,'SIGN_IN_ORIGINAL_CHANGED');requireFact(row.result?.state==='completed','SIGN_IN_ORIGINAL_UNCONFIRMED');requireFact(row.result.value.state==='signed_in_unverified'&&row.result.value.actor_id===claim.userId,'NATIVE_SESSION_ACTOR_MISMATCH');return row;});
    same(signIn.original.command,accountCommand,'SIGN_IN_ORIGINAL_CHANGED');requireFact(signIn.result?.state==='completed','SIGN_IN_ORIGINAL_UNCONFIRMED');
    requireFact(signIn.result.value.state==='signed_in_unverified'&&signIn.result.value.actor_id===claim.userId,'NATIVE_SESSION_ACTOR_MISMATCH');
    report.originals.push({id:accountCommand.operation_id,kind:'sign-in',sha256:sha(canonical(signIn))});
    const policy={role:'owner',allowed_permissions:null,expires_at:null,daily_window:null,max_mutating_admissions:null};
    const pairCommand={account:{...accountCommand,operation_id:randomUUID(),account_review:signIn.result.value.review},api_project:project.name,hosted_project_id:project.id,visibility:'project',name:'Acceptance '+id,pairing_policy:policy,governance_policy:policy};
    const pairing=await step('actual-Native-TLS-custodian-pairing-enrollment',async()=>{const row=await native.ok('POST',base+'/pairing-commands',pairCommand);same(row.original.command,pairCommand,'PAIRING_ORIGINAL_CHANGED');requireFact(row.result?.state==='completed','PAIRING_ORIGINAL_UNCONFIRMED');return row;});
    same(pairing.original.command,pairCommand,'PAIRING_ORIGINAL_CHANGED');requireFact(pairing.result?.state==='completed','PAIRING_ORIGINAL_UNCONFIRMED');
    const connectionId=pairing.result.value.id,governance='/v1/remote-control/connections/'+encodeURIComponent(connectionId)+'/hosted-governance';
    report.connectionId=connectionId;report.enrollmentRequestId=accountCommand.enrollment_request_id;
    const context=await step('actual-private-context-and-full-owner',async()=>{const v=await native.ok('POST',governance+'/context',nativeOwner);const b=v.binding;same(b.actorId,claim.userId,'PAIRED_ACTOR_MISMATCH');same(b.hostedProjectId,project.id,'PAIRED_PROJECT_MISMATCH');same(b.nativeLibraryId,nativeOwner.library_id,'PAIRED_LIBRARY_MISMATCH');same(b.nativeServiceInstanceId,nativeOwner.service_instance_id,'PAIRED_SERVICE_MISMATCH');same(b.nativeProjectId,null,'PAIRED_NATIVE_PROJECT_MISMATCH');same(b.nativeProjectRevision,null,'PAIRED_NATIVE_REVISION_MISMATCH');same(b.connectionId,connectionId,'PAIRED_CONNECTION_MISMATCH');same(b.apiProject,project.name,'PAIRED_API_PROJECT_MISMATCH');return v;});
    const binding=context.binding;same(binding.actorId,claim.userId,'PAIRED_ACTOR_MISMATCH');same(binding.hostedProjectId,project.id,'PAIRED_PROJECT_MISMATCH');same(binding.nativeLibraryId,nativeOwner.library_id,'PAIRED_LIBRARY_MISMATCH');same(binding.nativeServiceInstanceId,nativeOwner.service_instance_id,'PAIRED_SERVICE_MISMATCH');same(binding.nativeProjectId,null,'PAIRED_NATIVE_PROJECT_MISMATCH');same(binding.nativeProjectRevision,null,'PAIRED_NATIVE_REVISION_MISMATCH');same(binding.connectionId,connectionId,'PAIRED_CONNECTION_MISMATCH');same(binding.apiProject,project.name,'PAIRED_API_PROJECT_MISMATCH');
    const read=async command=>(await native.ok('POST',governance+'/read',{binding,command})).value;
    const inspect=original=>native.ok('POST',governance+'/inspect',{binding,original});
    const effect=async(command,drop=false)=>{
      const original=await native.ok('POST',governance+'/reserve',{binding,command});
      same(original.command,command,'RESERVED_COMMAND_CHANGED');same(original.binding,binding,'RESERVED_BINDING_CHANGED');
      if(drop){
        try{await native.request('POST',governance+'/send',{binding,original},{drop:true});throw Object.assign(new Error('SIGNAL_NOT_LOST'),{code:'SIGNAL_NOT_LOST'});}catch(e){requireFact(e.code==='CLIENT_SIGNAL_LOST','SIGNAL_LOSS_NOT_ESTABLISHED');}
        record('caller-signal-loss-observed','passed',{operationId:original.id,acceptance:'not inferred from disconnect'});
      }else{const response=await native.ok('POST',governance+'/send',{binding,original});terminal(response,original);}
      const receipt=await poll(()=>inspect(original),r=>terminal(r,original),'ORIGINAL_OUTCOME_STILL_UNKNOWN');
      const again=await inspect(original);same(again,receipt,'FIRST_RECEIPT_CHANGED');
      report.originals.push({id:original.id,kind:command.op,payloadHash:sha(canonical(original)),receiptSha256:sha(canonical(receipt))});
      requireFact(receipt.outcome==='succeeded','EFFECT_NOT_SUCCEEDED:'+command.op);return {original,receipt};
    };
    const skillName='accept-skill-'+id;
    const created=await step('actual-paired-create-with-lost-caller-signal',()=>effect({op:'create',reviewedAbsent:true,name:skillName,description:'Live acceptance',content:'Original skill\r\n'},true));
    const skill=async()=>data(await read({op:'skill',name:skillName}));
    let s=await skill();requireFact(s.content==='Original skill\r\n','EXACT_SKILL_BYTES_CHANGED');
    await step('actual-paired-edit',()=>effect({op:'save',name:skillName,filePath:'SKILL.md',target:{id:s.id,revision:s.revision},content:'Edited skill\r\n',extra:{always_apply:0}}));
    for(const op of ['disable','enable','archive','restore'])await step('actual-paired-'+op,async()=>{
      if(op!=='restore')s=await skill();
      await effect({op,name:skillName,target:{id:s.id,revision:s.revision}});
      if(op==='archive'){const rows=data(await read({op:'archived'}));s=rows.find(v=>v.id===s.id);requireFact(s,'ARCHIVED_SKILL_MISSING');}
    });
    await step('actual-Plugins-connect-edit-discover-activate',async()=>{
      const name='accept-plugin-'+id;
      await browser('POST','/api/v1/plugins',{name,file_path:name+'.ts',source_content:'export default async () => ({});\n'});
      await browser('PUT','/api/v1/plugins/'+name,{description:'Live acceptance plugin'});
      same(data(await browser('GET','/api/v1/plugins/'+name+'/source')).source,'export default async () => ({});\n','PLUGIN_SOURCE_CHANGED');
      await browser('POST','/api/v1/plugins/'+name+'/enable',{});
      const catalog=data(await read({op:'catalog',kind:'plugin',offset:0,limit:100}));requireFact(catalog.some(v=>v.name===name&&v.enabled),'PAIRED_PLUGIN_CATALOG_MISSING');
      await browser('POST','/api/v1/plugins/'+name+'/disable',{});
      await browser('DELETE','/api/v1/plugins/'+name);
    });
    await step('actual-proposal-review-submit-approve',async()=>{
      const proposal=data(await browser('POST','/api/v1/skills/proposals',{proposalType:'create',targetName:'accept-proposal-'+id,proposedState:{description:'Live proposal',content:'Approved original proposal',alwaysApply:0}}));
      let current=data(await read({op:'proposal',id:proposal.id,enrich:true}));requireFact(current.reviewed?.proposalHash,'SERVER_REVIEW_FINGERPRINT_REQUIRED');
      await effect({op:'submit',id:proposal.id,reviewed:current.reviewed});
      current=data(await read({op:'proposal',id:proposal.id,enrich:true}));
      await effect({op:'approve',id:proposal.id,reviewed:current.reviewed,reviewer:'Customize acceptance'});
      const approved=data(await browser('GET','/api/v1/skills/accept-proposal-'+id));requireFact(approved.content==='Approved original proposal','PROPOSAL_NOT_APPLIED');
    });
    await step('actual-synthesis-status-and-pipeline-read',async()=>{await read({op:'synthesis-status'});await read({op:'pipeline'});});
    await step('live-project-lifecycle-custody-refuses',async()=>{
      const r=await core.browser('DELETE','/api/v1/projects/'+project.name);
      requireFact(r.status>=400,'LIVE_CUSTODY_ARCHIVE_WAS_ALLOWED');
      const still=data(await core.user('GET','/api/v1/projects'));requireFact(still.some(v=>v.id===project.id),'PROJECT_DISAPPEARED_AFTER_REFUSAL');
    });
    await step('Node-quiescence-refuses-new-authority-preserves-receipt',async()=>{
      const route='/api/v1/native-customize/pairings/'+accountCommand.enrollment_request_id;
      const before=data(await core.user('GET',route));requireFact(before.state==='paired','PAIRING_NOT_PAIRED');
      const quiesced=data(await core.user('POST',route+'/quiesce',{expectedRevision:before.revision}));requireFact(quiesced.state==='quiescing'&&quiesced.pendingEffects===0,'QUIESCENCE_UNCONFIRMED');
      const readDenied=await core.browser('POST','/api/v1/native-customize/read',{grantId:binding.grantId,command:{op:'skill',name:skillName}});requireFact([403,404,409,503].includes(readDenied.status),'QUIESCED_DOMAIN_READ_ALLOWED');
      const bindDenied=await core.browser('GET','/api/v1/native-customize/enrollments/'+binding.grantId);requireFact([403,404,409,503].includes(bindDenied.status),'QUIESCED_LIVE_BINDING_ALLOWED');
      const receipt=await inspect(created.original);same(receipt,created.receipt,'QUIESCENCE_CHANGED_FIRST_RECEIPT');
    });
    await step('actual-two-owner-retirement-and-immutable-first-receipt',async()=>{
      const review=await native.ok('POST',governance+'/lifecycle-review',{binding});
      const command={operation_id:randomUUID(),binding,review};
      const row=await native.ok('POST',governance+'/lifecycle-commands',command);
      requireFact(row.result?.state==='completed','RETIREMENT_UNCONFIRMED');
      requireFact(row.result.value.node.state==='retired'&&row.result.value.node.physicalErasure===false&&row.result.value.physical_erasure===false,'LOGICAL_RETIREMENT_NOT_PROVED');
      const first=await native.ok('GET',base+'/account-originals/'+command.operation_id+'?library_id='+encodeURIComponent(nativeOwner.library_id));same(first,row,'RETIREMENT_FIRST_RECEIPT_CHANGED');
      const metadata=data(await core.user('GET','/api/v1/native-customize/pairings/'+accountCommand.enrollment_request_id));requireFact(metadata.state==='retired'&&metadata.pendingEffects===0&&metadata.physicalErasure===false,'NODE_RETIREMENT_NOT_RETAINED');
      const snapshot=await native.ok('GET','/v1/remote-control/owned/status');requireFact(snapshot.grants.length>0&&snapshot.grants.every(g=>g.revoked),'NATIVE_CUSTODIAN_REVOCATION_NOT_RETAINED');
      retired=true;report.originals.push({id:command.operation_id,kind:'retirement',receiptSha256:sha(canonical(row))});
    });
    await step('retired-project-archive-restore-does-not-revive-grant',async()=>{
      await core.user('DELETE','/api/v1/projects/'+project.name);await core.user('POST','/api/v1/projects/'+project.name+'/restore',{});
      const denied=await core.browser('GET','/api/v1/native-customize/enrollments/'+binding.grantId);requireFact([403,404,409,503].includes(denied.status),'RESTORE_REVIVED_RETIRED_BINDING');
    });
    await step('actual-browser-session-revocation',async()=>{
      const cookie=core.cookies.get('session');await core.user('POST','/api/v1/auth/logout',{});
      const old=await core.request('GET','/api/v1/auth/session',undefined,{headers:{cookie}});requireFact(old.status===401,'REVOKED_SESSION_ACCEPTED');core.cookies.clear();core.csrf='';
    });

  }catch(e){report.failureCode=String(e.code??'ASSERTION_OR_RUNTIME_FAILURE').replace(/[^A-Za-z0-9_:./-]/g,'').slice(0,220);}
  finally{
    for(const file of [...privatePaths.keys()]){
      if(retired||path.basename(file)==='account-credentials.json')try{removePrivate(file);}catch{report.retained.push({path:file,reason:'Exact cleanup preservation check failed; do not retry through another tool.'});}
      else report.retained.push({path:file,reason:'Original unresolved account/pairing may still consume the exact pinned trust file. Root reconciliation is its remaining consumer; remove after terminal retirement or original release.'});
    }
    report.retained.push({path:directory,reason:'Minimal live receipt and exact synthetic actor/project IDs are consumed by Root acceptance review and isolated fixture teardown. No database, build or credential copy is included.'});
    report.finishedAt=new Date().toISOString();fs.writeFileSync(path.join(directory,'receipt.json'),JSON.stringify(report,null,2)+'\n');
  }
  return report;
}
if(process.argv[1]&&path.resolve(process.argv[1])===fileURLToPath(import.meta.url)){
  try{const report=await run(JSON.parse(fs.readFileSync(process.argv[2],'utf8')));console.log(JSON.stringify({receipt:path.join(report.directory,'receipt.json'),failureCode:report.failureCode??null,passed:report.steps.filter(s=>s.status==='passed').length,openGates:report.openGates,complete:false}));process.exitCode=report.failureCode?1:2;}
  catch(e){console.error(JSON.stringify({complete:false,code:String(e.code??'CONFIGURATION_OR_SOURCE_CHECK_FAILED').slice(0,220)}));process.exitCode=1;}
}