//! Real ConPTY ownership with no Project/TerminalOwner conversion.
use super::*;
use crate::local_execution::LocalWorkspaceBinding;
use serde_json::{Value,json};
use veyra_contracts::local_workspaces::LocalEnvironment;
struct PrivateTerminal {
 binding:Arc<LocalWorkspaceBinding>,output:Arc<Mutex<OutputRing>>,native:NativeTerminal,
 shell:String,closed:bool,close_request:Option<String>,
}
#[derive(Default)]
pub struct LocalTerminals { originals:Mutex<HashMap<String,PrivateTerminal>>,pending:Mutex<Vec<PendingLaunch>> }
impl LocalTerminals {
 pub fn open(&self,binding:Arc<LocalWorkspaceBinding>,request:&str,shell:&str,columns:u16,rows:u16)->Result<Value,TerminalError>{
  validate_request_id(request)?;validate_size(columns,rows)?;binding.verify().map_err(|_|TerminalError::OwnerMismatch)?;
  let (program,args,cwd)=match &binding.owner().environment {
   LocalEnvironment::Windows=>{
    let program=shells::windows_program(shell)?;
    let args=match shell{"powershell"=>vec!["-NoLogo".into(),"-NoProfile".into(),"-NoExit".into()],"cmd"=>vec!["/D".into(),"/Q".into()],_=>return Err(TerminalError::Invalid)};
    (program,args,Some(PathBuf::from(binding.directory())))
   },
   LocalEnvironment::Wsl{..}=>(shells::windows_program("wsl")?,binding.wsl_terminal_args(shell).map_err(|_|TerminalError::OwnerMismatch)?,None),
  };
  let mut entries=self.originals.lock().map_err(|_|TerminalError::Unavailable)?;
  let mut pending=self.pending.lock().map_err(|_|TerminalError::Unavailable)?;
  if !pending.is_empty()||entries.len()>=MAX_RETAINED_TERMINALS||entries.values().filter(|v|!v.closed).count()>=MAX_TERMINALS{return Err(TerminalError::NotAdmitted);}
  if entries.contains_key(request){return Err(TerminalError::NotAdmitted);}
  let output=Arc::new(Mutex::new(OutputRing{chunks:VecDeque::new(),bytes:0,sequence:0,truncated_through:None}));
  binding.verify().map_err(|_|TerminalError::OwnerMismatch)?;
  let native=match NativeTerminal::spawn(&program,&args,cwd.as_deref(),columns,rows,output.clone()){
   Ok(v)=>v,Err(failure)=>{if let Some(original)=failure.pending{pending.push(original);}return Err(failure.error);}
  };
  entries.insert(request.into(),PrivateTerminal{binding,output,native,shell:shell.into(),closed:false,close_request:None});
  read(request,entries.get(request).ok_or(TerminalError::Unavailable)?,0)
 }
 pub fn poll(&self,binding:&LocalWorkspaceBinding,id:&str,after:u64)->Result<Value,TerminalError>{
  let entries=self.originals.lock().map_err(|_|TerminalError::Unavailable)?;
  let terminal=entries.get(id).ok_or(TerminalError::NotFound)?;same(terminal,binding)?;read(id,terminal,after)
 }
 pub fn input(&self,binding:&LocalWorkspaceBinding,id:&str,text:&str)->Result<Value,TerminalError>{
  if text.is_empty()||text.len()>MAX_INPUT{return Err(TerminalError::TooLarge);}
  let mut entries=self.originals.lock().map_err(|_|TerminalError::Unavailable)?;
  let terminal=entries.get_mut(id).ok_or(TerminalError::NotFound)?;same(terminal,binding)?;
  binding.verify().map_err(|_|TerminalError::OwnerMismatch)?;
  if terminal.closed{return Err(TerminalError::NotAdmitted);}terminal.native.write(text.as_bytes())?;
  Ok(json!({"terminal_id":id,"input_state":"queued"}))
 }
 pub fn resize(&self,binding:&LocalWorkspaceBinding,id:&str,columns:u16,rows:u16)->Result<Value,TerminalError>{
  validate_size(columns,rows)?;
  let mut entries=self.originals.lock().map_err(|_|TerminalError::Unavailable)?;
  let terminal=entries.get_mut(id).ok_or(TerminalError::NotFound)?;same(terminal,binding)?;
  binding.verify().map_err(|_|TerminalError::OwnerMismatch)?;
  if terminal.closed{return Err(TerminalError::NotAdmitted);}terminal.native.resize(columns,rows)?;
  Ok(json!({"terminal_id":id,"columns":columns,"rows":rows}))
 }
 pub fn check_close_request(&self,owner:&veyra_contracts::local_workspaces::LocalWorkspaceOwner,id:&str,request:&str)->Result<(),TerminalError>{
  let entries=self.originals.lock().map_err(|_|TerminalError::Unavailable)?;
  let terminal=entries.get(id).ok_or(TerminalError::NotFound)?;
  terminal.binding.verify_account().map_err(|_|TerminalError::OwnerMismatch)?;
  if terminal.binding.owner()!=owner||terminal.close_request.as_deref().is_some_and(|original|original!=request){return Err(TerminalError::OwnerMismatch);}
  Ok(())
 }
 /// Cleanup matches retained immutable owner, even when new admission is closed.
 pub fn close(&self,owner:&veyra_contracts::local_workspaces::LocalWorkspaceOwner,id:&str,request:&str,deadline:Instant)->Result<Value,TerminalError>{
  let mut entries=self.originals.lock().map_err(|_|TerminalError::Unavailable)?;
  let terminal=entries.get_mut(id).ok_or(TerminalError::NotFound)?;
  terminal.binding.verify_account().map_err(|_|TerminalError::OwnerMismatch)?;
  validate_request_id(request)?;
  if terminal.binding.owner()!=owner{return Err(TerminalError::OwnerMismatch);}
  if terminal.close_request.as_deref().is_some_and(|original|original!=request){return Err(TerminalError::NotAdmitted);}
  terminal.close_request=Some(request.into());
  if !terminal.closed{terminal.native.close_until(deadline)?;terminal.closed=true;}
  Ok(json!({"terminal_id":id,"closed":true,"output_complete":terminal.native.output_complete()}))
 }
 pub fn finish_until(&self,deadline:Instant)->Result<(),TerminalError>{
  let mut entries=self.originals.lock().map_err(|_|TerminalError::Unavailable)?;
  for terminal in entries.values_mut(){if !terminal.closed{terminal.native.close_until(deadline)?;terminal.closed=true;}}
  let mut pending=self.pending.lock().map_err(|_|TerminalError::Unavailable)?;
  pending.retain_mut(|original|!original.finish_until(deadline));
  if !pending.is_empty(){return Err(TerminalError::Unavailable);}
  entries.clear();
  Ok(())
 }
}
fn same(terminal:&PrivateTerminal,binding:&LocalWorkspaceBinding)->Result<(),TerminalError>{
 if terminal.binding.owner()!=binding.owner(){return Err(TerminalError::OwnerMismatch);}binding.verify().map_err(|_|TerminalError::OwnerMismatch)
}
fn read(id:&str,terminal:&PrivateTerminal,after:u64)->Result<Value,TerminalError>{
 let (output,base64,sequence,truncated)=terminal.output.lock().map_err(|_|TerminalError::Unavailable)?.read_after(after);
 Ok(json!({"id":id,"owner":terminal.binding.owner(),"shell":terminal.shell,"output":output,"output_base64":base64,"sequence":sequence,
  "truncated":truncated,"running":terminal.native.running()?,"closed":terminal.closed,"output_complete":terminal.native.output_complete()}))
}
