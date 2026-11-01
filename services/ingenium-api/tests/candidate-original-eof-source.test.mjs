// Execute the exact canonical private stopped-observation function with explicit
// synthetic transport/Docker ports. This tests await/failure/replay behavior;
// it does NOT create genuine manager, Docker or Core retirement authority.
import test from'node:test';import assert from'node:assert/strict';
import {readFileSync}from'node:fs';import {createHash}from'node:crypto';
import {SourceTextModule,createContext}from'node:vm';
const source=readFileSync(new URL('../lib/dot-v2/candidate-original-manager.mjs',import.meta.url),'utf8'),begin=source.indexOf(' async function observeStopped(s){'),end=source.indexOf(' function retained(custodyId)',begin);assert.ok(begin>0&&end>begin);const functionSource=source.slice(begin,end);
async function fixture(options={}){
 const calls=[],digest=v=>createHash('sha256').update(v).digest('hex'),intent={run:{attemptId:'attempt'},expiresAt:'deadline',parent:{daemonId:'original-daemon'}},state={runId:'run',custodyId:'custody',intentHash:'intent',specHash:'spec',selectionSha256:'selection',revision:2,deadline:Date.now()+60000,intent,originalRpc:{delegate:{}},childId:'child',birthHash:'birth',startHash:'start',attachFault:Boolean(options.attachFault),io:{attach:{ended:!options.noSocketEof,eofSha256:options.noEofHash?null:'eof'},wait:{bytes:Buffer.from('{"StatusCode":0}')}},decoder:{output:{readableEnded:!options.undecoded}}};
 let release;state.eof=new Promise(resolve=>release=resolve);
 const fail=code=>{throw Error(code)},context=createContext({Date,Number,Buffer,
  must(v,code='fixture-binding'){if(!v)fail(code)},
  keys(v,names){assert.deepEqual(Object.keys(v).sort(),Array.from(names).sort())},
  core:async(run,operation,request,_deadline,delegate)=>{calls.push('negative-control');assert.equal(run,state.runId);assert.equal(operation,'control');assert.equal(request.custodyId,state.custodyId);assert.equal(delegate,state.originalRpc.delegate);return{intentHash:state.intentHash,specHash:state.specHash,selectionSha256:state.selectionSha256,deadlineAt:state.intent.expiresAt,revision:2}},
  daemon:async(s,slot)=>{assert.equal(s,state);calls.push(slot)},
  json:async(s,slot,method,path)=>{assert.equal(s,state);calls.push(slot);if(slot==='wait'){assert.equal(method,'POST');assert.equal(path,'/containers/child/wait?condition=not-running');return{StatusCode:options.badWaitCode?-1:0,...(options.waitError?{Error:{Message:'fixture wait failure'}}:{})}}assert.equal(slot,'final');assert.equal(method,'GET');return{State:{Pid:options.livePid?5:0,Status:options.liveState?'running':'exited',Dead:Boolean(options.dead),Restarting:Boolean(options.restarting),Error:options.stateError?'fixture error':'',ExitCode:options.exitMismatch?3:0}}},
  originalChild(s,value,running){assert.equal(s,state);assert.equal(running,false);calls.push('same-original-child');return value},
  freeze:Object.freeze,digest,
  authenticate(s,kind,proof,options){assert.equal(s,state);assert.equal(kind,'original-candidate-stopped-v1');assert.equal(options.retirement,true);calls.push('authenticate-stopped-data');return{fixtureOnly:true,proof}}
 });
 const module=new SourceTextModule(functionSource+'\nexport {observeStopped};',{context});await module.link(()=>{throw Error('No imports in exact function slice')});await module.evaluate();return{state,calls,release,observe:()=>module.namespace.observeStopped(state)};
}
test('original EOF must resolve before Docker wait/final join and stopped-data authentication',async()=>{
 const f=await fixture(),pending=f.observe();await Promise.resolve();await Promise.resolve();assert.deepEqual(f.calls,['negative-control']);f.release();const result=await pending;assert.deepEqual(f.calls,['negative-control','retire-daemon','wait','final','same-original-child','retire-daemon-after','authenticate-stopped-data']);assert.equal(result.fixtureOnly,true);assert.equal(result.proof.kind,'original-candidate-daemon-stopped-v1');assert.equal(result.proof.exitCode,0);assert.match(result.proof.waitJoinSha256,/^[a-f0-9]{64}$/);assert.equal(result.proof.eofSha256,'eof');await assert.rejects(f.observe(),/STOP_OBSERVATION_REPLAY/);assert.equal(f.calls.filter(x=>x==='wait').length,1);
});
for(const options of [{noSocketEof:true},{attachFault:true},{undecoded:true},{noEofHash:true}])test('missing original EOF/decoder evidence refuses without Docker wait '+JSON.stringify(options),async()=>{
 const f=await fixture(options);f.release();await assert.rejects(f.observe());assert.equal(f.calls.includes('wait'),false);assert.equal(f.calls.includes('authenticate-stopped-data'),false);await assert.rejects(f.observe(),/STOP_OBSERVATION_REPLAY/);
});
for(const options of [{badWaitCode:true},{waitError:true},{livePid:true},{liveState:true},{dead:true},{restarting:true},{stateError:true},{exitMismatch:true}])test('original wait/final evidence mismatch cannot produce stopped-data authentication '+JSON.stringify(options),async()=>{
 const f=await fixture(options);f.release();await assert.rejects(f.observe());assert.equal(f.calls.includes('authenticate-stopped-data'),false);await assert.rejects(f.observe(),/STOP_OBSERVATION_REPLAY/);assert.equal(f.calls.filter(x=>x==='wait').length,1);
});