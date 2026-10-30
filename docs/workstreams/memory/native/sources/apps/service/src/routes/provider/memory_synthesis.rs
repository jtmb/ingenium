//! CLOSED internal MemorySynthesis purpose; never an HTTP/arbitrary-prompt API.
use super::*;
use super::memory_admission::MemorySynthesisAdmission;
use veyra_memory::ValidatedSynthesisOutput;
#[derive(Clone,Copy,Debug,PartialEq,Eq)]
pub(in crate::routes) enum MemorySynthesisUnavailable{
 OriginalRegistrySlotProducer,
 OriginalNativeAcquisitionProducer,
 OriginalRetainedResultProducer,
}
/// Only the original retained native request/result consumer may construct this
/// after exact UUID/payload/runtime matching and actual joined retirement/resume.
/// No Deserialize/Clone/public constructor; parsing output alone cannot mint it.
pub(in crate::routes) struct KnownMemorySynthesisResult{
 admission:Arc<MemorySynthesisAdmission>,output:ValidatedSynthesisOutput,
}
impl KnownMemorySynthesisResult{
 pub(in crate::routes) fn accept(self,state:&ServiceState)->Result<(),GatewayError>{
  self.admission.accept_retained_result(state,self.output)
 }
}
pub(in crate::routes) async fn synthesize(
 _state:Arc<ServiceState>,_admission:Arc<MemorySynthesisAdmission>,
)->Result<KnownMemorySynthesisResult,MemorySynthesisUnavailable>{
 // The pinned native registry still only mints CandidateRequest(SessionGrant)
 // and NativeOriginals still requires DurableTaskAdmission/RequestProgress.
 // This is an explicit unsupported producer, NOT a fake Task, new transport,
 // credential, retry, or claimed connected/qualified implementation.
 // Root must supply the original-owner Memory branch described in the closed
 // purpose contract before this can enroll/reserve/perform any native effect.
 Err(MemorySynthesisUnavailable::OriginalRegistrySlotProducer)
}
