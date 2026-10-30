import {ManagedCpuProfile} from './managed-profile.mjs';
import {ManagedCpuSupervisor} from './managed-supervisor.mjs';
import {readLinuxCpuCapacity} from './linux-resource-probe.mjs';
import {readResourceApproval,verifyModelSet,assertSnapshot,canonical,fail} from './resource-approval.mjs';
let occupied=null; // One original scope in this API process; original Core controls cover restarts.
const same=(a,b)=>canonical(a)===canonical(b);
export function checkCpuResourceBudget(plan,facts,stage){
 const needed=plan.stages[stage];
 if(!needed||facts.memoryHeadroom<needed.additionalBytes||facts.pidsHeadroom<needed.additionalTasks||facts.cpuMilli<needed.cpuMilli||facts.cpus<plan.cpuThreads)fail('CPU_RESOURCE_CAPACITY_INSUFFICIENT');
}

/** Private production assembly: concrete protected files and kernel probes, no positive resource port. */
export function createLinuxCpuSupervisor({profilePath,resourceApprovalPath,ledger,bindContext,currentScope}){
 if(typeof bindContext!=='function'||typeof currentScope!=='function'||typeof ledger?.privateRead!=='function')fail('CPU_ACTUAL_CORE_BINDING_REQUIRED');
 const profile=ManagedCpuProfile.load(profilePath),{plan,snapshot,codeSnapshots}=readResourceApproval(resourceApprovalPath,profile);
 const tokens=new WeakMap();let producer;
 const handle=record=>{const value=Object.freeze({get deadlineAt(){return record.deadlineAt;}});tokens.set(value,record);return value;};
 const actualScope=scope=>{if(!producer?.isOwnedScope(scope))fail('CPU_RESOURCE_ORIGINAL_SCOPE_REQUIRED');};
 function budget(stage,identity){
  const facts=readLinuxCpuCapacity();if(identity&&facts.identity!==identity)fail('CPU_RESOURCE_CGROUP_ORIGINAL_CHANGED');
  checkCpuResourceBudget(plan,facts,stage);
  return facts;
 }
 function approved(retirement=false){assertSnapshot(snapshot);for(const code of codeSnapshots)assertSnapshot(code);if(Date.now()>=(retirement?plan.retirementExpiresAt:plan.expiresAt))fail('CPU_RESOURCE_APPROVAL_EXPIRED');}
 function original(record,scope){
  actualScope(scope);if(!same(scope.scope,record.scopeValue)||!same(scope.owner,record.owner)||record.scope&&record.scope!==scope||scope.control&&scope.control.profileDigest!==profile.profileDigest)fail('CPU_RESOURCE_ORIGINAL_CONFLICT');
  if(!record.scope)record.scope=scope;if(!record.slot.scope)record.slot.scope=scope;
 }
 function fresh(record,scope){
  original(record,scope);if(record.released||scope.closing||scope.physicalRetired||record.signal?.aborted||Date.now()>=record.deadlineAt)fail('CPU_RESOURCE_ADMISSION_CLOSED');
  const context=bindContext(scope.context,scope,producer),verified=currentScope(context,scope.scope,scope.started?'transition':'reserve');
  if(!verified||verified.mode!=='hosted'||verified.selectedConversationVerified!==true||!same(verified.scope,record.scopeValue)||!same(verified.owner,record.owner)||!Number.isSafeInteger(verified.deadlineAt)||verified.deadlineAt<=Date.now())fail('CPU_RESOURCE_CORE_SCOPE_CHANGED');
  record.deadlineAt=Math.min(record.deadlineAt,verified.deadlineAt);
  if(scope.started){const control=ledger.privateRead(context,{operationId:scope.controlOperationId,owner:scope.owner});
   if(control.resourceRetired||control.original.operationId!==scope.controlOperationId||control.state!=='running'||!same(control.owner,scope.owner)||!same(control.original.scope,scope.scope)||control.original.control?.profileDigest!==profile.profileDigest)fail('CPU_RESOURCE_CORE_ORIGINAL_CHANGED');}
 }
 function requireAdmission(token,scope){
  const record=tokens.get(token);if(!record||record.producer!==producer||occupied!==record.slot)fail('CPU_RESOURCE_ADMISSION_ORIGINAL_REQUIRED');
  original(record,scope);approved(record.role==='witness');
  if(record.role==='witness'){
   if(record.released||Date.now()>=record.deadlineAt)fail('CPU_RESOURCE_ADMISSION_CLOSED');budget('witness',record.cgroupIdentity);return;
  }
  fresh(record,scope);for(const asset of record.assets)assertSnapshot(asset);
  budget(scope.ready?'hot':'cold',record.cgroupIdentity);
 }
 function inspect(proof,manager,witness){
  if(manager!==producer)fail('CPU_RESOURCE_MANAGER_ORIGINAL_REQUIRED');
  const facts=producer.inspectResourceRetirement(proof);
  if(facts.manager!==producer||facts.scope.owner!==facts.owner||!facts.retired
    ||(witness?!['witness-retired','witness-before-fork'].includes(facts.kind):!['physical','sealed-before-fork'].includes(facts.kind)))fail('CPU_RESOURCE_RETIREMENT_REQUIRED');
  return facts;
 }
 function retiredOriginal(record,scope){
  if(record.scope!==scope||!same(scope.scope,record.scopeValue)||!same(scope.owner,record.owner))fail('CPU_RESOURCE_ORIGINAL_CONFLICT');
 }
 const callbacks={
  admitCpu(input){
   approved();input.signal?.throwIfAborted();
   if(occupied)fail('CPU_RESOURCE_OTHER_ORIGINAL_ACTIVE');
   if(input.profileDigest!==profile.profileDigest||input.memoryBytes!==plan.workerAddressSpaceBytes||input.cpuThreads!==plan.cpuThreads||!Number.isSafeInteger(input.deadlineAt))fail('CPU_RESOURCE_PROFILE_CONFLICT');
   const deadlineAt=Math.min(input.deadlineAt,plan.expiresAt,Date.now()+plan.maxLifetimeMs);if(deadlineAt<=Date.now())fail('CPU_RESOURCE_DEADLINE');
   const first=budget('cold'),assets=verifyModelSet(profile,plan,deadlineAt,input.signal),last=budget('cold',first.identity);
   const slot={scope:null,owner:input.owner,scopeValue:input.scope,producer,role:'hot'},record={...slot,slot,deadlineAt,signal:input.signal,assets,cgroupIdentity:last.identity,released:false};occupied=slot;return handle(record);
  },
  requireCpuAdmission:requireAdmission,
  releaseCpu(token,proof,manager){
   const facts=inspect(proof,manager,false),record=token?tokens.get(token):null;
   if(record){retiredOriginal(record,facts.scope);if(facts.scope.admission!==token||record.role!=='hot')fail('CPU_RESOURCE_ORIGINAL_CONFLICT');
    if(record.released)return;if(occupied!==record.slot||record.slot.witnessActive)fail('CPU_RESOURCE_RETIREMENT_PENDING');record.released=true;occupied=null;
   }else{
    if(token!==null||!facts.scope.recovered||occupied&& (occupied.scope!==facts.scope||occupied.role!=='recovery'||occupied.witnessActive))fail('CPU_RESOURCE_ORIGINAL_CONFLICT');occupied=null;
   }
  },
  admitCpuWitness({scope,profileDigest,deadlineAt}){
   actualScope(scope);approved(true);if(profileDigest!==profile.profileDigest||scope.control?.profileDigest!==profile.profileDigest||!Number.isSafeInteger(deadlineAt))fail('CPU_RESOURCE_WITNESS_PROFILE_CONFLICT');
   if(occupied&&(occupied.producer!==producer||occupied.scope!==scope)&&!(occupied?.scope===null&&same(occupied.owner,scope.owner)))fail('CPU_RESOURCE_OTHER_ORIGINAL_ACTIVE');
   if(!occupied&&!scope.recovered)fail('CPU_RESOURCE_ORIGINAL_SCOPE_REQUIRED');
   const facts=budget('witness');
   if(!occupied)occupied={scope,owner:scope.owner,scopeValue:scope.scope,producer,role:'recovery'};
   if(occupied.witnessActive)fail('CPU_RESOURCE_WITNESS_ALREADY_ACTIVE');
   const deadline=Math.min(deadlineAt,plan.retirementExpiresAt,Date.now()+plan.maxWitnessLifetimeMs);if(deadline<=Date.now())fail('CPU_RESOURCE_DEADLINE');
   const record={role:'witness',slot:occupied,scope,scopeValue:scope.scope,owner:scope.owner,producer,deadlineAt:deadline,cgroupIdentity:facts.identity,released:false};
   const token=handle(record);occupied.witnessActive=token;return token;
  },
  releaseCpuWitness(token,proof,manager){
   const facts=inspect(proof,manager,true),record=tokens.get(token);if(!record||record.role!=='witness')fail('CPU_RESOURCE_ADMISSION_ORIGINAL_REQUIRED');retiredOriginal(record,facts.scope);
   if(facts.admission!==token)fail('CPU_RESOURCE_ORIGINAL_CONFLICT');if(record.released)return;
   if(occupied!==record.slot||record.slot.witnessActive!==token)fail('CPU_RESOURCE_ORIGINAL_CONFLICT');record.released=true;delete record.slot.witnessActive;
   if(record.slot.role==='recovery')occupied=null; // Only the positively retired model-free witness allocation; Core still guards its old model control.
  },
 };
 producer=new ManagedCpuSupervisor({profile,ledger,bindContext,...callbacks});return producer;
}
