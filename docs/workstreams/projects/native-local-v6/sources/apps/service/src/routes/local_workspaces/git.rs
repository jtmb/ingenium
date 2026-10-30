//! Native service-owned bounded Git children. No raw shell command or Project.
use super::*;
use std::{io::Read,process::{Child,Command,Stdio},thread::JoinHandle,time::{Instant,Duration}};
use veyra_adapters::{local_execution::LocalWorkspaceBinding,local_git_launch::LocalGitLaunch,owned_process_job::OwnedProcessJob};
use veyra_contracts::local_workspaces::{LocalEnvironment,LocalOperation};
struct Original{child:Child,job:OwnedProcessJob,out:Option<JoinHandle<Vec<u8>>>,err:Option<JoinHandle<Vec<u8>>>,binding:Arc<LocalWorkspaceBinding>}
#[derive(Default)]
pub(super) struct GitWorkers{retained:Mutex<Vec<Original>>,launches:Mutex<Vec<Arc<LocalGitLaunch>>>}
fn branch(value:&str)->bool{!value.is_empty()&&value.len()<=128&&!value.starts_with('-')&&!value.contains("..")&&!value.contains("@{")&&!value.chars().any(|v|v.is_whitespace()||v.is_control()||"~^:?*[\\\"".contains(v))}
fn read(mut input:impl Read)->Vec<u8>{let mut out=Vec::new();let _=input.by_ref().take(1024*1024+1).read_to_end(&mut out);out}
impl GitWorkers {
 pub(super) fn run(&self,binding:Arc<LocalWorkspaceBinding>,operation:&LocalOperation,current:&dyn Fn()->Result<(),String>)->Result<Value,String>{
  binding.verify()?;current()?;
  // Original run_wsl owns its Windows bridge, not arbitrary Linux Git
  // descendants. Do not enable this effect before that actual owner qualifies.
  if matches!(binding.owner().environment,LocalEnvironment::Wsl{..}){
   return Err("WSL Git requires qualified separately typed Linux helper-tree custody".into());
  }
  let (args,wsl):(Vec<String>,Value)=match operation {
   LocalOperation::GitStatus=>(vec!["status".into(),"--porcelain=v1".into(),"-z".into()],json!({"action":"git","operation":"status"})),
   LocalOperation::GitDiff=>(vec!["diff".into(),"--no-ext-diff".into(),"--no-textconv".into()],json!({"action":"git","operation":"diff"})),
   LocalOperation::GitBranch{name} if branch(name)=>(vec!["switch".into(),"-c".into(),name.clone()],json!({"action":"git","operation":"branch","branch":name})),
   LocalOperation::WorktreeCreate{name,branch:selected} if branch(selected)&&canonical(name)=>{
    let target=std::path::Path::new(binding.directory()).join(name);
    if target.exists(){return Err("worktree target exists; not adopted".into());}
    (vec!["worktree".into(),"add".into(),"-b".into(),selected.clone(),target.to_str().ok_or("worktree path")?.into()],
      json!({"action":"git","operation":"worktree","name":name,"branch":selected}))
   },
   _=>return Err("unsupported Git operation".into()),
  };
  if matches!(binding.owner().environment,LocalEnvironment::Wsl{..}){return binding.wsl_request(wsl);}
  let root=std::path::Path::new(binding.directory());
  let program=super::super::workbench::review_git_executable(root).map_err(|_|"existing Git executable unavailable")?;
  let mut command=Command::new(program);
  for (key,_) in std::env::vars_os(){let upper=key.to_string_lossy().to_ascii_uppercase();if upper.starts_with("GIT_")||upper.starts_with("GCM_"){command.env_remove(key);}}
  command.args(["--no-pager","-c","core.fsmonitor=false","-c","core.hooksPath=/dev/null"]).args(args)
   .current_dir(root).env("GIT_TERMINAL_PROMPT","0").env("GCM_INTERACTIVE","never")
   .stdin(Stdio::null()).stdout(Stdio::piped()).stderr(Stdio::piped());
  let mut retained=self.retained.lock().map_err(|_|"Git originals unavailable")?;
  if !retained.is_empty(){return Err("original Git work remains unresolved".into());}
  binding.verify()?;current()?;
  let mut launches=self.launches.lock().map_err(|_|"private Git launch originals unavailable")?;
  if !launches.is_empty(){return Err("original partial Git launch remains retained".into());}
  let launch=LocalGitLaunch::prepare(binding.clone());
  launches.push(launch.clone()); // before the actual suspended spawn
  let (child,job)=launch.spawn_once(&mut command,current)?;
  launches.clear(); // successful spawn returned its actual child and job
  retained.push(Original{child,job,out:None,err:None,binding});
  let original=retained.first_mut().ok_or("Git original lost")?;
  let out=original.child.stdout.take().ok_or("stdout custody unavailable")?;
  original.out=Some(std::thread::Builder::new().name("private-git-stdout".into()).spawn(move||read(out)).map_err(|_|"stdout worker unavailable; original retained")?);
  let err=original.child.stderr.take().ok_or("stderr custody unavailable")?;
  original.err=Some(std::thread::Builder::new().name("private-git-stderr".into()).spawn(move||read(err)).map_err(|_|"stderr worker unavailable; original retained")?);
  let deadline=Instant::now()+Duration::from_secs(3);
  loop{
   let original=retained.first_mut().ok_or("Git original lost")?;
   if let Some(status)=original.child.try_wait().map_err(|_|"Git state unknown")? {
    if original.job.is_empty()?&&original.out.as_ref().is_some_and(JoinHandle::is_finished)&&original.err.as_ref().is_some_and(JoinHandle::is_finished){
     let original=retained.remove(0);
     let output=original.out.ok_or("stdout custody")?.join().map_err(|_|"stdout original")?;
     let error=original.err.ok_or("stderr custody")?.join().map_err(|_|"stderr original")?;
     original.binding.verify()?;current()?;
     if output.len()>1024*1024||error.len()>1024*1024{return Err("Git output exceeded original bound".into());}
     return Ok(json!({"exit_code":status.code(),"output":String::from_utf8_lossy(&output),"stderr":String::from_utf8_lossy(&error)}));
    }
   }
   if Instant::now()>=deadline{return Err("Git original remains retained; do not repeat operation".into());}
   std::thread::sleep(Duration::from_millis(5));
  }
 }
 pub(super) fn finish_until(&self,deadline:Instant)->Result<(),String>{
  let mut retained=self.retained.lock().map_err(|_|"Git originals unavailable")?;
  let mut launches=self.launches.lock().map_err(|_|"Git launch originals unavailable")?;
  for launch in launches.iter(){launch.finish_until(deadline)?;}
  launches.clear();
  while let Some(original)=retained.first_mut(){
   if !original.job.is_empty()?{original.job.terminate()?;}
   if original.child.try_wait().map_err(|_|"Git original")?.is_some()&&original.job.is_empty()?&&original.out.as_ref().is_none_or(JoinHandle::is_finished)&&original.err.as_ref().is_none_or(JoinHandle::is_finished){
    let original=retained.remove(0);if let Some(reader)=original.out{let _=reader.join();}if let Some(reader)=original.err{let _=reader.join();}continue;
   }
   if Instant::now()>=deadline{return Err("private Git custody remains retained".into());}
   std::thread::sleep(Duration::from_millis(5));
  }
  Ok(())
 }
}
