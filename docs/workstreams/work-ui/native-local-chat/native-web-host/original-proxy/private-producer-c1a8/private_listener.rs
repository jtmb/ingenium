//! Proposed child of service server::original; no separate DB/service owner.
//! Parent startup/broker registry must retain this Arc BEFORE start_once.
use super::{connections,listener_resource::Listener,listener_startup::ListenerStartup};
use crate::routes::{LocalWebPrivateMount,retained_result::ResultJoin,worker_original::WorkerPhase};
use std::{io,net::{Ipv4Addr,SocketAddrV4},sync::{Arc,OnceLock,atomic::{AtomicBool,Ordering}},time::{Duration,Instant}};
use tokio::{net::TcpStream,sync::{Mutex,watch}};
enum Failure{Serve}
pub(super) struct PrivateListener{
 startup:Arc<ListenerStartup<Listener,io::Error>>,actual:Arc<OnceLock<Arc<Listener>>>,
 task:Mutex<Option<ResultJoin<Failure>>>,book:Arc<connections::Book<TcpStream>>,
 mount:LocalWebPrivateMount,stop:watch::Sender<bool>,first_stop:OnceLock<Instant>,
 started:AtomicBool,
}
impl PrivateListener{
 pub(super) fn fence(&self){self.mount.fence();let _=self.stop.send(true);let _=self.book.close();}
 pub(super) fn prepare(deadline:Instant,mount:LocalWebPrivateMount)->Arc<Self>{
  // Future retained unpolled before native bind can run. All startup aliases
  // share the same actual Listener cell and its checked retirement original.
  let actual=Arc::new(OnceLock::new());let sink=actual.clone();
  let bind=async move{
   let raw=tokio::net::TcpListener::bind(SocketAddrV4::new(Ipv4Addr::LOCALHOST,0)).await.map_err(Arc::new)?;
   let original=Listener::new(raw);
   let _=sink.set(original.clone()); // actual source retained BEFORE publication
   Ok(original) // startup also retains this same original on late completion
  };
  let(stop,_)=watch::channel(false);
  Arc::new(Self{startup:ListenerStartup::prepare(deadline,bind),actual,task:Mutex::new(None),book:connections::Book::new(),mount,stop,first_stop:OnceLock::new(),started:AtomicBool::new(false)})
 }
 pub(super) async fn start_once(self:&Arc<Self>)->Result<std::net::SocketAddr,()>{
  if self.started.swap(true,Ordering::AcqRel){return Err(())}
  let actual=self.startup.wait_once(Instant::now).await.map_err(|_|())?;
  // Even an unexpected duplicate cannot lose the original: startup retains
  // its same actual Arc/outcome. No bind retry or replacement on failure.
  if !self.actual.get().is_some_and(|saved|Arc::ptr_eq(saved,&actual)){return Err(())}
  let address=actual.local_addr().map_err(|_|())?;
  if !address.ip().is_loopback(){return Err(())}
  self.mount.bind_original_endpoint(address)?; // actual retained bind, no DTO port
  let mut task=self.task.try_lock().map_err(|_|())?;
  if task.is_some(){return Err(())}
  let book=self.book.clone();let router=self.mount.router_clone();let shutdown=self.stop.subscribe();let original=self.clone();
  let work=async move{
   connections::serve(book,move||{let actual=actual.clone();async move{actual.accept().await.map(|(io,_)|io)}},router,shutdown,move||original.first_stop.get().copied()).await.map_err(|_|Failure::Serve)
  };
  let(worker,publish)=ResultJoin::prepare(work).map_err(|_|())?;
  *task=Some(worker); // actual handle retained BEFORE publication
  task.as_mut().ok_or(())?.publish(publish).map_err(|_|())?;
  Ok(address) // listener address ONLY, not whole-Web closure/readiness authority
 }
 pub(super) async fn retire_until(&self,proposed:Instant)->Result<(),()>{
  self.fence();let deadline=(*self.first_stop.get_or_init(||proposed)).min(proposed);
  self.book.close().map_err(|_|())?;
  // A pending bind with no actual Listener remains retained/unknown. No boolean
  // or absent output mints native close; startup driver must reconcile it.
  let actual=self.actual.get().ok_or(())?;
  actual.retire_until(deadline).await?;
  loop{
   if Instant::now()>=deadline{return Err(())}
   let phase={let mut task=self.task.try_lock().map_err(|_|())?;task.as_mut().ok_or(())?.poll()};
   match phase{WorkerPhase::Joined=>break,WorkerPhase::Failed=>return Err(()),WorkerPhase::Running=>tokio::time::sleep(Duration::from_millis(5)).await}
  }
  self.book.finish_until(deadline).await.map_err(|_|())
  // This retires only this actual listener/HTTP scope. Native control peer,
  // Desktop callback/child and engine originals require their OWN witnesses.
 }
}
