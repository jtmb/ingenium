//! Genuine internal purpose in the ORIGINAL retained ProviderAcquisition cell.
//! Model sockets, observer, framing, native cleanup and leases keep their owners.
use super::*;
use crate::inference::{
 provider_queue::{ProviderQueue,QueuedMemory,QueueWorker},
 MemoryCandidate,MemoryClaim,MemorySlotReleased,
 request_purpose::MemoryTransportIdentity,
 owned_transport::{MemoryPreparedTransport,NativePhaseBook,RetirementBudget,RetiredRequest,ResumedTransport,NativePhaseKind},
};
use super::super::{memory_admission::MemorySynthesisAdmission,memory_synthesis::KnownMemorySynthesisResult};
use veyra_adapters::{
 model::request_barrier::{ResumedRequestObservation,RetiredRequestControls},
 provider_attempts::{MemoryAttemptMetadata,MemoryAttemptYielded},
};
use std::sync::{OnceLock,Weak};
fn metadata_contention<T>(error:std::sync::TryLockError<T>)->GatewayError{
 match error{std::sync::TryLockError::WouldBlock=>GatewayError::RequestBusy,
  std::sync::TryLockError::Poisoned(_)=>GatewayError::RuntimeUnavailable}
}
pub(super) struct MemorySlots{
 retired:OnceLock<RetiredRequest>,resumed:OnceLock<ResumedTransport>,
 observation:OnceLock<ResumedRequestObservation>,controls:OnceLock<RetiredRequestControls>,
 yielded:OnceLock<MemoryAttemptYielded>,released:OnceLock<MemorySlotReleased>,
 resume_deadline:OnceLock<Instant>,
 result:Mutex<Option<Result<KnownMemorySynthesisResult,GatewayError>>>,
}
pub(super) struct MemoryOriginals{
 pub(super) admission:Arc<MemorySynthesisAdmission>,entry:Weak<QueuedMemory>,
 socket:Option<OwnedRequestSocket>,tree:Option<RetainedModelTreeExit>,
 asynchronous:Option<OwnedAsyncRequestSocket>,candidate:Option<MemoryCandidate>,
 observer:Option<SocketAdmissionObserver>,prepared:Option<MemoryPreparedTransport>,
 claimed:Option<MemoryClaim>,operation:Option<Operation>,request:Option<MemoryTransportIdentity>,
 attempt:Option<MemoryAttemptMetadata>,slots:Arc<MemorySlots>,budget:Arc<RetirementBudget>,
 phases:Arc<NativePhaseBook>,
 captured_phases:OnceLock<Arc<crate::inference::owned_transport::CapturedNativePhases>>,
 shutdown:Option<Arc<crate::routes::shutdown_original::ShutdownOriginal>>,
 generation_deadline:Instant,
 pub(super) previous:Option<Arc<ProviderAcquisition>>,pub(super) sequence:u64,
}
impl Originals{
 fn memory_mut(&mut self)->Result<&mut MemoryOriginals,GatewayError>{
  match self{Self::Memory(value)=>Ok(value),_=>Err(GatewayError::RuntimeUnavailable)}
 }
}
impl MemorySlots{
 fn new()->Arc<Self>{Arc::new(Self{retired:OnceLock::new(),resumed:OnceLock::new(),observation:OnceLock::new(),controls:OnceLock::new(),
  yielded:OnceLock::new(),released:OnceLock::new(),resume_deadline:OnceLock::new(),result:Mutex::new(None)})}
}
impl ProviderAcquisition{
 pub(in crate::routes::provider) fn memory_inhibit(&self){
  self.unknown.store(true,Ordering::SeqCst);
  if let Ok(mut phase)=self.phase.lock(){*phase=Phase::Unknown}
  self.cancellation.cancel();
 }
 pub(in crate::routes::provider) fn is_memory(&self)->Result<bool,GatewayError>{
  Ok(matches!(&*self.originals.try_lock().map_err(metadata_contention)?,Originals::Memory(_)))
 }
 fn new_memory(entry:&Arc<QueuedMemory>,previous:Option<Arc<Self>>,sequence:u64,deadline:Instant)->Arc<Self>{
  let phases=NativePhaseBook::new();
  let budget=Arc::new(RetirementBudget::pending(phases.clone(),phases.notifier(),||Ok(None)));
  Arc::new(Self{deadline,cancellation:entry.cancellation.clone(),phase:Mutex::new(Phase::Enrolled),unknown:AtomicBool::new(false),
   originals:Mutex::new(Originals::Memory(Box::new(MemoryOriginals{
    admission:entry.admission.clone(),entry:Arc::downgrade(entry),socket:None,tree:None,asynchronous:None,candidate:None,
    observer:None,prepared:None,claimed:None,operation:None,request:None,attempt:None,slots:MemorySlots::new(),budget,
    phases,captured_phases:OnceLock::new(),shutdown:None,
    generation_deadline:Instant::now()+Duration::from_millis(entry.admission.original().budget.max_elapsed_ms),
    previous,sequence,
   }))),
   #[cfg(test)] clock:Mutex::new(None),
  })
 }
 fn memory_step<T>(&self,from:Phase,to:Phase,work:impl FnOnce(&mut MemoryOriginals)->Result<T,GatewayError>)->Result<T,GatewayError>{
  self.live()?;
  let mut phase=self.phase.try_lock().map_err(unavailable)?;
  if *phase!=from{return Err(GatewayError::Conflict)}
  let mut originals=self.originals.try_lock().map_err(unavailable)?;
  let original=originals.memory_mut()?;
  let mut uncertain=Uncertain{record:self,completed:false};
  let result=work(original)?;self.live()?;*phase=to;uncertain.completed=true;Ok(result)
 }
 fn memory_slots(&self)->Result<Arc<MemorySlots>,GatewayError>{
  Ok(self.originals.try_lock().map_err(unavailable)?.memory_mut()?.slots.clone())
 }
 fn memory_compare_resume(&self,state:&ServiceState,observation:&ResumedRequestObservation)->Result<(),GatewayError>{
  let held=self.originals.try_lock().map_err(metadata_contention)?;
  let Originals::Memory(o)=&*held else{return Err(GatewayError::InvalidCorrelation)};
  compare_resume_original(state,o,observation)
 }
 fn memory_resume_ready(&self,state:&ServiceState)->Result<(),GatewayError>{
  let held=self.originals.try_lock().map_err(metadata_contention)?;
  let Originals::Memory(o)=&*held else{return Err(GatewayError::InvalidCorrelation)};
  if self.unknown.load(Ordering::SeqCst){return Err(GatewayError::RuntimeUnavailable)}
  match &o.shutdown{
   None=>match state.model_work.check_resume_admission(){
    Ok(())=>Ok(()),
    Err(crate::routes::model_work::ModelWorkError::Busy) if state.shutdown_original.get().is_some()=>Err(GatewayError::RequestBusy),
    Err(_)=>Err(GatewayError::RuntimeUnavailable),
   },
   #[cfg(windows)]
   Some(parent)=>{
    o.captured_phases.get().ok_or(GatewayError::RuntimeUnavailable)?.check_current(&o.phases)?;
    parent.check_resume_progress(state).map_err(unavailable)
   },
   #[cfg(not(windows))]
   Some(_)=>Err(GatewayError::RuntimeUnavailable),
  }
 }
 async fn memory_wait_resume_ready(&self,state:&ServiceState,slots:&MemorySlots,budget:&RetirementBudget)->Result<(),GatewayError>{
  // One original cap across metadata retries. No new Native work is launched
  // until ordinary or actual captured-shutdown admission is established.
  let deadline=*slots.resume_deadline.get_or_init(||Instant::now()+Duration::from_secs(3));
  loop{
   budget.phase_deadline(deadline)?;
   match self.memory_resume_ready(state){
    Ok(())=>return Ok(()),
    Err(GatewayError::RequestBusy)=>{budget.wait(Some(deadline),tokio::time::sleep(Duration::from_millis(25))).await?;},
    Err(error)=>return Err(error),
   }
  }
 }
 fn memory_capture_convert(&self,state:&ServiceState,runtime:&tokio::runtime::Handle)->Result<(),GatewayError>{
  self.memory_step(Phase::Enrolled,Phase::Converted,|o|{
   o.admission.check_current(state)?;
   o.budget.begin_setup()?;
   // Enrolled cell exists before the original ModelWorkOwner's first effect.
   o.socket=Some(state.model_work.connect_owned_request(o.admission.binding(),self.deadline).map_err(unavailable)?);
   self.live()?;
   let socket=o.socket.as_mut().ok_or(GatewayError::RuntimeUnavailable)?;
   o.tree=Some(socket.take_tree_exit_observer().map_err(unavailable)?);
   if o.tree.as_ref().ok_or(GatewayError::RuntimeUnavailable)?.identity()!=socket.identity(){return Err(GatewayError::InvalidCorrelation)}
   self.live()?;
   let socket=o.socket.take().ok_or(GatewayError::RuntimeUnavailable)?;
   let _entered=runtime.enter();
   o.asynchronous=Some(socket.into_async().map_err(unavailable)?);
   o.admission.check_current(state)
  })
 }
 fn memory_candidate(&self,state:&ServiceState,provider:&ProviderState)->Result<(),GatewayError>{
  self.memory_step(Phase::Converted,Phase::Candidate,|o|{
   provider.journal.can_admit()?;
   let residency=state.residency.try_lock().map_err(unavailable)?;
   let runtime=o.asynchronous.as_ref().ok_or(GatewayError::RuntimeUnavailable)?.identity();
   o.candidate=Some(provider.registry.candidate_memory_request(o.admission.clone(),state,runtime,&residency)?);
   Ok(())
  })
 }
 fn memory_prepare_verify(&self,state:&ServiceState,runtime:&tokio::runtime::Handle)->Result<(),GatewayError>{
  self.memory_step(Phase::Candidate,Phase::Verified,|o|{
   let socket=o.asynchronous.take().ok_or(GatewayError::RuntimeUnavailable)?;
   let candidate=o.candidate.take().ok_or(GatewayError::InvalidCorrelation)?;
   // Private effect cell, not Serial/store/Core locks, across handshake await.
   o.prepared=Some(runtime.block_on(async{
    tokio::time::timeout_at(tokio::time::Instant::from_std(self.deadline),
     TransportSupervisor::prepare_memory_retained(socket,candidate,&mut o.observer)).await.map_err(unavailable)?
   })?);
   o.candidate=Some(o.prepared.as_mut().ok_or(GatewayError::RuntimeUnavailable)?.take_candidate()?);
   let observer=o.observer.as_ref().ok_or(GatewayError::RuntimeUnavailable)?;
   observer.verify().map_err(unavailable)?;
   observer.check_live().map_err(unavailable)?;
   state.model_work.try_compare_socket(observer).map_err(unavailable)?;
   o.admission.check_current(state)
  })
 }
 fn memory_claim(&self,state:&ServiceState,provider:&mut ProviderState)->Result<(),GatewayError>{
  self.memory_step(Phase::Verified,Phase::Claimed,|o|{
   provider.journal.can_admit()?;
   let residency=state.residency.try_lock().map_err(unavailable)?;
   let observer=o.observer.as_ref().ok_or(GatewayError::RuntimeUnavailable)?;
   let candidate=o.candidate.as_ref().ok_or(GatewayError::InvalidCorrelation)?;
   provider.registry.check_memory_candidate(candidate,state,observer.identity(),&residency)?;
   observer.check_live().map_err(unavailable)?;state.model_work.try_compare_socket(observer).map_err(unavailable)?;
   let identity=candidate.identity().clone();let original=o.admission.original();
   o.attempt=Some(MemoryAttemptMetadata{request_id:identity.request_id().into(),
    scope_hash:original.snapshot.stamp.scope.key().map_err(|_|GatewayError::InvalidGrant)?,
    input_hash:original.input_hash.clone(),source_watermark:original.snapshot.watermark.clone(),
    payload_sha256:original.payload_sha256.clone(),engine_instance_id:original.snapshot.stamp.engine_instance_id.clone(),
    policy_revision:original.snapshot.policy_revision,chat_revision:original.snapshot.chat_revision,
    binding:o.admission.binding().clone(),runtime:RuntimeMetadata::from(observer.identity())});
   provider.journal.commit_memory_once(o.attempt.as_ref().ok_or(GatewayError::RuntimeUnavailable)?)?;
   // After persistence, repeat exact source/policy/lease/runtime/slot checks.
   provider.registry.check_memory_candidate(candidate,state,observer.identity(),&residency)?;
   observer.check_live().map_err(unavailable)?;state.model_work.try_compare_socket(observer).map_err(unavailable)?;self.live()?;
   o.claimed=Some(provider.registry.claim_memory_request(o.candidate.take().ok_or(GatewayError::InvalidCorrelation)?,state,observer.identity(),&residency)?);
   o.request=Some(identity);Ok(())
  })
 }
 fn memory_start(&self,state:&ServiceState)->Result<Operation,GatewayError>{
  self.memory_step(Phase::Claimed,Phase::Published,|o|{
   o.admission.check_current(state)?;
   let observer=o.observer.as_ref().ok_or(GatewayError::RuntimeUnavailable)?;
   observer.check_live().map_err(unavailable)?;state.model_work.try_compare_socket(observer).map_err(unavailable)?;
   o.prepared.as_mut().ok_or(GatewayError::RuntimeUnavailable)?.bind_retirement_budget(o.request.as_ref().ok_or(GatewayError::InvalidCorrelation)?,o.budget.clone())?;
   let transport=o.prepared.take().ok_or(GatewayError::RuntimeUnavailable)?.bind_claim(o.claimed.take().ok_or(GatewayError::InvalidCorrelation)?)?;
   o.operation=Some(state.provider_transports.start(transport,self.cancellation.clone())?);
   // Returned response control is not native custody; original supervisor,
   // observer/tree/authentication/worker remain retained before publication.
   self.live()?;
   o.operation.take().ok_or(GatewayError::RuntimeUnavailable)
  })
 }
}
fn compare_resume_original(state:&ServiceState,o:&MemoryOriginals,observation:&ResumedRequestObservation)->Result<(),GatewayError>{
 match &o.shutdown{
  None=>state.model_work.try_compare_resume(observation).map_err(unavailable),
  #[cfg(windows)]
  Some(parent)=>{
   let captured=o.captured_phases.get().ok_or(GatewayError::RuntimeUnavailable)?;
   captured.check_current(&o.phases)?;
   parent.compare_resume_progress(state,observation).map_err(unavailable)?;
   captured.check_current(&o.phases)
  },
  #[cfg(not(windows))]
  Some(_)=>Err(GatewayError::RuntimeUnavailable),
 }
}
fn memory_records(provider:&ProviderState)->Result<Vec<Arc<ProviderAcquisition>>,GatewayError>{
 let mut cursor=provider.acquisition.clone();let mut seen=std::collections::BTreeSet::new();let mut selected=Vec::new();
 while let Some(record)=cursor{
  if seen.len()>=128||!seen.insert(Arc::as_ptr(&record) as usize){return Err(GatewayError::InvalidCorrelation)}
  let held=record.originals.try_lock().map_err(metadata_contention)?;
  cursor=match &*held{
   Originals::Native(o)=>o.previous.clone(),
   Originals::Memory(o)=>{selected.push(record.clone());o.previous.clone()},
   #[cfg(test)] Originals::Source(_)=>return Err(GatewayError::InvalidCorrelation),
  };
 }
 Ok(selected)
}
impl ProviderState{
 /// Original shutdown preparation invokes this under Serial before any model
 /// stop. Retain the actual parent and clamp this exact book before cancelling.
 #[cfg(windows)]
 pub(in crate::routes) fn capture_memory_shutdown(&self,state:&ServiceState,parent:&Arc<crate::routes::shutdown_original::ShutdownOriginal>)->Result<(),GatewayError>{
  let bound=parent.cancellation_owner_state().map_err(unavailable)?;
  if !std::ptr::eq(bound.as_ref(),state){return Err(GatewayError::InvalidCorrelation)}
  for record in memory_records(self)?{
   let result=(||{
    let mut held=record.originals.try_lock().map_err(metadata_contention)?;let o=held.memory_mut()?;
    if let Some(actual)=&o.shutdown{if !Arc::ptr_eq(actual,parent){return Err(GatewayError::InvalidCorrelation)}}
    else{o.shutdown=Some(parent.clone())}
    if let Some(captured)=o.captured_phases.get(){captured.check_current(&o.phases)?}
    else{
     let captured=o.phases.capture(parent.deadline())?;
     o.captured_phases.set(captured).map_err(|_|GatewayError::Conflict)?;
    }
    record.cancellation.cancel();Ok(())
   })();
   if let Err(error)=result{record.unknown.store(true,Ordering::SeqCst);record.cancellation.cancel();return Err(error)}
  }
  Ok(())
 }
}
/// Same original queue workers, joined outside Serial/store/provider locks.
#[cfg(windows)]
pub(in crate::routes) async fn settle_shutdown(state:&Arc<ServiceState>,parent:&Arc<crate::routes::shutdown_original::ShutdownOriginal>)->Result<(),GatewayError>{
 let (records,entries)={let provider=state.provider.try_lock().map_err(metadata_contention)?;
  (memory_records(&provider)?,provider.registry.provider_queue().memory_shutdown_workers()?)};
 // Waiting entries may have been enrolled before model admission but still
 // have a known no-native refusal. Join those original workers as well.
 for entry in entries{
  tokio::time::timeout_at(parent.deadline().into(),async{
   let mut worker=entry.worker.lock().await;
   if let QueueWorker::Running(handle)=&mut *worker{
    let outcome=handle.await.map_err(unavailable).and_then(|r|r);*worker=QueueWorker::Joined(outcome);
   }
   if entry.record.lock().map_err(unavailable)?.is_none(){
    // Source/current-model fences refuse these before native enrollment.
    // Queue refusal is checked separately by the complete original census.
    if !matches!(&*worker,QueueWorker::Joined(_)){return Err(GatewayError::RuntimeUnavailable)}
   }else if !matches!(&*worker,QueueWorker::Joined(Ok(()))){return Err(GatewayError::RuntimeUnavailable)}
   Ok(())
  }).await.map_err(unavailable)??;
 }
 for record in records{
  let captured={let mut held=record.originals.try_lock().map_err(metadata_contention)?;let o=held.memory_mut()?;
   if !o.shutdown.as_ref().is_some_and(|actual|Arc::ptr_eq(actual,parent)){return Err(GatewayError::InvalidCorrelation)}
   o.captured_phases.get().cloned().ok_or(GatewayError::RuntimeUnavailable)?};
  budget(parent.deadline())?;
  tokio::time::timeout_at(parent.deadline().into(),joined(&record)).await.map_err(unavailable)??;
  check_captured_phases(&record,&captured)?;
  parent.cancellation_owner_state().map_err(unavailable)?;
 }
 Ok(())
}
pub(super) async fn joined(record:&Arc<ProviderAcquisition>)->Result<(),GatewayError>{
 let entry={let mut held=record.originals.try_lock().map_err(unavailable)?;held.memory_mut()?.entry.upgrade().ok_or(GatewayError::RuntimeUnavailable)?};
 let mut worker=entry.worker.lock().await;
 if let QueueWorker::Running(handle)=&mut *worker{
  let outcome=handle.await.map_err(unavailable).and_then(|r|r);*worker=QueueWorker::Joined(outcome);
 }
 let outcome=match &*worker{QueueWorker::Joined(result)=>*result,_=>Err(GatewayError::RuntimeUnavailable)};
 drop(worker);outcome?;check_reusable(record).map(|_|())
}
pub(super) fn check_reusable(record:&ProviderAcquisition)->Result<u64,GatewayError>{
 if record.unknown.load(Ordering::SeqCst)||*record.phase.try_lock().map_err(metadata_contention)?!=Phase::Yielded{return Err(GatewayError::RuntimeUnavailable)}
 let mut held=record.originals.try_lock().map_err(metadata_contention)?;let o=held.memory_mut()?;
 let entry=o.entry.upgrade().ok_or(GatewayError::RuntimeUnavailable)?;
 let worker=entry.worker.try_lock().map_err(|_|GatewayError::RequestBusy)?;
 if !matches!(&*worker,QueueWorker::Joined(Ok(())))||(o.sequence==1)!=o.previous.is_none()||
    o.slots.yielded.get().is_none()||o.slots.observation.get().is_none()||
    o.slots.released.get().is_none_or(|r|Some(r.identity())!=o.request.as_ref()){return Err(GatewayError::RuntimeUnavailable)}
 o.slots.controls.get().ok_or(GatewayError::RuntimeUnavailable)?.check_retired().map_err(unavailable)?;
 Ok(o.sequence)
}
pub(in crate::routes::provider) fn take_result(record:&ProviderAcquisition)->Result<KnownMemorySynthesisResult,GatewayError>{
 check_reusable(record)?;
 let slots=record.memory_slots()?;let mut result=slots.result.lock().map_err(unavailable)?;
 result.take().ok_or(GatewayError::Conflict)?
}
pub(super) fn previous(record:&ProviderAcquisition)->Result<Option<Arc<ProviderAcquisition>>,GatewayError>{
 Ok(record.originals.try_lock().map_err(metadata_contention)?.memory_mut()?.previous.clone())
}
pub(super) fn request_identity(record:&ProviderAcquisition)->Result<MemoryTransportIdentity,GatewayError>{
 Ok(record.originals.try_lock().map_err(metadata_contention)?.memory_mut()?.request.clone().ok_or(GatewayError::InvalidCorrelation)?)
}
/// Called only by the original shutdown ProviderHistory capture after the
/// queue/slot/worker census proves every Memory request has actually retired.
pub(in crate::routes::provider) fn capture_phases(record:&ProviderAcquisition,deadline:Instant)
 ->Result<Arc<crate::inference::owned_transport::CapturedNativePhases>,GatewayError>{
 check_reusable(record)?;
 let mut held=record.originals.try_lock().map_err(unavailable)?;let o=held.memory_mut()?;
 if let Some(captured)=o.captured_phases.get(){captured.check_current(&o.phases)?;return Ok(captured.clone())}
 let captured=o.phases.capture(deadline)?;
 o.captured_phases.set(captured.clone()).map_err(|_|GatewayError::Conflict)?;
 captured.check_current(&o.phases)?;Ok(captured)
}
pub(in crate::routes::provider) fn check_captured_phases(record:&ProviderAcquisition,
 captured:&Arc<crate::inference::owned_transport::CapturedNativePhases>)->Result<(),GatewayError>{
 check_reusable(record)?;
 let mut held=record.originals.try_lock().map_err(unavailable)?;let o=held.memory_mut()?;
 if !o.captured_phases.get().is_some_and(|actual|Arc::ptr_eq(actual,captured)){return Err(GatewayError::InvalidCorrelation)}
 captured.check_current(&o.phases)
}
/// Historical checks use retained originals only; no transcript reread or model
/// request can be initiated by drain/history inspection.
pub(in crate::routes::provider) fn check_history(record:&ProviderAcquisition,provider:&ProviderState,
 transports:&TransportSupervisor,deadline:Instant)->Result<MemoryTransportIdentity,GatewayError>{
 budget(deadline)?;check_reusable(record)?;
 let mut held=record.originals.try_lock().map_err(unavailable)?;let o=held.memory_mut()?;
 let identity=o.request.as_ref().ok_or(GatewayError::InvalidCorrelation)?;
 if o.socket.is_some()||o.asynchronous.is_some()||o.candidate.is_some()||o.prepared.is_some()||o.claimed.is_some()||o.operation.is_some(){return Err(GatewayError::RuntimeUnavailable)}
 let tree=o.tree.as_ref().ok_or(GatewayError::RuntimeUnavailable)?;
 let observer=o.observer.as_ref().ok_or(GatewayError::RuntimeUnavailable)?;
 let observation=o.slots.observation.get().ok_or(GatewayError::RuntimeUnavailable)?;
 let controls=o.slots.controls.get().ok_or(GatewayError::RuntimeUnavailable)?;
 let attempt=o.attempt.as_ref().ok_or(GatewayError::InvalidCorrelation)?;
 if tree.identity()!=observer.identity()||tree.identity()!=observation.identity()||tree.identity()!=controls.identity()||
    observation.request_id()!=identity.request_id()||tree.identity().generation()!=identity.runtime_generation()||
    tree.identity().binding()!=identity.binding()||attempt.runtime!=RuntimeMetadata::from(tree.identity())||
    !identity.matches_original(o.admission.original())||
    !provider.journal.owns_memory_yielded(o.slots.yielded.get().ok_or(GatewayError::RuntimeUnavailable)?,attempt){return Err(GatewayError::InvalidCorrelation)}
 tree.check_retired_queries(tree.identity(),deadline).map_err(unavailable)?;
 observer.check_retired_queries(tree.identity(),deadline).map_err(unavailable)?;
 controls.check_retired().map_err(unavailable)?;
 transports.check_retired_request(identity,&record.cancellation,
  o.slots.retired.get().ok_or(GatewayError::RuntimeUnavailable)?,
  o.slots.resumed.get().ok_or(GatewayError::RuntimeUnavailable)?)?;
 budget(deadline)?;Ok(identity.clone())
}
pub(in crate::routes::provider) async fn drive(state:Arc<ServiceState>,queue:Arc<ProviderQueue>,entry:Arc<QueuedMemory>)->Result<(),GatewayError>{
 let previous=state.provider.try_lock().map_err(unavailable)?.acquisition.clone();
 if let Some(previous)=&previous{join_predecessor(previous).await?}
 let serial=state.serial.clone().lock_owned().await;
 let authority=state.clone();let candidate=entry.clone();let book=queue.clone();
 let record=state.provider_workers.run(move||{
  let _serial=serial;
  candidate.admission.check_current(&authority)?;
  // A queued metadata entry can outlive the initial factory check. Refuse
  // before enrolling a utility lease/original if shutdown/model work won.
  if authority.model_work.has_retained().map_err(unavailable)?{return Err(GatewayError::RequestBusy)}
  let mut provider=authority.provider.try_lock().map_err(unavailable)?;
  if !same_optional_record(provider.acquisition.as_ref(),previous.as_ref()){return Err(GatewayError::RequestBusy)}
  provider.journal.can_admit()?;
  provider.journal.can_admit_memory_input(candidate.admission.original())?;
  if provider.registry.active_purpose_request()?.is_some(){return Err(GatewayError::RequestBusy)}
  if !book.reserve_memory(&candidate)?{return Err(GatewayError::RequestBusy)}
  let sequence=match &previous{Some(p)=>slot_yield::check_reusable(p)?.checked_add(1).filter(|v|*v<=128).ok_or(GatewayError::RequestBusy)?,None=>1};
  let mut held=candidate.record.try_lock().map_err(unavailable)?;
  if held.is_some(){return Err(GatewayError::Conflict)}
  let mut residency=authority.residency.try_lock().map_err(unavailable)?;
  let original=candidate.admission.original();
  let id=&original.operation_id;let binding=candidate.admission.binding();
  residency.validate_observed_ready(binding).map_err(unavailable)?;
  // Respect existing transition/execution fairness; no model load or preemption.
  if residency.queued_transitions()!=0||residency.execution_holder().is_some(){return Err(GatewayError::RequestBusy)}
  let admitted=residency.request_turn(veyra_core::residency::TurnRequest{turn_id:id.clone(),binding:binding.clone(),parent_turn:None}).map_err(unavailable)?;
  if admitted!=veyra_core::residency::Admission::Admitted{
   residency.request_cancellation(id).map_err(unavailable)?;return Err(GatewayError::RequestBusy)
  }
  if residency.request_execution_if_available(id,binding).is_err(){
   // Known negative witness: no record/native setup exists yet. This is only
   // our newly admitted utility root; it is not another Task's lease.
   residency.observe_terminal(id).map_err(unavailable)?;return Err(GatewayError::RequestBusy)
  }
  let record=ProviderAcquisition::new_memory(&candidate,previous,sequence,Instant::now()+Duration::from_secs(10));
  provider.acquisition=Some(record.clone());*held=Some(record.clone());Ok(record)
 }).await;
 let record=match record{
  Ok(record)=>record,
  Err(error)=>{queue.refuse_memory_without_original(&entry)?;return Err(error)}
 };
 let outcome=run_original(state.clone(),record.clone()).await;
 if let Err(error)=outcome{
  record.unknown.store(true,Ordering::SeqCst);
  if let Ok(mut phase)=record.phase.lock(){*phase=Phase::Unknown}
  record.cancellation.cancel();queue.memory_unknown(&entry)?;return Err(error)
 }
 Ok(())
}
async fn run_original(state:Arc<ServiceState>,record:Arc<ProviderAcquisition>)->Result<(),GatewayError>{
 let runtime=tokio::runtime::Handle::current();
 let owner=state.clone();let work=record.clone();let io_runtime=runtime.clone();
 state.provider_workers.run(move||work.memory_capture_convert(&owner,&io_runtime)).await?;
 let serial=state.serial.clone().lock_owned().await;
 let owner=state.clone();let work=record.clone();
 state.provider_workers.run(move||{let _serial=serial;let provider=owner.provider.try_lock().map_err(unavailable)?;
  require_current_record(&provider,&work)?;work.memory_candidate(&owner,&provider)}).await?;
 let owner=state.clone();let work=record.clone();
 state.provider_workers.run(move||work.memory_prepare_verify(&owner,&runtime)).await?;
 let serial=state.serial.clone().lock_owned().await;
 let owner=state.clone();let work=record.clone();
 state.provider_workers.run(move||{let _serial=serial;let mut provider=owner.provider.try_lock().map_err(unavailable)?;
  require_current_record(&provider,&work)?;work.memory_claim(&owner,&mut provider)}).await?;
 // Same retained blocking ledger for final start. Only response control leaves
 // the cell; native/authentication/observer/tree stay in original owners.
 let owner=state.clone();let work=record.clone();
 let operation=state.provider_workers.run(move||work.memory_start(&owner)).await?;
 let (identity,slots,budget,generation_deadline,admission)={
  let mut held=record.originals.try_lock().map_err(unavailable)?;let o=held.memory_mut()?;
  (o.request.clone().ok_or(GatewayError::InvalidCorrelation)?,o.slots.clone(),o.budget.clone(),o.generation_deadline,o.admission.clone())
 };
 // Bounded response data only. Cancellation/EOF/drop is never a release fact.
 let response=read_reply(operation,generation_deadline,&record.cancellation).await;
 if response.is_err(){record.cancellation.cancel()}
 state.provider_transports.wait_relay_completion(&identity).await?;
 let retired=state.provider_transports.request_retirement(&identity).await?;
 slots.retired.set(retired).map_err(|_|GatewayError::Conflict)?;
 record.memory_wait_resume_ready(&state,&slots,&budget).await?;
 let resumed=state.provider_transports.resume_request(slots.retired.get().ok_or(GatewayError::RuntimeUnavailable)?).await?
  .ok_or(GatewayError::RuntimeUnavailable)?;
 slots.resumed.set(resumed).map_err(|_|GatewayError::Conflict)?;
 let observation_slots=slots.clone();let observer_state=state.clone();let observer_budget=budget.clone();let observer_record=record.clone();
 state.provider_workers.run(move||{
  observer_record.memory_resume_ready(&observer_state)?;
  let phase=observer_budget.enter_phase(NativePhaseKind::Observation,Instant::now()+Duration::from_secs(3))?;
  let observation=observer_state.provider_transports.observe_resumed(observation_slots.resumed.get().ok_or(GatewayError::RuntimeUnavailable)?,phase.deadline())?;
  observation_slots.observation.set(observation).map_err(|_|GatewayError::Conflict)?;phase.returned();
  observer_record.memory_compare_resume(&observer_state,observation_slots.observation.get().ok_or(GatewayError::RuntimeUnavailable)?)?;
  observer_record.memory_resume_ready(&observer_state)?;
  let phase=observer_budget.enter_phase(NativePhaseKind::Controls,Instant::now()+Duration::from_secs(3))?;
  let controls=observer_state.provider_transports.retire_request_controls(
   observation_slots.retired.get().ok_or(GatewayError::RuntimeUnavailable)?,
   observation_slots.resumed.get().ok_or(GatewayError::RuntimeUnavailable)?,phase.deadline())?;
  observation_slots.controls.set(controls).map_err(|_|GatewayError::Conflict)?;phase.returned();
  observation_slots.controls.get().ok_or(GatewayError::RuntimeUnavailable)?.check_retired().map_err(unavailable)?;
  Ok(())
 }).await?;
 let serial=state.serial.clone().lock_owned().await;
 let commit_state=state.clone();let work=record.clone();let commit_slots=slots.clone();let key=identity.clone();
 state.provider_workers.run(move||{
  let _serial=serial;let deadline=budget.phase_deadline(Instant::now()+Duration::from_secs(3))?;
  let mut provider=commit_state.provider.try_lock().map_err(unavailable)?;require_current_record(&provider,&work)?;
  if work.unknown.load(Ordering::SeqCst){return Err(GatewayError::RuntimeUnavailable)}
  let mut phase=work.phase.try_lock().map_err(unavailable)?;
  if *phase!=Phase::Published{return Err(GatewayError::InvalidCorrelation)}
  let mut uncertain=Uncertain{record:&work,completed:false};
  let observation=commit_slots.observation.get().ok_or(GatewayError::RuntimeUnavailable)?;
  let resumed=commit_slots.resumed.get().ok_or(GatewayError::RuntimeUnavailable)?;
  commit_slots.controls.get().ok_or(GatewayError::RuntimeUnavailable)?.check_retired().map_err(unavailable)?;
  observation.check_live().map_err(unavailable)?;work.memory_compare_resume(&commit_state,observation)?;
  let mut residency=commit_state.residency.try_lock().map_err(unavailable)?;
  provider.registry.validate_memory_terminal(&key,resumed,observation,&residency)?;
  let mut originals=work.originals.try_lock().map_err(unavailable)?;let o=originals.memory_mut()?;
  let attempt=o.attempt.as_ref().ok_or(GatewayError::InvalidCorrelation)?;
  if attempt.runtime!=RuntimeMetadata::from(observation.identity()){return Err(GatewayError::InvalidCorrelation)}
  let yielded=provider.journal.mark_memory_yielded(attempt)?;
  commit_slots.yielded.set(yielded).map_err(|_|GatewayError::Conflict)?;
  if !provider.journal.owns_memory_yielded(commit_slots.yielded.get().ok_or(GatewayError::RuntimeUnavailable)?,attempt){return Err(GatewayError::InvalidCorrelation)}
  // Late persistence/correlation failure retains the yielded receipt; no retry.
  budget.phase_deadline(deadline)?;observation.check_live().map_err(unavailable)?;
  compare_resume_original(&commit_state,o,observation)?;
  let released=provider.registry.finish_memory_terminal(&key,resumed,observation,&mut residency)?;
  commit_slots.released.set(released).map_err(|_|GatewayError::Conflict)?;
  let entry=o.entry.upgrade().ok_or(GatewayError::RuntimeUnavailable)?;
  provider.registry.provider_queue().complete_memory(&entry,commit_slots.released.get().ok_or(GatewayError::RuntimeUnavailable)?)?;
  *phase=Phase::Yielded;uncertain.completed=true;Ok(())
 }).await?;
 let result=response.and_then(|body|{
  let output=veyra_memory::ValidatedSynthesisOutput::parse(admission.original(),&body).map_err(|_|GatewayError::InvalidBody)?;
  KnownMemorySynthesisResult::from_retired(admission,output,slots.released.get().ok_or(GatewayError::RuntimeUnavailable)?)
 });
 *slots.result.lock().map_err(unavailable)?=Some(result);Ok(())
}
async fn read_reply(operation:Operation,deadline:Instant,cancel:&CancellationHandle)->Result<Vec<u8>,GatewayError>{
 let read=async{
  let mut response=operation.into_response().await?;
  if response.status!=axum::http::StatusCode::OK{return Err(GatewayError::InvalidBody)}
  let mut body=Vec::new();
  while let Some(part)=response.data.recv().await{
   let part=part?;
   if body.len().checked_add(part.len()).is_none_or(|n|n>veyra_memory::MAX_SYNTHESIS_REPLY){return Err(GatewayError::InvalidBody)}
   body.extend_from_slice(&part);
  }Ok(body)
 };
 match tokio::time::timeout_at(tokio::time::Instant::from_std(deadline),read).await{
  Ok(result)=>result,Err(_)=>{cancel.cancel();Err(GatewayError::RuntimeUnavailable)}
 }
}
