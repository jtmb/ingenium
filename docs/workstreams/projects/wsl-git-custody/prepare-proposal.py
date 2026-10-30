"""Generate delta-only follow-on from frozen owned 8b canonical source.
Never read/modify shared Native; Root composes exact original overlaps.
"""
from pathlib import Path
import hashlib,json,difflib
owned=Path(__file__).resolve().parent
base=owned.parent/'native-local-v6';manifest=json.loads((base/'proposal.json').read_text())
expected={item['path']:item['sha256'] for item in manifest['canonicalNewSources']}
paths=['crates/adapters/src/local_execution.rs','crates/adapters/src/local_custody/wsl-helper.py','apps/service/src/routes/local_workspaces/git.rs','apps/service/src/routes/local_workspaces.rs','crates/adapters/src/projects/local_workspaces.rs']
original={}
for rel in paths:
 raw=(base/'sources'/rel).read_bytes()
 if hashlib.sha256(raw).hexdigest()!=expected[rel]:raise RuntimeError('frozen canonical source drift: '+rel)
 original[rel]=raw.decode()
changed=dict(original)
def replace(rel,before,after):
 if changed[rel].count(before)!=1:raise RuntimeError('exact follow-on source anchor: '+rel+' '+before[:80])
 changed[rel]=changed[rel].replace(before,after,1)
rel='crates/adapters/src/local_execution.rs'
replace(rel,'use crate::{local_custody::LocalCustody,projects::ProjectStore};','#[cfg(windows)]\n#[path="local_wsl_git.rs"]\npub mod wsl_git;\nuse crate::{local_custody::LocalCustody,projects::ProjectStore};')
rel='crates/adapters/src/local_custody/wsl-helper.py'
a=changed[rel].index("        if action!='git': raise ValueError('operation')")
z=changed[rel].index('    finally:\n        for fd in reversed(held)',a)
changed[rel]=changed[rel][:a]+"""        if action=='git_tree' and len(sys.argv)==4 and sys.argv[1]=='--local-git-tree':
            return local_git_tree(current,root,a)
        raise ValueError('legacy unsupervised Git is unavailable')
"""+changed[rel][z:]
rel='apps/service/src/routes/local_workspaces/git.rs'
replace(rel,'launches:Mutex<Vec<Arc<LocalGitLaunch>>>}', 'launches:Mutex<Vec<Arc<LocalGitLaunch>>>,wsl:veyra_adapters::local_execution::wsl_git::LocalWslGit}')
replace(rel,'binding:Arc<LocalWorkspaceBinding>,operation:&LocalOperation,current:', 'binding:Arc<LocalWorkspaceBinding>,request:&str,operation:&LocalOperation,current:')
replace(rel,'return Err("WSL Git requires qualified separately typed Linux helper-tree custody".into());','return self.wsl.run(binding,request,operation,current);')
replace(rel,'  // Original run_wsl owns its Windows bridge, not arbitrary Linux Git\n  // descendants. Do not enable this effect before that actual owner qualifies.','  // Separate actual subreaper/pidfd owner; neither the legacy bridge nor\n  // process-group census authorizes this operation.')
replace(rel,'let (args,wsl):','let (args,_wsl):')
replace(rel,'  if matches!(binding.owner().environment,LocalEnvironment::Wsl{..}){return binding.wsl_request(wsl);}', '')
replace(rel,' pub(super) fn finish_until(&self,deadline:Instant)->Result<(),String>{',' pub(super) fn finish_until(&self,deadline:Instant)->Result<(),String>{\n  self.wsl.finish_until(deadline)?;')
rel='apps/service/src/routes/local_workspaces.rs'
needle="""  if matches!(body.owner.environment,LocalEnvironment::Wsl{..})&&matches!(body.operation,
   LocalOperation::GitStatus|LocalOperation::GitDiff|LocalOperation::GitBranch{..}|LocalOperation::WorktreeCreate{..}){
   return Err("WSL Git helper-tree custody has not qualified; no original effect admitted".into());
  }
"""
replace(rel,needle,'')
replace(rel,'git.run(binding.clone(),git,&current)','git.run(binding.clone(),&body.request_id,git,&current)')
rel='crates/adapters/src/projects/local_workspaces.rs'
replace(rel,'  let kind=encoded(&request.operation)?.split(\',\').next().unwrap_or("").to_owned();','  let value=serde_json::to_value(&request.operation).map_err(|_|StoreError::Invalid)?;\n  let kind=value["kind"].as_str().ok_or(StoreError::Invalid)?.to_owned();\n  if matches!(request.owner.environment,LocalEnvironment::Wsl{..})&&matches!(kind.as_str(),"git_status"|"git_diff"|"git_branch"|"worktree_create"){\n   // A restart or retired transport cannot turn an old unknown Linux original\n   // into absence. Preserve immutable legacy kind encodings without rewriting.\n   let pending:bool=self.connection.query_row(r#"SELECT EXISTS(SELECT 1 FROM local_workspace_operations WHERE workspace_id=? AND id<>? AND state IN (\'intent\',\'unknown\') AND (kind IN (\'git_status\',\'git_diff\',\'git_branch\',\'worktree_create\') OR kind LIKE \'{"kind":"git_%\' OR kind LIKE \'{"kind":"worktree_create%\'))"#,params![request.owner.workspace_id,request.request_id],|row|row.get(0))?;\n   if pending{return Err(StoreError::Conflict);}\n  }')
# Preserve completed originals and positive closure witnesses in the existing
# immutable operation row, including unknown outcomes. No new SQL migration.
rel='crates/adapters/src/projects/local_workspaces.rs'
needle="AND state IN ('intent','unknown') AND (kind IN"
replace(rel,needle,"AND state IN ('intent','unknown') AND (state='intent' OR COALESCE(json_extract(result_json,'$.original_transport_closed'),0)<>1 OR COALESCE(json_extract(result_json,'$.tree_empty'),0)<>1 OR COALESCE(json_extract(result_json,'$.pipe_eof'),0)<>1) AND (kind IN")
changed[rel]+="""
#[cfg(windows)]
impl ProjectStore{
 /// Only the actual retained Windows+Linux owner can construct this witness.
 /// Cleanup persistence never re-labels an unknown effect as successful.
 pub fn record_local_wsl_git_closed(&mut self,closed:&crate::local_execution::wsl_git::LocalWslGitClosed)->Result<(),StoreError>{
  let custody=self.local_custody.as_ref().ok_or(StoreError::Invalid)?;
  custody.verify_account().map_err(|_|StoreError::Conflict)?;
  if closed.owner().installation_id!=self.local_installation_id()?||closed.owner().custodian_key!=custody.key()||!matches!(closed.owner().environment,LocalEnvironment::Wsl{..}){return Err(StoreError::Conflict);}
  let original=self.connection.query_row("SELECT owner_json,state,result_json FROM local_workspace_operations WHERE id=?",[closed.request()],|row|Ok((row.get::<_,String>(0)?,row.get::<_,String>(1)?,row.get::<_,Option<String>>(2)?)))?;
  if serde_json::from_str::<LocalWorkspaceOwner>(&original.0).map_err(|_|StoreError::Corrupt)?!=*closed.owner(){return Err(StoreError::Conflict);}
  let bytes=encoded(closed.result())?;if bytes.len()>1024*1024{return Err(StoreError::Invalid);}
  if let Some(prior)=original.2{if prior==bytes{return Ok(());}return Err(StoreError::Conflict);}
  if original.1!="unknown"{return Err(StoreError::Conflict);}
  let state=if closed.result()["outcome_unknown"]==true{"unknown"}else{"committed"};
  if self.connection.execute("UPDATE local_workspace_operations SET result_json=?,state=? WHERE id=? AND state='unknown' AND result_json IS NULL",params![bytes,state,closed.request()])?!=1{return Err(StoreError::Conflict);}Ok(())
 }
}
"""
rel='apps/service/src/routes/local_workspaces/git.rs'
replace(rel,'return self.wsl.run(binding,request,operation,current);','return Err("WSL Git requires its opaque closed-original path".into());')
needle=' pub(super) fn finish_until(&self,deadline:Instant)->Result<(),String>{'
replace(rel,needle,""" pub(super) fn run_wsl(&self,binding:Arc<LocalWorkspaceBinding>,request:&str,operation:&LocalOperation,current:&dyn Fn()->Result<(),String>)->Result<veyra_adapters::local_execution::wsl_git::LocalWslGitClosed,String>{self.wsl.run(binding,request,operation,current)}
 pub(super) fn poll_wsl(&self,request:&str)->Result<Option<veyra_adapters::local_execution::wsl_git::LocalWslGitClosed>,String>{self.wsl.poll_closed(request)}
 pub(super) fn retain_wsl(&self,closed:veyra_adapters::local_execution::wsl_git::LocalWslGitClosed)->Result<(),String>{self.wsl.retain_closed(closed)}
 pub(super) fn persist_wsl(&self,persist:&mut dyn FnMut(&veyra_adapters::local_execution::wsl_git::LocalWslGitClosed)->Result<(),String>)->Result<(),String>{self.wsl.persist_closed(persist)}
 pub(super) fn has_wsl_witnesses(&self)->Result<bool,String>{self.wsl.has_closed()}
"""+needle)
rel='apps/service/src/routes/local_workspaces.rs'
needle="""  let outcome=match &body.operation {"""
replace(rel,needle,"""  if matches!(body.owner.environment,LocalEnvironment::Wsl{..})&&matches!(body.operation,LocalOperation::GitStatus|LocalOperation::GitDiff|LocalOperation::GitBranch{..}|LocalOperation::WorktreeCreate{..}){
   let closed=state.local_workspaces.git.run_wsl(binding.clone(),&body.request_id,&body.operation,&current)?;
   let persisted=with_store(&state,|store|store.record_local_wsl_git_closed(&closed).map_err(|_|"original WSL closure receipt unavailable".into()));
   if persisted.is_err(){state.local_workspaces.git.retain_wsl(closed)?;return Err("actual closed WSL witness remains retained for persistence".into());}
   current()?;
   return with_store(&state,|store|serde_json::to_value(store.local_receipt(&body.request_id).map_err(|_|"original WSL receipt unavailable")?).map_err(|_|"original WSL receipt encoding".into()));
  }
"""+needle)
# Observe late original cleanup without a new upstream effect or numeric PID.
needle=""" reply(actor.check(&state).and_then(|_|with_store(&state,|store|{
  let original=store.local_receipt(&id)"""
replace(rel,needle,""" reply(actor.check(&state).and_then(|_|{
  if let Some(closed)=state.local_workspaces.git.poll_wsl(&id)?{
   let persisted=with_store(&state,|store|store.record_local_wsl_git_closed(&closed).map_err(|_|"late original WSL receipt unavailable".into()));
   if persisted.is_err(){state.local_workspaces.git.retain_wsl(closed)?;return Err("late closed WSL witness retained".into());}
  }
  with_store(&state,|store|{
  let original=store.local_receipt(&id)""")
needle="""  serde_json::to_value(original).map_err(|_|"original encoding".into())
 })))"""
replace(rel,needle,"""  serde_json::to_value(original).map_err(|_|"original encoding".into())
 })}))""")
# The old owner method refuses to discard unpersisted closed witnesses. Root
# composes the named shared retirement hook below before SQL donor movement.
replace(rel,'  self.git.finish_until(deadline)?;','  self.git.finish_until(deadline)?;\n  if self.git.has_wsl_witnesses()?{return Err("persist actual WSL closure witnesses before donor retirement".into());}')
changed[rel]+="""
/// Root replaces the shared retirement call with this exact typed hook.
pub(super) fn finish_with_registry(state:&ServiceState,deadline:Instant)->Result<(),String>{
 state.local_workspaces.terminals.finish_until(deadline).map_err(|_|"private terminal originals retained")?;
 state.local_workspaces.git.finish_until(deadline)?;
 with_store(state,|store|state.local_workspaces.git.persist_wsl(&mut |closed|store.record_local_wsl_git_closed(closed).map_err(|_|"actual WSL closure persistence refused".into())))?;
 state.local_workspaces.custodies.finish_until(deadline)
}
"""
patch=[];proof=[]
for rel,before in original.items():
 after=changed[rel]
 patch.extend(difflib.unified_diff(before.splitlines(keepends=True),after.splitlines(keepends=True),fromfile='a/'+rel,tofile='b/'+rel))
 proof.append({'path':rel,'baseSha256':expected[rel],'proposedSha256':hashlib.sha256(after.encode()).hexdigest()})
patch=''.join(patch);(owned/'integration.patch').write_text(patch)
new=[]
for file in sorted((owned/'sources').rglob('*')):
 if file.is_file():new.append({'path':str(file.relative_to(owned/'sources')),'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
(owned/'proposal.json').write_text(json.dumps({'parentWorkerCommit':'8b18318e248c7e1cba953c1e68b47529aac1a276','base':'8b canonical source plus explicitly mirrored Root SQLite i64/checked-u64 revision correction; Root applied/composed Native separately','existingInputs':proof,'canonicalNewSources':new,'patchSha256':hashlib.sha256(patch.encode()).hexdigest(),'nativeWritten':False,'applied':False,'compiled':False,'actualWindowsWSLTransportQualified':False,'nodeMigrationsChanged':False,'nativeSchemaChanged':False,'rootCompositionHook':{'file':'apps/service/src/routes/workspace_retirement.rs','before':'state.local_workspaces.finish_until(self.deadline)?;','after':'local_workspaces::finish_with_registry(state, self.deadline)?;','rootOnly':True,'appliedByWorker':False,'requiredBeforeSQLiteDonorRetirement':True}},indent=2)+'\n')
print(json.dumps({'existingDeltas':len(proof),'newSources':len(new),'patchBytes':len(patch.encode())}))
