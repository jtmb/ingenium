//! Facts from the actual retained connection; NEVER a verified-peer permit.
//! Parent broker must retain accepted pipe/socket BEFORE calling these queries.
use std::io;
#[derive(Clone,Copy)]pub(crate) struct KernelPeer{pub(crate) pid:u32,pub(crate) uid:Option<u32>}
#[cfg(windows)]mod win{
 use super::*;
 use std::os::windows::io::AsRawHandle;
 use tokio::net::windows::named_pipe::{NamedPipeClient,NamedPipeServer};
 // Exact kernel32 API signatures, no dependency feature/source edit. Root may
 // instead enable the corresponding existing windows-sys System_Pipes feature.
 #[link(name="kernel32")]
 unsafe extern "system"{
  fn GetNamedPipeClientProcessId(pipe:*mut std::ffi::c_void,pid:*mut u32)->i32;
  fn GetNamedPipeServerProcessId(pipe:*mut std::ffi::c_void,pid:*mut u32)->i32;
 }
 pub(crate) fn accepted(pipe:&NamedPipeServer)->io::Result<KernelPeer>{
  let mut pid=0;
  if unsafe{GetNamedPipeClientProcessId(pipe.as_raw_handle(),&mut pid)}==0{return Err(io::Error::last_os_error())}
  if pid==0{return Err(io::Error::other("Native client PID unavailable"))}Ok(KernelPeer{pid,uid:None})
 }
 pub(crate) fn connected(pipe:&NamedPipeClient)->io::Result<KernelPeer>{
  let mut pid=0;
  if unsafe{GetNamedPipeServerProcessId(pipe.as_raw_handle(),&mut pid)}==0{return Err(io::Error::last_os_error())}
  if pid==0{return Err(io::Error::other("Native server PID unavailable"))}Ok(KernelPeer{pid,uid:None})
 }
}
#[cfg(windows)]pub(crate) use win::{accepted as accepted_named_pipe_peer,connected as connected_named_pipe_peer};
#[cfg(target_os="linux")]
pub(crate) fn connected_uds_peer(stream:&tokio::net::UnixStream)->io::Result<KernelPeer>{
 let original=stream.peer_cred()?;
 let pid=u32::try_from(original.pid().ok_or_else(||io::Error::other("Native UDS peer PID unavailable"))?).map_err(|_|io::Error::other("Native UDS peer PID invalid"))?;
 if pid==0{return Err(io::Error::other("Native UDS peer PID invalid"))}
 Ok(KernelPeer{pid,uid:Some(original.uid())})
}
// Deliberately NO is_approved/current/retired constructor or positive predicate.
// PID/UID are only inputs for the original process HANDLE/pidfd + birth/image/
// protected-package capture. Root must implement that genuine owner factory;
// a source/renderer/pipe hello DTO may never substitute for the actual object.
