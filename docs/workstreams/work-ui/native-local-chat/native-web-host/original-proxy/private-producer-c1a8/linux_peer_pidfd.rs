//! Linux x86_64/aarch64 source only. Real socket-bound pidfd, never PID reopen.
//! Parent registry retains this Arc BEFORE capture_on; no Drop cleanup/retry.
#![cfg(all(target_os="linux",any(target_arch="x86_64",target_arch="aarch64")))]
use std::{io,os::fd::AsRawFd,sync::{Arc,Mutex}};
use tokio::net::UnixStream;
// Pinned libc0.2.190 Linux UAPI values for these targets. Root may instead add
// the exact existing libc dependency; no manifest/lock change is made here.
const SOL_SOCKET:i32=1;const SO_PEERPIDFD:i32=77;
#[repr(C)]struct PollFd{fd:i32,events:i16,revents:i16}
unsafe extern "C"{
 fn getsockopt(fd:i32,level:i32,name:i32,value:*mut std::ffi::c_void,length:*mut u32)->i32;
 fn poll(fds:*mut PollFd,count:usize,timeout:i32)->i32;
 fn close(fd:i32)->i32;
}
enum State{Reserved,Querying,Owned(i32),CaptureFailed,CloseStarted(i32),Closed,CloseFailed(i32)}
pub(crate) struct PeerPidfd{state:Mutex<State>}
impl PeerPidfd{
 pub(crate) fn reserved()->Arc<Self>{Arc::new(Self{state:Mutex::new(State::Reserved)})}
 pub(crate) fn capture_on(&self,actual:&UnixStream)->io::Result<()>{
  let mut state=self.state.lock().map_err(|_|io::Error::other("Original peer pidfd poisoned"))?;
  if !matches!(*state,State::Reserved){return Err(io::Error::other("Original peer pidfd already attempted"))}
  *state=State::Querying;let mut fd=-1i32;let mut size=std::mem::size_of::<i32>()as u32;
  let result=unsafe{getsockopt(actual.as_raw_fd(),SOL_SOCKET,SO_PEERPIDFD,(&mut fd as*mut i32).cast(),&mut size)};
  if result!=0{*state=State::CaptureFailed;return Err(io::Error::last_os_error())}
  if fd<0{*state=State::CaptureFailed;return Err(io::Error::other("Kernel returned no peer pidfd"))}
  *state=State::Owned(fd); // actual new kernel descriptor retained BEFORE checks
  if size!=std::mem::size_of::<i32>()as u32{return Err(io::Error::other("Peer pidfd result length unknown; original retained"))}
  Ok(())
 }
 /// Query SAME actual kernel process object. True is peer exit only, never
 /// agent/job/goal retirement. No signal/stop authority is exposed.
 pub(crate) fn exited_observed(&self)->io::Result<bool>{
  let state=self.state.lock().map_err(|_|io::Error::other("Original peer pidfd poisoned"))?;
  let State::Owned(fd)=*state else{return Err(io::Error::other("Original peer pidfd unavailable"))};
  let mut descriptor=PollFd{fd,events:1,revents:0};let result=unsafe{poll(&mut descriptor,1,0)};
  if result<0{return Err(io::Error::last_os_error())}if result==0{return Ok(false)}
  if descriptor.revents&(0x20|0x08)!=0{return Err(io::Error::other("Original peer pidfd poll failed"))}
  if descriptor.revents&(1|0x10)!=0{return Ok(true)}Err(io::Error::other("Unknown original peer pidfd event"))
 }
 pub(crate) fn close_once(&self)->io::Result<()>{
  let mut state=self.state.lock().map_err(|_|io::Error::other("Original peer pidfd poisoned"))?;
  let State::Owned(fd)=*state else{return Err(io::Error::other("Original pidfd close unavailable or spent"))};
  *state=State::CloseStarted(fd);
  if unsafe{close(fd)}!=0{*state=State::CloseFailed(fd);return Err(io::Error::last_os_error())}
  *state=State::Closed;Ok(())
 }
}
// Unsupported SO_PEERPIDFD/kernel/architecture is a protocol qualification gate,
// never permission to fall back to pidfd_open(SO_PEERCRED.pid). The actual UID,
// process birth/start and approved executable/source capture remain required.
