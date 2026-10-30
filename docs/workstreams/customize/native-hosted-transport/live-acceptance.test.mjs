import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import tls from 'node:tls';
import {X509Certificate} from 'node:crypto';
import {fileURLToPath} from 'node:url';
import {canonical,sha,same,origin,secureCookie,pinnedOptions,terminal,inside,run,sourceContract} from './live-acceptance.mjs';
const here=path.dirname(fileURLToPath(import.meta.url));
const code=(fn,expected)=>assert.throws(fn,e=>e.code===expected);
test('all original Core canonical vectors, unchanged bytes and SHA256',()=>{
  const vectors=JSON.parse(fs.readFileSync(path.join(here,'files/crates/adapters/src/remote_control/hosted/canonical-vectors.json'),'utf8'));
  for(const v of vectors){assert.equal(canonical(v.value),v.canonical);assert.equal(sha(canonical(v.value)),v.sha256);}
});
test('code-unit ordering, exact CRLF and safe integer boundaries',()=>{
  assert.equal(canonical({'\ue000':false,'\ud800\udc00':true,z:'x\r\n',a:1}),'{"a":1,"z":"x\\r\\n","𐀀":true,"":false}');
  assert.equal(canonical(-0),'0');assert.equal(canonical(Number.MAX_SAFE_INTEGER),'9007199254740991');
  for(const n of [NaN,Infinity,0.1,Number.MAX_SAFE_INTEGER+1])code(()=>canonical(n),'UNSAFE_CANONICAL_NUMBER');
  code(()=>canonical(undefined),'INVALID_CANONICAL_VALUE');
});
test('cookie custody accepts only one original host Secure HttpOnly Strict cookie',()=>{
  const cookie='__Host-ingenium_session='+'x'.repeat(32),safe=cookie+'; Path=/; Secure; HttpOnly; SameSite=Strict';
  assert.equal(secureCookie([safe],'__Host-ingenium_session'),cookie);
  code(()=>secureCookie([safe,safe],'__Host-ingenium_session'),'MISSING_OR_DUPLICATE_COOKIE');
  code(()=>secureCookie([],'__Host-ingenium_session'),'MISSING_OR_DUPLICATE_COOKIE');
  for(const bad of [safe+'; Domain=localhost',safe.replace('; Secure',''),safe.replace('; HttpOnly',''),safe.replace('Strict','Lax'),safe.replace('Path=/','Path=/api')])code(()=>secureCookie([bad],'__Host-ingenium_session'),'UNSAFE_COOKIE');
});
test('origins cannot silently downgrade TLS, redirect credentials or add paths',()=>{
  assert.equal(origin('https://localhost:8443'),'https://localhost:8443');assert.equal(origin('http://127.0.0.1:3411',true),'http://127.0.0.1:3411');
  for(const value of ['http://localhost:3411','http://192.168.1.3','http://127.0.0.1'])code(()=>origin(value),'HTTPS_REQUIRED');
  for(const value of ['https://u:p@localhost','https://localhost/api','https://localhost/?x=1','https://localhost/#fragment'])code(()=>origin(value),'INVALID_ORIGIN');
});
test('TLS options retain chain and hostname verification and exact DER fingerprint',()=>{
  const pem=tls.rootCertificates[0],pin=sha(new X509Certificate(pem).raw),options=pinnedOptions(pem,pin);
  assert.equal(options.rejectUnauthorized,true);assert.equal(options.minVersion,'TLSv1.2');assert.equal(options.ca,pem);
  code(()=>pinnedOptions(pem,'0'.repeat(64)),'CERTIFICATE_FILE_PIN_MISMATCH');
  code(()=>pinnedOptions(pem,'sha256:bad'),'INVALID_CERTIFICATE_PIN');
  assert.ok(options.checkServerIdentity('wrong.invalid',{subjectaltname:'DNS:other.invalid',raw:new X509Certificate(pem).raw}));
});
test('first receipt immutability includes the entire original and every value',()=>{
  const original={id:'original',binding:{actorId:'actor'},command:{op:'create',content:'x\r\n'}};
  assert.equal(terminal({original,outcome:'unknown'},original),false);
  assert.equal(terminal({original,outcome:'succeeded'},original),true);
  code(()=>terminal({original:{...original,command:{op:'create',content:'x\n'}},outcome:'succeeded'},original),'ORIGINAL_CHANGED');
  code(()=>same({original,outcome:'succeeded',value:{revision:2}},{original,outcome:'succeeded',value:{revision:1}},'FIRST_CHANGED'),'FIRST_CHANGED');
});
test('cleanup containment rejects parents, sibling-prefix roots and the root itself',()=>{
  const root=path.resolve('owned');assert.equal(inside(root,path.join(root,'private.json')),true);
  for(const target of [root,path.dirname(root),root+'-other/file'])assert.equal(inside(root,target),false);
});
test('live entry refuses a non-Windows runtime or absent isolation before any file or request',async()=>{
  await assert.rejects(run({isolatedFreshServices:false}),e=>e.code===(process.platform==='win32'?'ISOLATED_FRESH_SERVICES_REQUIRED':'WINDOWS_DPAPI_RUNTIME_REQUIRED'));
});
test('reviewed source contract can be verified read-only when Root paths supplied',()=>{
  if(process.env.CUSTOMIZE_ACCEPTANCE_APP_SOURCE&&process.env.CUSTOMIZE_ACCEPTANCE_NATIVE_SOURCE)
    assert.match(sourceContract({appSource:process.env.CUSTOMIZE_ACCEPTANCE_APP_SOURCE,nativeSource:process.env.CUSTOMIZE_ACCEPTANCE_NATIVE_SOURCE}),/^[0-9a-f]{64}$/);
  else assert.equal(JSON.parse(fs.readFileSync(path.join(here,'live-source-contract.json'),'utf8')).sources.length,31);
});