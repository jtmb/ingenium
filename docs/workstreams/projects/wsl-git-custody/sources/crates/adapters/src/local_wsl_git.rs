//! Retained Windows transport for the actual selected-user Linux Git subreaper.
//! Bridge/job exit cannot prove Linux descendant absence. No PID adoption.
use super::LocalWorkspaceBinding;
use crate::{local_git_launch::LocalGitLaunch,owned_process_job::OwnedProcessJob};
use veyra_contracts::local_workspaces::{LocalEnvironment,LocalOperation};
use serde_json::{Value,json};
use std::{collections::HashSet,io::{Read,Write,BufRead,BufReader},process::{Child,Command,Stdio},
 sync::{Arc,Mutex,mpsc::{self,Receiver,SyncSender}},thread::JoinHandle,time::{Instant,Duration}};
const SCRIPT:&str=concat!(include_str!("local_custody/wsl-helper.py"),"\n",include_str!("local_custody/wsl-git-tree.py"));
const WIRE:usize=1024*1024+4096;
struct Original{
 request:String,nonce:String,binding:Arc<LocalWorkspaceBinding>,child:Child,job:OwnedProcessJob,
 sender:Option<SyncSender<Vec<u8>>>,writer:Option<JoinHandle<Result<(),String>>>,
 reader:Option<JoinHandle<Result<(),String>>>,stderr:Option<JoinHandle<Result<Vec<u8>,String>>>,
 messages:Receiver<Result<Value,String>>,initial_sent:bool,prepared:bool,dispatch_sent:bool,cancel_sent:bool,
 final_result:Option<Value>,protocol_failed:bool,
}
/// Created only after consuming the actual complete original resource graph.
/// Metadata getters cannot construct or deserialize this custody witness.
pub struct LocalWslGitClosed{request:String,owner:veyra_contracts::local_workspaces::LocalWorkspaceOwner,result:Value}
impl LocalWslGitClosed{
 pub fn request(&self)->&str{&self.request}
 pub fn owner(&self)->&veyra_contracts::local_workspaces::LocalWorkspaceOwner{&self.owner}
 pub fn result(&self)->&Value{&self.result}
}
#[derive(Default)]
pub struct LocalWslGit{originals:Mutex<Vec<Original>>,launches:Mutex<Vec<Arc<LocalGitLaunch>>>,consumed:Mutex<HashSet<String>>,closed:Mutex<Vec<LocalWslGitClosed>>}
fn encoded(value:&Value)->Result<Vec<u8>,String>{
 let mut bytes=serde_json::to_vec(value).map_err(|_|"Git owner encoding")?;
 if bytes.len()>65535{return Err("Git owner input capacity".into());}bytes.push(b'\n');Ok(bytes)
}
fn program()->Result<std::path::PathBuf,String>{
 use std::os::windows::ffi::OsStringExt;
 let mut text=vec![0u16;32768];let count=unsafe{windows_sys::Win32::System::SystemInformation::GetSystemDirectoryW(text.as_mut_ptr(),text.len() as u32)} as usize;
 if count==0||count>=text.len(){return Err("original system WSL executable unavailable".into());}
 Ok(std::path::PathBuf::from(std::ffi::OsString::from_wide(&text[..count])).join("wsl.exe"))
}
fn control(original:&Original,command:&str)->Result<Vec<u8>,String>{encoded(&json!({"nonce":original.nonce,"request_id":original.request,"command":command}))}
fn cancel(original:&mut Original)->Result<(),String>{
 original.binding.verify_account()?;
 if !original.cancel_sent&&original.final_result.is_none(){
  original.cancel_sent=true;
  if original.initial_sent{if let Some(sender)=&original.sender{let _=sender.try_send(control(original,"cancel")?);}}
  // EOF is also cancellation, never permission for a second dispatch.
  original.sender=None;
 }
 Ok(())
}
fn observe(original:&mut Original)->Result<(),String>{
 while let Ok(message)=original.messages.try_recv(){
  let message=match message{Ok(value)=>value,Err(_)=>{original.protocol_failed=true;return Err("Git owner protocol read failed; retain original transport".into());}};
  if message["nonce"]!=original.nonce||message["request_id"]!=original.request{original.protocol_failed=true;return Err("Git owner original mismatch".into());}
  match message["stage"].as_str(){
   Some("prepared") if !original.prepared&&original.final_result.is_none()=>{
    let expected:Value=serde_json::from_str(&original.binding.physical).map_err(|_|"original WSL physical custody")?;
    if message["root_identity"]!=expected||message["mechanism"]!="subreaper_pidfd"||message["gate_closed"]!=true{original.protocol_failed=true;return Err("actual Linux prepared custody unavailable".into());}
    original.prepared=true;
   },
   Some("settled") if original.final_result.is_none()=>{
    let result=&message["result"];
    if result["nonce"]!=original.nonce||result["request_id"]!=original.request||result["tree_empty"]!=true||result["pipe_eof"]!=true
     ||!result["dispatched"].is_boolean()||!result["outcome_unknown"].is_boolean()
     ||(result["dispatched"]==true&&(!original.prepared||!original.dispatch_sent)){
      original.protocol_failed=true;return Err("actual original Linux tree retirement is unproven".into());
    }
    original.final_result=Some(result.clone());original.sender=None;
   },_=>{original.protocol_failed=true;return Err("unexpected original Git owner transition".into());},
  }
 }
 Ok(())
}
fn physically_closed(original:&mut Original)->Result<bool,String>{
 if original.protocol_failed||original.final_result.is_none(){return Ok(false);}
 Ok(original.child.try_wait().map_err(|_|"original Windows bridge exit unavailable")?.is_some_and(|status|status.success())
  &&original.job.is_empty()?
  &&original.writer.as_ref().is_some_and(JoinHandle::is_finished)
  &&original.reader.as_ref().is_some_and(JoinHandle::is_finished)
  &&original.stderr.as_ref().is_some_and(JoinHandle::is_finished))
}
fn retire(mut original:Original)->Result<LocalWslGitClosed,String>{
 let write=original.writer.take().ok_or("original input worker missing")?.join();
 let read=original.reader.take().ok_or("original protocol reader missing")?.join();
 let diagnostic=original.stderr.take().ok_or("original diagnostic reader missing")?.join();
 let io_complete=matches!(write,Ok(Ok(())))&&matches!(read,Ok(Ok(())))
  &&matches!(&diagnostic,Ok(Ok(bytes)) if bytes.len()<=65536);
 let mut result=original.final_result.take().ok_or("original Linux settlement missing")?;
 if let Some(value)=result.as_object_mut(){
  value.remove("nonce");value.insert("original_transport_closed".into(),json!(io_complete));
  if !io_complete{value.insert("outcome_unknown".into(),json!(true));value.insert("transport_failure".into(),json!("original_IO_completion_unverified"));}
 }
 Ok(LocalWslGitClosed{request:original.request,owner:original.binding.owner().clone(),result})
}

impl LocalWslGit{
 pub fn run(&self,binding:Arc<LocalWorkspaceBinding>,request:&str,operation:&LocalOperation,current:&dyn Fn()->Result<(),String>)->Result<LocalWslGitClosed,String>{
  let id=uuid::Uuid::parse_str(request).map_err(|_|"invalid original Git UUID")?;
  if id.is_nil()||id.to_string()!=request{return Err("invalid original Git UUID".into());}
  binding.verify()?;current()?;
  let LocalEnvironment::Wsl{distro,user}=&binding.owner().environment else{return Err("not the original WSL environment".into());};
  let effect=match operation{
   LocalOperation::GitStatus=>json!({"operation":"status"}),LocalOperation::GitDiff=>json!({"operation":"diff"}),
   LocalOperation::GitBranch{name}=>json!({"operation":"branch","branch":name}),
   LocalOperation::WorktreeCreate{name,branch}=>json!({"operation":"worktree","name":name,"branch":branch}),
   _=>return Err("unsupported typed WSL Git operation".into()),
  };
  let nonce=uuid::Uuid::new_v4().simple().to_string();
  let mut input=effect;let data=input.as_object_mut().ok_or("typed Git input")?;
  data.insert("action".into(),json!("git_tree"));data.insert("request_id".into(),json!(request));data.insert("nonce".into(),json!(nonce));
  data.insert("installation_id".into(),json!(binding.owner().installation_id));data.insert("workspace_id".into(),json!(binding.owner().workspace_id));
  data.insert("expected".into(),serde_json::from_str(&binding.physical).map_err(|_|"original WSL custody unavailable")?);
  let initial=encoded(&input)?;
  let mut command=Command::new(program()?);
  command.args(["--distribution",distro,"--user",user,"--exec","/usr/bin/python3","-c",SCRIPT,"--local-git-tree",&nonce,request])
   .stdin(Stdio::piped()).stdout(Stdio::piped()).stderr(Stdio::piped());
  crate::opencode::wsl_engine_owner::remove_inherited_credentials(&mut command);
  let mut retained=self.originals.lock().map_err(|_|"original WSL Git inventory busy")?;
  let mut launches=self.launches.lock().map_err(|_|"original WSL launch inventory busy")?;
  if !retained.is_empty()||!launches.is_empty(){return Err("prior WSL Git original remains unresolved".into());}
  {let mut consumed=self.consumed.lock().map_err(|_|"original WSL request inventory busy")?;
   if consumed.len()>=4096||!consumed.insert(request.into()){return Err("WSL Git original consumed or capacity reached".into());}}
  let launch=LocalGitLaunch::prepare(binding.clone());launches.push(launch.clone());
  let (child,job)=launch.spawn_once(&mut command,current)?;launches.clear();
  let (tx,rx)=mpsc::sync_channel::<Vec<u8>>(2);let (message_tx,messages)=mpsc::sync_channel(4);
  retained.push(Original{request:request.into(),nonce,binding,child,job,sender:Some(tx),writer:None,reader:None,stderr:None,messages,
   initial_sent:false,prepared:false,dispatch_sent:false,cancel_sent:false,final_result:None,protocol_failed:false});
  let original=retained.first_mut().ok_or("WSL Git original missing")?;
  let mut stdin=original.child.stdin.take().ok_or("original WSL input missing")?;
  original.writer=Some(std::thread::Builder::new().name("local-git-owner-input".into()).spawn(move||{
   while let Ok(bytes)=rx.recv(){stdin.write_all(&bytes).map_err(|_|"original WSL input failed")?;stdin.flush().map_err(|_|"original WSL input flush failed")?;}Ok(())
  }).map_err(|_|"original WSL input worker unavailable")?);
  let stdout=original.child.stdout.take().ok_or("original WSL protocol pipe missing")?;
  original.reader=Some(std::thread::Builder::new().name("local-git-owner-protocol".into()).spawn(move||{
   let mut reader=BufReader::new(stdout);let mut total=0usize;let mut lines=0;
   loop{
    let mut line=Vec::new();let count=Read::by_ref(&mut reader).take((WIRE.saturating_sub(total)+1) as u64).read_until(b'\n',&mut line).map_err(|_|"original WSL protocol I/O failed")?;
    if count==0{return Ok(());}total=total.saturating_add(count);lines+=1;
    if total>WIRE||lines>2||!line.ends_with(b"\n"){let _=message_tx.send(Err("original WSL protocol capacity".into()));return Err("original WSL protocol capacity".into());}
    let value=serde_json::from_slice::<Value>(&line).map_err(|_|"original WSL protocol malformed")?;
    message_tx.send(Ok(value)).map_err(|_|"original WSL protocol consumer missing")?;
   }
  }).map_err(|_|"original WSL protocol reader unavailable")?);
  let stderr=original.child.stderr.take().ok_or("original WSL diagnostics missing")?;
  original.stderr=Some(std::thread::Builder::new().name("local-git-owner-errors".into()).spawn(move||{
   let mut bytes=Vec::new();stderr.take(65537).read_to_end(&mut bytes).map_err(|_|"original WSL diagnostic read failed")?;Ok(bytes)
  }).map_err(|_|"original WSL diagnostic reader unavailable")?);
  if current().is_err(){let _=cancel(original);return Err("original registry refused before helper input".into());}
  original.initial_sent=true;
  original.sender.as_ref().ok_or("original WSL input retired")?.try_send(initial).map_err(|_|"original WSL input not admitted")?;
  let deadline=Instant::now()+Duration::from_secs(12);
  loop{
   let original=retained.first_mut().ok_or("original WSL Git lost")?;
   if let Err(error)=observe(original){let _=cancel(original);return Err(error);}
   if original.prepared&&!original.dispatch_sent&&!original.cancel_sent&&original.final_result.is_none(){
    if current().is_err(){let _=cancel(original);return Err("original registry refused at actual Linux dispatch gate".into());}
    original.dispatch_sent=true;
    let message=control(original,"dispatch")?;
    if original.sender.as_ref().ok_or("original WSL gate unavailable")?.try_send(message).is_err(){let _=cancel(original);return Err("original WSL dispatch outcome unknown".into());}
   }
   if physically_closed(original)?{
    let original=retained.remove(0);let result=retire(original)?;
    // Persist the actual closed witness even if later read admission changed.
    // Outcome unknown remains unknown; it is not an operation-success token.
    return Ok(result);
   }
   if Instant::now()>=deadline{let _=cancel(original);return Err("original WSL Git remains retained; no replay or inferred Linux exit".into());}
   std::thread::sleep(Duration::from_millis(5));
  }
 }
 pub fn retain_closed(&self,closed:LocalWslGitClosed)->Result<(),String>{
  // In-flight originals and immutable DB fences already bound capacity. Never
  // evict a positive witness to admit another operation.
  self.closed.lock().unwrap_or_else(|poison|poison.into_inner()).push(closed);Ok(())
 }
 pub fn poll_closed(&self,request:&str)->Result<Option<LocalWslGitClosed>,String>{
  {let mut closed=self.closed.try_lock().map_err(|_|"closed WSL witnesses busy")?;
   if let Some(index)=closed.iter().position(|value|value.request()==request){return Ok(Some(closed.remove(index)));}}
  let mut retained=self.originals.try_lock().map_err(|_|"original WSL Git observation busy")?;
  let Some(index)=retained.iter().position(|value|value.request==request)else{return Ok(None);};
  let original=&mut retained[index];original.binding.verify_account()?;observe(original)?;
  if !physically_closed(original)?{return Ok(None);}
  let original=retained.remove(index);retire(original).map(Some)
 }
 pub fn persist_closed(&self,persist:&mut dyn FnMut(&LocalWslGitClosed)->Result<(),String>)->Result<(),String>{
  let mut closed=self.closed.try_lock().map_err(|_|"closed WSL witnesses busy")?;
  while let Some(original)=closed.first(){persist(original)?;closed.remove(0);}Ok(())
 }
 pub fn has_closed(&self)->Result<bool,String>{Ok(!self.closed.try_lock().map_err(|_|"closed WSL witnesses busy")?.is_empty())}
 pub fn finish_until(&self,deadline:Instant)->Result<(),String>{
  let mut retained=self.originals.lock().map_err(|_|"original WSL Git inventory busy")?;
  let mut launches=self.launches.lock().map_err(|_|"original WSL launch inventory busy")?;
  for launch in launches.iter(){launch.finish_until(deadline)?;}launches.clear();
  while let Some(original)=retained.first_mut(){
   original.binding.verify_account()?;let _=observe(original);cancel(original)?;
   if physically_closed(original)?{let original=retained.remove(0);let closed=retire(original)?;self.retain_closed(closed)?;continue;}
   if Instant::now()>=deadline{return Err("original Linux helper/descendant/pipe retirement remains unproven; exact transport retained".into());}
   std::thread::sleep(Duration::from_millis(5));
  }Ok(())
 }
}
