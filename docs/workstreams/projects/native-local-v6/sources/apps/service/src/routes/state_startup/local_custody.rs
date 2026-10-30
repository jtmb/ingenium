//! Genuine existing frozen guard graph; never a callback returning caller facts.
use super::*;
use veyra_adapters::local_custody::{OriginalStateGuardSource,LocalCustodyOriginals};
pub(super) struct OriginalStateGuard{
 original:Arc<crate::server::guard_reader::GuardOriginal<veyra_adapters::service_registration::ServiceGuards>>,
 originals:Arc<LocalCustodyOriginals>,
}
impl OriginalStateGuard{
 pub(super) fn new(original:Arc<crate::server::guard_reader::GuardOriginal<veyra_adapters::service_registration::ServiceGuards>>)->Arc<Self>{
  Arc::new(Self{original,originals:Arc::new(LocalCustodyOriginals::default())})
 }
}
impl OriginalStateGuardSource for OriginalStateGuard{
 fn with_original(&self,read:&mut dyn FnMut(&veyra_adapters::service_registration::ServiceGuardDirectory<'_>)->Result<(),String>)->Result<(),String>{
  let original=self.original.read_frozen().map_err(|_|"original native guard is not frozen")?;
  let directory=original.configuration_directory().map_err(|_|"original native directory is unavailable")?;
  read(&directory)
 }
 fn originals(&self)->Arc<LocalCustodyOriginals>{self.originals.clone()}
}
