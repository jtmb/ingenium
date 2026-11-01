import {test,expect} from 'vitest';
import express from 'express';
import type {Server} from 'node:http';
import {mkdirSync,mkdtempSync,writeFileSync,readFileSync,realpathSync,existsSync} from 'node:fs';
import {join,isAbsolute} from 'node:path';
import {randomBytes,randomUUID,createHash} from 'node:crypto';
import {getDb,resetDbForTest,bootstrap,authentication,projects,organizations,identity} from 'ingenium-core';
import {createNativeScopedCustomizeRouter} from '../lib/routes/customize-scoped-v1.js';
import {errorHandler} from '../lib/middleware/errors.js';
import type {AuthorizationPrincipal} from 'ingenium-core/lib/tools/authorization';

test('actual browser namespace HTTP refuses CSRF, old session and revoked project authority, with genuine fresh-project success',async()=>{
 const parent=process.env.INGENIUM_TEST_CUSTOMIZE_HTTP_OUTPUT;
 if(!parent||!isAbsolute(parent)||realpathSync(parent)!==parent)throw Error('Original owned HTTP fixture parent required');
 const root=mkdtempSync(join(parent,'http-'));mkdirSync(join(root,'data'),{mode:0o700});mkdirSync(join(root,'home'),{mode:0o700});
 writeFileSync(join(root,'.task-owner.json'),JSON.stringify({owner:'01a188fc-d3ed-7dc2-ab95-e0eed8a793ec',synthetic:true,scope:'Actual original browser router/socket/auth/CSRF/session/role checks and Core filesystem; no Native, job or whole-server acceptance',regeneration:'Guarded customize-browser-transition-http.test.ts using preserved source and locks'}),{flag:'wx',mode:0o600});
 const names=['INGENIUM_CORE_DB_PATH','INGENIUM_HOME','INGENIUM_BACKUPS_DIR','INGENIUM_AUTH_ENCRYPTION_KEY_FILE','INGENIUM_API_TOKEN_FILE','INGENIUM_GLOBAL_CONFIG_PATH','OPENCODE_DB_PATH']as const,old=Object.fromEntries(names.map(n=>[n,process.env[n]]));
 const key=join(root,'auth-key');writeFileSync(key,randomBytes(32).toString('base64url')+'\n',{flag:'wx',mode:0o600});
 const apiTokenFile=join(root,'api-token');writeFileSync(apiTokenFile,randomBytes(32).toString('base64url')+'\n',{flag:'wx',mode:0o600});
 Object.assign(process.env,{INGENIUM_CORE_DB_PATH:join(root,'data/core.db'),INGENIUM_HOME:join(root,'home'),INGENIUM_BACKUPS_DIR:join(root,'backups'),INGENIUM_AUTH_ENCRYPTION_KEY_FILE:key,INGENIUM_API_TOKEN_FILE:apiTokenFile,INGENIUM_GLOBAL_CONFIG_PATH:join(root,'global'),OPENCODE_DB_PATH:join(root,'opencode.db')});
 let server:Server|undefined,passed=false;const controls:string[]=[];
 try{
  resetDbForTest();const db=getDb(),password=randomBytes(24).toString('base64url');
  await bootstrap.claimBootstrap({email:'http-owner@example.test',displayName:'HTTP Owner',password});
  const user=await authentication.authenticateLocal('http-owner@example.test',password),login=authentication.createSession(user.id,new Date(),'isolated real HTTP fixture');
  const session=authentication.resolveSession(login.token)!;expect(session.user_id).toBe(user.id);
  const principal:AuthorizationPrincipal={type:'browser-user',id:session.user_id,scopes:['user:*']};
  const project=projects.createProject('http-positive-project',false,organizations.BOOTSTRAP_ORGANIZATION_ID,principal);
  const app=express();app.use(express.json({limit:'1mb'}));app.use('/api/v1/customize-scoped-v1',createNativeScopedCustomizeRouter());app.use(errorHandler);
  server=await new Promise<Server>(resolve=>{const s=app.listen(0,'127.0.0.1',()=>resolve(s));});
  const address=server.address();if(!address||typeof address==='string')throw Error('Actual loopback listener required');
  const base=`http://127.0.0.1:${address.port}/api/v1/customize-scoped-v1/plugin-namespace`;
  const count=()=>JSON.stringify(db.prepare('SELECT id,payload_sha256,result_json FROM customize_commands ORDER BY id').all());
  const initial=count(),configPath=join(project.path,'opencode.json');
  const cookie=(token:string)=>`${authentication.SESSION_COOKIE_NAME}=${token}`;
  const request=async(path:string,body:unknown,headers:Record<string,string>)=>{
   const response=await fetch(base+path,{method:body===undefined?'GET':'POST',headers:{...(body===undefined?{}:{'Content-Type':'application/json'}),...headers},body:body===undefined?undefined:JSON.stringify(body),redirect:'error',signal:AbortSignal.timeout(10000)});
   return {status:response.status,value:await response.json()as any};
  };
  const selection={mode:'fresh-project',projectId:project.id,configOrigin:'new-empty'};
  const originalHeaders={cookie:cookie(login.token),origin:'http://localhost:3000','x-csrf-token':login.csrfToken};
  for(const [label,headers,expected]of[
   ['missing-csrf',{cookie:cookie(login.token),origin:'http://localhost:3000'},403],
   ['wrong-csrf',{...originalHeaders,'x-csrf-token':'invalid'},403],
   ['foreign-origin',{...originalHeaders,origin:'http://foreign.invalid'},403],
   ['missing-cookie',{origin:'http://localhost:3000'},401],
   ['unrecognized-bearer',{authorization:'Bearer '+randomBytes(32).toString('base64url')},401],
  ]as const){expect((await request('/review',selection,headers)).status,label).toBe(expected);expect(count(),label).toBe(initial);expect(existsSync(configPath),label).toBe(false);controls.push(label);}
  const review=await request('/review',selection,originalHeaders);expect(review.status).toBe(200);
  const operationId=randomUUID(),apply={...selection,operationId,reviewSha256:review.value.data.reviewSha256};
  expect((await request('/apply',apply,originalHeaders)).status).toBe(403);expect(count()).toBe(initial);expect(existsSync(configPath)).toBe(false);controls.push('actual-session-without-stepup');
  // Original rotation revokes the first real session and records current step-up.
  const elevated=authentication.rotateSession(login.token,new Date(),true)!;expect(elevated).toBeDefined();
  const headers={cookie:cookie(elevated.token),origin:'http://localhost:3000','x-csrf-token':elevated.csrfToken};
  expect((await request('/review',selection,originalHeaders)).status).toBe(401);expect(count()).toBe(initial);controls.push('real-rotated-old-cookie');
  const result=await request('/apply',apply,headers);expect(result.status).toBe(200);expect(result.value.data.outcome).toBe('succeeded');
  const bytes=readFileSync(configPath),committed=count();
  expect((await request('/operations/'+operationId,undefined,headers)).status).toBe(200);controls.push('actual-same-session-create-apply-inspect');
  expect(()=>organizations.setOrganizationMemberRole(project.organization_id,user.id,'viewer')).toThrow('organization must retain an active owner');controls.push('real-last-owner-preservation');
  const retainedOwner=identity.createUser('retained-org-owner@example.test','Retained Owner');organizations.addOrganizationMember(project.organization_id,retainedOwner.id,'owner');
  expect(organizations.setOrganizationMemberRole(project.organization_id,user.id,'viewer')).toBe(true);
  const denied=await request('/operations/'+operationId,undefined,headers);expect(denied.status).toBe(409);expect(denied.value.error.code).toBe('PROJECT_ADMIN_REQUIRED');
  expect(count()).toBe(committed);expect(readFileSync(configPath)).toEqual(bytes);controls.push('actual-role-revocation-inspect-denied');
  expect(organizations.setOrganizationMemberRole(project.organization_id,user.id,'owner')).toBe(true);
  expect((await request('/operations/'+operationId,undefined,headers)).status).toBe(200);
  expect(authentication.revokeSession(user.id,elevated.session.id)).toBe(true);
  expect((await request('/operations/'+operationId,undefined,headers)).status).toBe(401);expect(count()).toBe(committed);expect(readFileSync(configPath)).toEqual(bytes);controls.push('actual-session-revocation-inspect-denied');
  expect(db.prepare('PRAGMA integrity_check').all()).toEqual([{integrity_check:'ok'}]);expect(db.prepare('PRAGMA foreign_key_check').all()).toEqual([]);
  passed=true;
 }finally{
  if(server){await new Promise<void>((resolve,reject)=>{server!.close(error=>error?reject(error):resolve());server!.closeAllConnections();});}
  resetDbForTest();for(const name of names){if(old[name]===undefined)delete process.env[name];else process.env[name]=old[name];}
  writeFileSync(join(root,'result.json'),JSON.stringify({owner:'01a188fc-d3ed-7dc2-ab95-e0eed8a793ec',synthetic:true,passed,closed:true,originalSocketClosed:true,productionApproval:false,controls,sourceOnly:false,scope:'Original browser namespace router and Core fixture; not whole API server/Native/job/release acceptance'},null,2)+'\n',{flag:'wx',mode:0o600});
 }
},60000);
