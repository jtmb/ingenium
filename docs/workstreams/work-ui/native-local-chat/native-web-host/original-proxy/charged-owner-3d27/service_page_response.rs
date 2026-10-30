//! Child of service web_original. Actual worker original retained before spawn.
use super::*;
use super::retained_page_worker::Worker;
use veyra_adapters::projects::{NativeWebAcknowledgementPage,NativeWebPageRead};
use std::sync::atomic::AtomicBool;
use axum::{body::{Body,Bytes},response::Response};
type PageResult=Result<Option<NativeWebAcknowledgementPage>,String>;
pub(super) struct PageWork{worker:Arc<Worker<PageResult>>,read:Arc<NativeWebPageRead>,abandoned:AtomicBool}
struct Demand(Arc<PageWork>);
impl Drop for Demand{fn drop(&mut self){self.0.abandoned.store(true,Ordering::Release);}}
pub(super) fn reconcile_abandoned(pending:&WebPending)->Result<(),String>{
 let mut jobs=pending.pages.lock().map_err(|_|"Original page registry poisoned")?;
 let mut failed=false;
 jobs.retain(|job|{
  if !job.abandoned.load(Ordering::Acquire){return true}
  match job.worker.reconcile(){
   Ok(true) if job.read.no_live_blob_after_join()=>{let _actual=job.worker.take_joined();false},
   Ok(false)=>true,_=>{failed=true;true},
  }
 });
 if failed{Err("Original page worker close/join failure retained".into())}else{Ok(())}
}
async fn page(state:Arc<ServiceState>,binding:Arc<LocalWorkspaceBinding>,lease:Arc<LocalWebLease>,operation:String,offset:usize,expected:Option<[u8;64]>)->Result<NativeWebAcknowledgementPage,String>{
 check(&state,&binding,&lease)?;
 reconcile_abandoned(&state.local_workspaces.web)?;
 let actual=state.live_agent.original_web_completions();
 let read=Arc::new(actual.reserve_history_page());
 let job=Arc::new(PageWork{worker:Worker::reserved(),read:read.clone(),abandoned:AtomicBool::new(false)});
 {
  let mut registry=state.local_workspaces.web.pages.lock().map_err(|_|"Original page registry poisoned")?;
  if registry.len()>=128{return Err("Original page worker capacity retained".into())}
  registry.push(job.clone()); // custody BEFORE spawn, even if caller disappears
 }
 let demand=Demand(job.clone());
 let worker_state=state.clone();
 let deadline=Instant::now()+Duration::from_secs(5);
 job.worker.start_once(move||{
  check(&worker_state,&binding,&lease)?;
  let mut writer=worker_state.projects.try_lock().map_err(|_|"Original page writer busy")?;
  let store=writer.as_mut().ok_or("Original page writer retired")?;
  let hash=expected.as_ref().map(|b|std::str::from_utf8(b).map_err(|_|"Invalid original hash")).transpose()?;
  store.read_native_web_acknowledgement_page(binding.owner(),lease.session_id(),&operation,&worker_state.instance_id,&read,offset,hash,deadline)
   .map_err(|_|"Original exact page read/close refused".into())
 }).map_err(|_|"Original page worker spawn failed and retained")?;
 loop{
  match job.worker.reconcile(){
   Ok(true)=>break,Ok(false)=>{},Err(_)=>return Err("Actual page worker join failed and retained".into()),
  }
  if Instant::now()>=deadline{return Err("Actual page worker remains retained".into())}
  tokio::time::sleep(Duration::from_millis(5)).await;
 }
 if !job.read.no_live_blob_after_join(){return Err("Actual BLOB close remains unknown or failed".into())}
 let result=job.worker.take_joined().map_err(|_|"Actual page result unavailable")?;
 {
  let mut registry=state.local_workspaces.web.pages.lock().map_err(|_|"Original page registry poisoned")?;
  registry.retain(|old|!Arc::ptr_eq(old,&job)); // real joined/closed owner only
 }
 drop(demand);result?.ok_or_else(||"Original exact response unavailable or forgotten".into())
}
fn handoff(state:&ServiceState,binding:&LocalWorkspaceBinding,lease:&LocalWebLease,operation:&str,page:&NativeWebAcknowledgementPage)->Result<Bytes,String>{
 check(state,binding,lease)?;
 let writer=state.projects.try_lock().map_err(|_|"Original handoff writer busy")?;
 let store=writer.as_ref().ok_or("Original handoff writer retired")?;
 if lease.revoked(){return Err("Original Web lease revoked".into())}
 let payload=store.handoff_native_web_acknowledgement_page(binding.owner(),lease.session_id(),operation,&state.instance_id,page).map_err(|_|"Original response handoff revoked")?;
 // Ownership transfers inside SAME writer lock as the fresh forget check.
 // bytes1.12.1 from_owner keeps Payload until LAST real Bytes clone drops.
 Ok(Bytes::from_owner(payload))
}
struct Cursor{state:Arc<ServiceState>,binding:Arc<LocalWorkspaceBinding>,lease:Arc<LocalWebLease>,operation:String,offset:usize,total:usize,hash:[u8;64],first:Option<Bytes>,failed:bool}
pub(super) async fn response_for_operation(state:Arc<ServiceState>,binding:Arc<LocalWorkspaceBinding>,lease:Arc<LocalWebLease>,operation:String)->Result<Response,String>{
 let first=page(state.clone(),binding.clone(),lease.clone(),operation.clone(),0,None).await?;
 let total=first.total();let status=first.status();
 let mut hash=[0;64];hash.copy_from_slice(first.body_sha256().as_bytes());
 let header=first.content_type().map(axum::http::HeaderValue::from_str).transpose().map_err(|_|"Invalid original content type")?;
 let bytes=handoff(&state,&binding,&lease,&operation,&first)?;
 let offset=bytes.len();drop(first);
 let cursor=Cursor{state,binding,lease,operation,offset,total,hash,first:Some(bytes),failed:false};
 let stream=futures_util::stream::unfold(cursor,|mut c|async move{
  if c.failed{return None}
  if let Some(first)=c.first.take(){return Some((Ok::<_,std::io::Error>(first),c))}
  if c.offset==c.total{return None} // historical byte EOF, NEVER physical proof
  let result:Result<Bytes,String>=async{
   let next=page(c.state.clone(),c.binding.clone(),c.lease.clone(),c.operation.clone(),c.offset,Some(c.hash)).await?;
   if next.offset()!=c.offset||next.total()!=c.total{return Err("Original response representation changed".into())}
   let bytes=handoff(&c.state,&c.binding,&c.lease,&c.operation,&next)?;
   if bytes.is_empty(){return Err("Original response did not advance".into())}
   c.offset=c.offset.checked_add(bytes.len()).filter(|n|*n<=c.total).ok_or("Original response length conflict")?;Ok(bytes)
  }.await;
  match result{Ok(bytes)=>Some((Ok(bytes),c)),Err(error)=>{c.failed=true;Some((Err(std::io::Error::other(error)),c))}}
 });
 let mut response=Response::new(Body::from_stream(stream));
 *response.status_mut()=axum::http::StatusCode::from_u16(status).map_err(|_|"Invalid original status")?;
 if let Some(value)=header{response.headers_mut().insert(axum::http::header::CONTENT_TYPE,value);}
 response.headers_mut().insert(axum::http::header::CONTENT_LENGTH,axum::http::HeaderValue::from_str(&total.to_string()).map_err(|_|"Invalid original length")?);
 Ok(response)
}
