//! Common transport correlation has no TaskStore admission semantics.
//! Existing RequestIdentity/SessionGrant remain the exact Task branch.
use super::{GatewayError,RequestIdentity};
use crate::routes::MemorySynthesisAdmission;
use std::{net::SocketAddrV4,sync::Arc};
use veyra_adapters::model::runtime_authority::RuntimeIdentity;
use veyra_contracts::ModelBinding;
#[derive(Clone,PartialEq,Eq)]
pub(crate) enum TransportRequestIdentity{Task(RequestIdentity),MemorySynthesis(MemoryTransportIdentity)}
#[derive(Clone,PartialEq,Eq)]
pub(crate) struct MemoryTransportIdentity{
 request_id:String,scope_hash:String,input_hash:String,engine_instance_id:String,
 binding:ModelBinding,runtime_generation:String,address:SocketAddrV4,
}
impl MemoryTransportIdentity{
 /// Inert correlation from sealed actual-owner inputs, not a native claim.
 /// Original registry/current-source/lease/journal/slot claim is still required.
 pub(super) fn capture(admission:&Arc<MemorySynthesisAdmission>,runtime:&RuntimeIdentity)->Result<Self,GatewayError>{
  let original=admission.original();
  if admission.binding()!=runtime.binding(){return Err(GatewayError::BindingMismatch)}
  Ok(Self{request_id:original.operation_id.clone(),
   scope_hash:original.snapshot.stamp.scope.key().map_err(|_|GatewayError::InvalidGrant)?,
   input_hash:original.input_hash.clone(),engine_instance_id:original.snapshot.stamp.engine_instance_id.clone(),
   binding:runtime.binding().clone(),runtime_generation:runtime.generation().into(),address:runtime.address()})
 }
 pub(crate) fn operation_id(&self)->&str{&self.request_id}
 pub(crate) fn request_id(&self)->&str{&self.request_id}
 pub(crate) fn binding(&self)->&ModelBinding{&self.binding}
 pub(crate) fn runtime_generation(&self)->&str{&self.runtime_generation}
 pub(crate) fn address(&self)->SocketAddrV4{self.address}
 pub(crate) fn matches_original(&self,value:&veyra_memory::MemorySynthesisOriginal)->bool{
  self.request_id==value.operation_id&&self.input_hash==value.input_hash&&
   self.scope_hash==value.snapshot.stamp.scope.key().unwrap_or_default()&&
   self.engine_instance_id==value.snapshot.stamp.engine_instance_id
 }
}
mod sealed{pub trait Sealed{}}
impl sealed::Sealed for RequestIdentity{}
impl sealed::Sealed for MemoryTransportIdentity{}
impl sealed::Sealed for TransportRequestIdentity{}
pub(crate) trait RuntimeCorrelation:sealed::Sealed+Clone+PartialEq+Eq{
 fn common(&self)->TransportRequestIdentity;
 fn request_id(&self)->&str;
 fn binding(&self)->&ModelBinding;
 fn runtime_generation(&self)->&str;
 fn address(&self)->SocketAddrV4;
}
impl RuntimeCorrelation for RequestIdentity{
 fn common(&self)->TransportRequestIdentity{TransportRequestIdentity::Task(self.clone())}
 fn request_id(&self)->&str{self.request_id()}
 fn binding(&self)->&ModelBinding{self.binding()}
 fn runtime_generation(&self)->&str{self.runtime_generation()}
 fn address(&self)->SocketAddrV4{self.address()}
}
impl RuntimeCorrelation for MemoryTransportIdentity{
 fn common(&self)->TransportRequestIdentity{TransportRequestIdentity::MemorySynthesis(self.clone())}
 fn request_id(&self)->&str{self.request_id()}
 fn binding(&self)->&ModelBinding{self.binding()}
 fn runtime_generation(&self)->&str{self.runtime_generation()}
 fn address(&self)->SocketAddrV4{self.address()}
}
impl RuntimeCorrelation for TransportRequestIdentity{
 fn common(&self)->TransportRequestIdentity{self.clone()}
 fn request_id(&self)->&str{self.request_id()}
 fn binding(&self)->&ModelBinding{self.binding()}
 fn runtime_generation(&self)->&str{self.runtime_generation()}
 fn address(&self)->SocketAddrV4{self.address()}
}
impl PartialEq<RequestIdentity> for TransportRequestIdentity{
 fn eq(&self,other:&RequestIdentity)->bool{matches!(self,Self::Task(value) if value==other)}
}
impl PartialEq<TransportRequestIdentity> for RequestIdentity{
 fn eq(&self,other:&TransportRequestIdentity)->bool{other==self}
}
impl TransportRequestIdentity{
 pub(crate) fn request_id(&self)->&str{match self{Self::Task(v)=>v.request_id(),Self::MemorySynthesis(v)=>&v.request_id}}
 pub(crate) fn binding(&self)->&ModelBinding{match self{Self::Task(v)=>v.binding(),Self::MemorySynthesis(v)=>&v.binding}}
 pub(crate) fn runtime_generation(&self)->&str{match self{Self::Task(v)=>v.runtime_generation(),Self::MemorySynthesis(v)=>&v.runtime_generation}}
 pub(crate) fn address(&self)->SocketAddrV4{match self{Self::Task(v)=>v.address(),Self::MemorySynthesis(v)=>v.address}}
 // Deliberately no task_id/turn_id/Project fallback for MemorySynthesis.
 pub(crate) fn task(&self)->Option<&RequestIdentity>{match self{Self::Task(v)=>Some(v),Self::MemorySynthesis(_)=>None}}
}
impl std::fmt::Debug for TransportRequestIdentity{
 fn fmt(&self,f:&mut std::fmt::Formatter<'_>)->std::fmt::Result{f.write_str("TransportRequestIdentity([private purpose correlation])")}
}
