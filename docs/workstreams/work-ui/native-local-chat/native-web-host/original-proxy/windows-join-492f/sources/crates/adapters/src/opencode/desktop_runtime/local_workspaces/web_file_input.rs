//! Actual read owner selected under the retained engine lock, never a DTO.
use super::*;
use super::web_original::{NativeWebOriginal,NativeWindowsWebRead};
use super::web_materialization::{EffectiveWebBody,materialize_resolved_web_files,identity_windows_web_body};
use crate::opencode::attachments::NativeWebFilesOriginal;

pub struct NativeWebFileInput{
 snapshot:Option<NativeWebFilesOriginal>,windows:Option<NativeWindowsWebRead>,
}
impl NativeWebFileInput{
 pub(super) fn snapshot(value:NativeWebFilesOriginal)->Self{Self{snapshot:Some(value),windows:None}}
 pub(super) fn windows(value:NativeWindowsWebRead)->Self{Self{snapshot:None,windows:Some(value)}}
 pub(crate) fn windows_read(&self)->Option<&NativeWindowsWebRead>{self.windows.as_ref()}
 pub(crate) fn contains_image(&self)->Result<bool,String>{
  match(&self.snapshot,&self.windows){(Some(s),None)=>Ok(s.contains_image()),(None,Some(w))=>w.contains_image(),_=>Err("original file owner ambiguous".into())}
 }
 pub(crate) fn effective(&self,original:&NativeWebOriginal)->Result<EffectiveWebBody,String>{
  match(&self.snapshot,&self.windows){(Some(s),None)=>materialize_resolved_web_files(original.body(),s),(None,Some(w))=>identity_windows_web_body(original,w),_=>Err("original file owner ambiguous".into())}
 }
 pub(crate) fn check_current(&self,binding:&LocalWorkspaceBinding,session:&str,operation:&str,input:&str,current:&dyn Fn()->Result<(),String>)->Result<(),String>{
  match(&self.snapshot,&self.windows){(Some(s),None)=>s.check_current(binding,session,operation,input,current),(None,Some(w))=>w.check_captured(binding,session,operation,input,current),_=>Err("original file owner ambiguous".into())}
 }
 pub(crate) fn journal_original(&self,original:&NativeWebOriginal)->Result<Value,String>{
  match(&self.snapshot,&self.windows){(Some(s),None)=>Ok(s.journal_original()),(None,Some(w))=>w.journal_original(original),_=>Err("original file owner ambiguous".into())}
 }
 pub(crate) fn begin_actual_send(&self)->Result<(),String>{
  if let Some(w)=&self.windows{w.begin_actual_send()?;}Ok(())
 }
 pub(crate) fn retire_never_sent(&self,deadline:Instant)->Result<(),String>{
  if let Some(w)=&self.windows{w.retire_never_sent(deadline)?;}Ok(())
 }
}
