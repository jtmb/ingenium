//! Narrow learning operations on the original LiveAgent-owned runtime. Callers
//! retain Serial/current ProjectStore and pass the original Goals owner; this
//! facade supplies no runtime getter, callback or alternative store writer.
use super::LiveAgent;
use crate::routes::goal_runtime::Goals;
use veyra_adapters::{projects::ProjectStore,native_memory_owner::NativeMemoryOwner,
 opencode::desktop_runtime::RuntimeError};
use veyra_contracts::ModelBinding;
use veyra_memory::{CompletedSnapshot,ExecutionStamp,SynthesisModel,LearnedEntry,Receipt};
impl LiveAgent{
 pub(in crate::routes) fn capture_learning(&self,goals:&Goals,store:&ProjectStore,owner:&NativeMemoryOwner,chat:&str,now:u64)->Result<CompletedSnapshot,String>{
  goals.capture_learning(store,owner,&self.runtime,chat,now)
 }
 pub(in crate::routes) fn memory_synthesis_model(&self,store:&ProjectStore,owner:&NativeMemoryOwner,chat:&str)->Result<(ExecutionStamp,ModelBinding,SynthesisModel),RuntimeError>{
  self.runtime.memory_synthesis_model(store,owner,chat)
 }
 pub(in crate::routes) fn verify_learning(&self,goals:&Goals,store:&ProjectStore,owner:&NativeMemoryOwner,snapshot:&CompletedSnapshot)->Result<(),String>{
  goals.verify_learning(store,owner,&self.runtime,snapshot)
 }
 pub(in crate::routes) fn accept_learning(&self,goals:&Goals,store:&ProjectStore,owner:&NativeMemoryOwner,snapshot:&CompletedSnapshot,operation:&str,entry:LearnedEntry)->Result<Receipt,String>{
  goals.accept_learning(store,owner,&self.runtime,snapshot,operation,entry)
 }
}
