//! Closed generic framing; one supervisor/relay/authentication/native-retirement
//! implementation. Existing Task aliases keep exact Task admission types.
use super::*;
use crate::inference::{MemoryCandidate,MemoryClaim};
use crate::inference::request_purpose::{MemoryTransportIdentity,RuntimeCorrelation};
mod sealed{pub trait Sealed{}}
pub(crate) enum TaskPurpose{}
pub(crate) enum MemoryPurpose{}
impl sealed::Sealed for TaskPurpose{}
impl sealed::Sealed for MemoryPurpose{}
pub(crate) trait TransportPurpose:sealed::Sealed+Send+Sync+'static{
 type Identity:RuntimeCorrelation+Send+Sync+'static;
 type Candidate:Send+Sync+'static;
 type Claim:Send+Sync+'static;
 fn identity(value:&Self::Candidate)->&Self::Identity;
 fn binding(value:&Self::Candidate)->&veyra_contracts::ModelBinding;
 fn framing(value:&Self::Candidate)->(HeaderMap,Bytes);
 fn claimed(value:&Self::Claim)->&Self::Identity;
}
impl TransportPurpose for TaskPurpose{
 type Identity=RequestIdentity;type Candidate=CandidateRequest;type Claim=ClaimedRequest;
 fn identity(v:&Self::Candidate)->&Self::Identity{v.identity()}
 fn binding(v:&Self::Candidate)->&veyra_contracts::ModelBinding{&v.grant().binding}
 fn framing(v:&Self::Candidate)->(HeaderMap,Bytes){v.framing_parts()}
 fn claimed(v:&Self::Claim)->&Self::Identity{v.identity()}
}
impl TransportPurpose for MemoryPurpose{
 type Identity=MemoryTransportIdentity;type Candidate=MemoryCandidate;type Claim=MemoryClaim;
 fn identity(v:&Self::Candidate)->&Self::Identity{v.identity()}
 fn binding(v:&Self::Candidate)->&veyra_contracts::ModelBinding{v.binding()}
 fn framing(v:&Self::Candidate)->(HeaderMap,Bytes){v.framing_parts()}
 fn claimed(v:&Self::Claim)->&Self::Identity{v.identity()}
}
pub(crate) type MemoryPreparedTransport=PreparedTransportFor<MemoryPurpose>;
impl TransportSupervisor{
 pub(crate) async fn prepare_memory_retained(mut socket:OwnedAsyncRequestSocket,candidate:MemoryCandidate,observer:&mut Option<SocketAdmissionObserver>)->Result<MemoryPreparedTransport,GatewayError>{
  if observer.is_some(){return Err(GatewayError::InvalidCorrelation)}
  let identity=candidate.identity();let runtime=socket.identity();
  if runtime.binding()!=identity.binding()||runtime.generation()!=identity.runtime_generation()||runtime.address()!=identity.address(){return Err(GatewayError::InvalidCorrelation)}
  *observer=Some(socket.take_socket_admission_observer().map_err(|_|GatewayError::Transport)?);
  let authentication=socket.take_request_authentication(identity.request_id()).map_err(|_|GatewayError::RuntimeUnavailable)?;
  if authentication.is_none(){return Err(GatewayError::RuntimeUnavailable)}
  // Same private handshake and native authentication as the Task branch.
  let prepared=Self::handshake_for::<MemoryPurpose,_>(socket,candidate,None).await?;
  Self::authenticate_for::<MemoryPurpose>(prepared,authentication)
 }
}
