import test from 'node:test';
import assert from 'node:assert/strict';
import { PassThrough } from 'node:stream';
import { randomUUID, createHash } from 'node:crypto';
import { privateFrame, decodePrivateFrame, privateJson, SupervisorChannel } from '../lib/voice-v2/managed-channel.mjs';
import { CoreCpuOwner } from '../lib/voice-v2/core-cpu-owner.mjs';
import { ManagedCpuSupervisor } from '../lib/voice-v2/managed-supervisor.mjs';
const key = Buffer.from(Array.from({length:32},(_,index)=>index));
const plain = value => JSON.parse(JSON.stringify(value));

test('private MAC exact UTF8/direction/sequence prevents altered or replayed frames',()=>{
  const value={text:'voice ☃',nested:{a:1}},frame=privateFrame(key,'C',1,value);
  assert.deepEqual(plain(decodePrivateFrame(key,'C',1,frame)),value);
  assert.throws(()=>decodePrivateFrame(key,'N',1,frame));assert.throws(()=>decodePrivateFrame(key,'C',2,frame));
  const damaged=Buffer.from(frame);damaged[damaged.length-1]^=1;assert.throws(()=>decodePrivateFrame(key,'C',1,damaged));
  assert.match(createHash('sha256').update(frame).digest('hex'),/^[a-f0-9]{64}$/);
});
test('strict private JSON rejects nested duplicates, invalid whitespace and invalid UTF8',()=>{
  for(const value of ['{"identity":{"a":1,"a":2}}','\u00a0{"ok":true}','{"a":NaN}','{"a":1} trailing'])assert.throws(()=>privateJson(Buffer.from(value)));
  assert.throws(()=>privateJson(Buffer.from([0xff])));
  assert.deepEqual(plain(privateJson(Buffer.from('{"escaped":"a\\\"b","list":[null,true,1]}'))),{escaped:'a"b',list:[null,true,1]});
});
async function channel(frames,dispatch){
  const reader=new PassThrough(),writer=new PassThrough(),output=[],faults=[];
  writer.on('data',chunk=>output.push(chunk));
  const original=new SupervisorChannel({reader,writer,key,dispatch,onFault:error=>faults.push(error)});
  assert.equal(original.readerOriginal,null);original.start();
  const bytes=Buffer.concat(frames);for(let offset=0;offset<bytes.length;offset+=3)reader.write(bytes.subarray(offset,offset+3));reader.end();
  await original.joinOriginals();writer.end();return{original,bytes:Buffer.concat(output),faults};
}
test('actual memory-stream pumps retain immutable metadata retry and one original Core call',async()=>{
  const id=randomUUID(),request={id,method:'retain',params:{identity:{ownerGeneration:1}}};let calls=0;
  const result=await channel([privateFrame(key,'C',1,request),privateFrame(key,'C',2,request)],async()=>{calls++;return{retained:true};});
  assert.equal(calls,1);let bytes=result.bytes;
  for(let sequence=1;sequence<=2;sequence++){
    const length=bytes.readUInt32BE(0)+44;assert.deepEqual(plain(decodePrivateFrame(key,'N',sequence,bytes.subarray(0,length))),{id,ok:true,result:{retained:true}});bytes=bytes.subarray(length);
  }
  assert.equal(bytes.length,0);assert.equal(result.faults[0].code,'CPU_PRIVATE_ORIGINAL_EOF');
});
test('conflicting reuse of private RPC UUID never invokes another metadata transaction',async()=>{
  const id=randomUUID();let calls=0;
  const result=await channel([privateFrame(key,'C',1,{id,method:'validate',params:{generation:1}}),privateFrame(key,'C',2,{id,method:'validate',params:{generation:2}})],()=>{calls++;return{valid:true};});
  assert.equal(calls,1);assert.equal(result.faults[0].code,'CPU_PRIVATE_TRANSACTION_CONFLICT');
});
test('truncated authenticated frame invokes no Core callback',async()=>{
  let calls=0;const frame=privateFrame(key,'C',1,{id:randomUUID(),method:'validate',params:{}});
  const result=await channel([frame.subarray(0,frame.length-1)],()=>{calls++;return{};});
  assert.equal(calls,0);assert.equal(result.faults[0].code,'CPU_PRIVATE_FRAME_TRUNCATED');
});

function ownerFixture(){
  const owner={instanceId:'fixture',bootId:randomUUID(),ownerId:randomUUID(),ownerGeneration:1,leaseId:randomUUID()},controlId=randomUUID(),boot=randomUUID();
  const control={original:{operationId:controlId,kind:'voice-cpu-supervisor'},owner,state:'reserved',control:{workerBootId:null},revision:0};
  const scope={context:{actual:'fixture-only'},owner,controlOperationId:controlId,contextFor:value=>value,captureOriginal:async()=>({fixture:true}),
    readyOriginal:{resolve(){}},workerBootId:null,ready:false,closing:false,processExited:false,physicalRetired:false,deadlineAt:Date.now()+10000};
  const rows=new Map([[controlId,control]]),calls=[];
  const ledger={privateRead(_context,input){return rows.get(input.operationId);},bindWorkerBoot(_context,input){calls.push(input);control.control.workerBootId=input.workerBootId;control.state='running';return control;},
    cas(){throw new Error('bindWorkerBoot already made running');},claimCpuDispatch(){},retainCpu(_context,input){calls.push(input);return{identity:input.identity,transactionId:input.transactionId,revision:input.expectedCpuRevision+1,retentionId:randomUUID()};},
    recordCpuResult(_context,input){const row=rows.get(input.operationId);row.cpu.resultFingerprint=Object.fromEntries(Object.entries(input.resultFingerprint).sort());return row;},quarantineCpu(){}};
  return{port:new CoreCpuOwner({ledger,scope}),scope,owner,controlId,boot,rows,calls};
}
test('concrete Core port keeps Node boot separate from actual Python boot and consumes frozen running control',async()=>{
  const f=ownerFixture(),lease=await f.port.dispatch('enroll',{instanceId:'fixture',bootId:f.boot},randomUUID());
  assert.equal(lease.bootId,f.boot);assert.notEqual(lease.bootId,f.owner.bootId);
  const health={service:'veyra-speech',instanceId:'fixture',backend:'cpu-onnx',ready:true,gpuReady:false,stt:true,tts:true,
    ownership:{protocol:'veyra-cpu-ownership-v2',bootId:f.boot,ownerId:f.owner.ownerId,ownerGeneration:1,capacity:256,quarantined:false}};
  assert.deepEqual(await f.port.dispatch('ready',{health},randomUUID()),{accepted:true});assert.equal(f.scope.ready,true);
});
test('Core result comparison is semantic across canonical DB key order and exact bytes',async()=>{
  const f=ownerFixture();f.scope.workerBootId=f.boot;
  const operationId=randomUUID(),identity={instanceId:'fixture',bootId:f.boot,ownerId:f.owner.ownerId,ownerGeneration:1,requestId:operationId,operationId,generation:randomUUID(),kind:'transcribe',digest:'a'.repeat(64)};
  const row={original:{operationId,controlOperationId:f.controlId,cpuIdentity:identity},owner:f.owner,cpu:{identity,revision:3,phase:'terminal',drained:true,outcome:'completed',retentionId:randomUUID(),resultFingerprint:null}};
  f.rows.set(operationId,row);f.port.registerReserved({},row);
  assert.throws(()=>f.port.releaseFinished(identity),/CPU_ORIGINAL_CONSUMER_PENDING/);
  const bytes=Buffer.from('exact fixture'),sha256=createHash('sha256').update(bytes).digest('hex');
  assert.deepEqual(await f.port.dispatch('result',{identity,status:200,contentType:'application/json',sha256,bytes:bytes.length},randomUUID()),{retained:true});
  f.port.validateResult(identity,{status:200,contentType:'application/json',bytes});assert.throws(()=>f.port.validateResult(identity,{status:200,contentType:'application/json',bytes:Buffer.from('changed')}));
  f.port.releaseFinished(identity);
  assert.throws(()=>f.port.validateResult(identity,{status:200,contentType:'application/json',bytes}),/CPU_CORE_ORIGINAL_UNAVAILABLE/);
  assert.throws(()=>f.port.releasePhysicallyRetired(),/CPU_PHYSICAL_RETIREMENT_REQUIRED/);
});
test('renderer-shaped retirement booleans/owner nonce cannot instantiate an actual supervisor proof',()=>{
  const methods=['reserveControl','listControls','reserve','privateRead','retireOriginal','settle'];const ledger=Object.fromEntries(methods.map(name=>[name,()=>{throw new Error('no Core mutation');}]));
  const supervisor=new ManagedCpuSupervisor({profile:{helperSource:'fixture-only',witnessSource:'fixture-only',settings:{instance_id:'fixture'},value:{defaultVoice:'af_heart'}},ledger,
    bindContext(){throw new Error('fixture does not authorize');},admitCpu(){throw new Error('fixture does not admit');},requireCpuAdmission(){throw new Error('fixture does not admit');},releaseCpu(){throw new Error('fixture does not release');}});
  assert.equal(supervisor.status().ready,false);
  assert.throws(()=>supervisor.verifyRetirement({}, {owner:{ownerId:randomUUID()},original:{operationId:randomUUID()}}, {drained:true,helperKernelExited:true,treeEmpty:true}),/CPU_RETIREMENT_PRODUCER_REQUIRED/);
});
