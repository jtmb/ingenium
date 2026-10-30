//! Concrete closure of the actual private reqwest owners. Locked0.12.28 final
//! InnerArc Drop closes its channel and synchronously joins its runtime thread.
//! Inner join result is discarded by reqwest: this proves ENDED, not success.
use super::*;
use std::{sync::Mutex,thread::{self,JoinHandle},time::Instant};
#[derive(PartialEq,Eq)]enum Phase{Ready,Pending,Joined,Failed}
struct CloseOriginal{owner:Mutex<Option<OriginalWebPromptRequest>>,observed:Arc<WebPromptObservation>}
enum WorkerResult{Ended,SharedOwner}
/// No public constructor/Clone/Deserialize; actual checked join mints it.
pub(crate) struct NativeWebTransportEnded{original:Arc<CloseOriginal>}
impl NativeWebTransportEnded{
 pub(crate) fn observation(&self)->&Arc<WebPromptObservation>{&self.original.observed}
}
pub(crate) struct RetainedWebTransportClose{
 original:Arc<CloseOriginal>,worker:Option<JoinHandle<Result<WorkerResult,&'static str>>>,phase:Phase,
}
impl RetainedWebTransportClose{
 pub(crate) fn retain(owner:OriginalWebPromptRequest)->Self{
  let observed=owner.observation.clone();
  Self{original:Arc::new(CloseOriginal{owner:Mutex::new(Some(owner)),observed}),worker:None,phase:Phase::Ready}
 }
 pub(crate) fn observation(&self)->&Arc<WebPromptObservation>{&self.original.observed}
 fn start(&mut self)->Result<(),String>{
  if self.phase!=Phase::Ready||self.worker.is_some(){return Err("Original transport close is not fresh".into());}
  // Actual owner is ALREADY in the slot-owned capsule before this spawn. A
  // spawn error only drops an Arc; never the actual Client/Response owners.
  self.phase=Phase::Pending;let original=self.original.clone();
  match thread::Builder::new().name("veyra-original-web-transport-close".into()).spawn(move||close_actual_owners(&original)){
   Ok(worker)=>{self.worker=Some(worker);Ok(())},
   Err(_)=>{self.phase=Phase::Failed;Err("Original transport closer spawn failed; owner retained".into())}
  }
 }
 pub(crate) fn finish_until(&mut self,deadline:Instant)->Result<Option<NativeWebTransportEnded>,String>{
  if self.phase==Phase::Failed{return Err("Original transport close failure is latched".into());}
  if self.phase==Phase::Joined{return Ok(None);}
  if self.phase==Phase::Ready{self.start()?;}
  let Some(worker)=self.worker.as_ref()else{self.phase=Phase::Failed;return Err("Original closer handle absent; not joined".into());};
  while !worker.is_finished(){
   if Instant::now()>=deadline{return Err("Original transport closer pending; actual handle retained".into());}
   thread::sleep(Duration::from_millis(5).min(deadline.saturating_duration_since(Instant::now())));
  }
  // Persistent failure precedes handle consumption. A later empty Option is
  // never a fabricated successful join. No original close is retried on panic.
  self.phase=Phase::Failed;
  let worker=self.worker.take().ok_or("Original closer handle lost")?;
  match worker.join(){
   Ok(Ok(WorkerResult::Ended))=>{self.phase=Phase::Joined;Ok(Some(NativeWebTransportEnded{original:self.original.clone()}))},
   Ok(Ok(WorkerResult::SharedOwner))=>{
    // Atomic Arc::try_unwrap proved another actual owner is active. No final
    // Client drop/close occurred; capsule still owns it. Wait for last consumer.
    self.phase=Phase::Ready;Err("Another actual original Client owner remains; no closure witness".into())
   },
   _=>Err("Actual original closer failed or panicked; failure remains latched".into()),
  }
 }
}
fn close_actual_owners(original:&CloseOriginal)->Result<WorkerResult,&'static str>{
 let owner=original.owner.lock().map_err(|_|"Original transport capsule poisoned")?.take().ok_or("Original transport owner absent")?;
 let OriginalWebPromptRequest{http,request,response,observation}=owner;
 // Response owns the only library KeepCoreThreadAlive clone after build.
 // Drop it BEFORE the final native Client owner. Request owns no Client.
 drop(response);drop(request);
 match Arc::try_unwrap(http){
  Ok(http)=>{
   // Runs on this dedicated std worker, never inside an async runtime. Exact
   // locked source synchronously joins the retained reqwest runtime thread.
   drop(http);Ok(WorkerResult::Ended)
  },
  Err(http)=>{
   *original.owner.lock().map_err(|_|"Original capsule restore poisoned")?=Some(OriginalWebPromptRequest{http,request:None,response:None,observation});
   Ok(WorkerResult::SharedOwner)
  }
 }
}

#[cfg(test)]mod tests{
 use super::*;
 use std::{io::{BufRead,BufReader,Write},net::TcpListener};
 fn actual_response()->(OriginalWebPromptRequest,JoinHandle<()>,Arc<std::sync::atomic::AtomicBool>){
  let listener=TcpListener::bind("127.0.0.1:0").unwrap();
  let client=OpenCodeClient::new(&format!("http://{}",listener.local_addr().unwrap()),None,Duration::from_secs(2)).unwrap();
  let eof=Arc::new(std::sync::atomic::AtomicBool::new(false));let peer=eof.clone();
  let server=thread::spawn(move||{
   let(mut stream,_)=listener.accept().unwrap();stream.set_read_timeout(Some(Duration::from_secs(4))).unwrap();
   let mut reader=BufReader::new(stream.try_clone().unwrap());let mut length=0;
   loop{let mut line=String::new();reader.read_line(&mut line).unwrap();if line=="\r\n"{break;}
    if let Some(v)=line.to_ascii_lowercase().strip_prefix("content-length:"){length=v.trim().parse::<usize>().unwrap();}}
   let mut body=vec![0;length];reader.read_exact(&mut body).unwrap();
   stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Length: 2\r\n\r\n{}").unwrap();stream.flush().unwrap();
   let mut byte=[0u8;1];match reader.read(&mut byte){Ok(0)=>peer.store(true,std::sync::atomic::Ordering::Release),Err(e)if matches!(e.kind(),std::io::ErrorKind::ConnectionReset|std::io::ErrorKind::ConnectionAborted)=>peer.store(true,std::sync::atomic::Ordering::Release),other=>panic!("actual transport did not close: {other:?}")}
  });
  let mut request=client.prepare_original_web_prompt("ses_fixture","/api/session/ses_fixture/prompt",&[],b"{}").unwrap();request.execute_retained();
  (request,server,eof)
 }
 #[test]fn actual_final_client_and_response_end_and_preserve_observation(){
  let(owner,peer,eof)=actual_response();let observed=owner.observation.clone();let mut close=RetainedWebTransportClose::retain(owner);
  let ended=close.finish_until(Instant::now()+Duration::from_secs(3)).unwrap().unwrap();
  assert!(Arc::ptr_eq(ended.observation(),&observed));assert_eq!(observed.body,b"{}");peer.join().unwrap();assert!(eof.load(std::sync::atomic::Ordering::Acquire));
  assert!(close.finish_until(Instant::now()+Duration::from_secs(1)).unwrap().is_none());
 }
 #[test]fn extra_actual_client_owner_cannot_mint_final_closure(){
  let(owner,peer,_)=actual_response();let extra=owner.http.clone();let mut close=RetainedWebTransportClose::retain(owner);
  assert!(close.finish_until(Instant::now()+Duration::from_secs(1)).is_err());assert!(close.phase==Phase::Ready);
  drop(extra);assert!(close.finish_until(Instant::now()+Duration::from_secs(3)).unwrap().is_some());peer.join().unwrap();
 }
 #[test]fn actual_outer_worker_panic_then_retry_keeps_failed_seal(){
  // A real panicking JoinHandle with an EMPTY no-OS-resource capsule tests the
  // persistent failure seal without creating a protected failed-close target.
  let observed=Arc::new(WebPromptObservation{status:None,content_type:None,body:Vec::new(),phase:WebTransportPhase::Prepared,failure:None});
  let mut close=RetainedWebTransportClose{original:Arc::new(CloseOriginal{owner:Mutex::new(None),observed}),phase:Phase::Pending,
   worker:Some(thread::spawn(||panic!("bounded actual closer fault fixture")))};
  assert!(close.finish_until(Instant::now()+Duration::from_secs(1)).is_err());
  assert!(close.finish_until(Instant::now()+Duration::from_secs(1)).is_err());assert!(close.phase==Phase::Failed);
  assert!(close.original.owner.lock().unwrap().is_none());
 }
}
