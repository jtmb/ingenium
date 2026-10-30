//! Actual std JoinHandle custody; dropping a future is not joining a worker.
use std::{sync::{Arc,Mutex},thread::JoinHandle};
#[derive(Clone,Copy,PartialEq,Eq)]enum Phase{Reserved,Running,JoinFailed,Joined,SpawnFailed}
pub(crate) struct Worker<T>{state:Mutex<State<T>>}
struct State<T>{phase:Phase,handle:Option<JoinHandle<T>>,value:Option<T>}
impl<T:Send+'static> Worker<T>{
 // Registry must retain this exact allocation BEFORE calling start_once.
 pub(crate) fn reserved()->Arc<Self>{Arc::new(Self{state:Mutex::new(State{phase:Phase::Reserved,handle:None,value:None})})}
 pub(crate) fn start_once(&self,work:impl FnOnce()->T+Send+'static)->Result<(),()>{
  let mut s=self.state.lock().map_err(|_|())?;if s.phase!=Phase::Reserved{return Err(())}
  s.phase=Phase::SpawnFailed; // spawn refusal never looks like joined
  match std::thread::Builder::new().name("native-web-page".into()).spawn(work){
   Ok(handle)=>{s.handle=Some(handle);s.phase=Phase::Running;Ok(())},Err(_)=>Err(())
  }
 }
 pub(crate) fn reconcile(&self)->Result<bool,()>{
  let mut s=self.state.lock().map_err(|_|())?;
  if s.phase==Phase::Joined{return Ok(true)}
  if s.phase!=Phase::Running{return Err(())}
  let handle=s.handle.as_ref().ok_or(())?;if !handle.is_finished(){return Ok(false)}
  s.phase=Phase::JoinFailed; // latch BEFORE consuming the actual handle
  let original=s.handle.take().ok_or(())?;
  match original.join(){Ok(value)=>{s.value=Some(value);s.phase=Phase::Joined;Ok(true)},Err(_)=>Err(())}
 }
 pub(crate) fn take_joined(&self)->Result<T,()>{let mut s=self.state.lock().map_err(|_|())?;if s.phase!=Phase::Joined{return Err(())}s.value.take().ok_or(())}
 // No Drop join, inferred success from missing handle, or retry factory.
}
#[cfg(test)]mod tests{
 use super::*;
 #[test]fn consumed_panic_stays_failed_on_second_reconciliation(){let w=Worker::reserved();w.start_once(||->(){panic!("fixture")}).unwrap();while w.state.lock().unwrap().handle.as_ref().is_some_and(|h|!h.is_finished()){std::thread::yield_now()}assert!(w.reconcile().is_err());assert!(w.reconcile().is_err());assert!(w.take_joined().is_err());}
 #[test]fn unstarted_slot_never_reports_joined(){let w=Worker::<()>::reserved();assert!(w.reconcile().is_err());assert!(w.take_joined().is_err());}
 #[test]fn actual_joined_value_is_consumed_once(){let w=Worker::reserved();w.start_once(||42).unwrap();while w.reconcile()==Ok(false){std::thread::yield_now()}assert_eq!(w.take_joined(),Ok(42));assert!(w.take_joined().is_err());}
}
