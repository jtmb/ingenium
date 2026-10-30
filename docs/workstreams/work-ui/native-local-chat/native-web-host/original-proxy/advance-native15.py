"""Build exact Native15 incremental source delta in this same proposal root."""
import argparse,difflib,hashlib,json,subprocess
from pathlib import Path
ROOT=Path(__file__).resolve().parent
NATIVE='//wsl.localhost/Ubuntu/home/brajam/.local/state/ingenium-release/skill-zen-fix-1792810845/real-gmail-ui/veyra-phase-1/windows-source'
GIT='/mnt/c/Program Files/Git/cmd/git.exe'
def git(*args):return subprocess.check_output([GIT,'-c','safe.directory='+NATIVE,'-C',NATIVE,*args])
def sha(data):return hashlib.sha256(data).hexdigest()
def replace(data,a,b):
 assert data.count(a)==1,('exact insertion ambiguous',a[:100]);return data.replace(a,b,1)
WEB='crates/adapters/src/opencode/desktop_runtime/local_workspaces/web_original.rs'
PROJECTS='crates/adapters/src/projects.rs'
LOCAL='crates/adapters/src/projects/local_workspaces.rs'
RUNTIME='crates/adapters/src/opencode/desktop_runtime.rs'
LOCALRUNTIME='crates/adapters/src/opencode/desktop_runtime/local_workspaces.rs'
CLIENT='crates/adapters/src/opencode/mod.rs'
SVCWEB='apps/service/src/routes/local_workspaces/web_original.rs'
SVCLOCAL='apps/service/src/routes/local_workspaces.rs'
FACADE='apps/service/src/routes/live_agent.rs'
AUTH='apps/desktop/src-tauri/src/local_web_auth.rs'
NEW=['crates/adapters/src/projects/0007.sql','crates/adapters/src/projects/local_web_originals.rs',
 'crates/adapters/src/opencode/desktop_runtime/local_workspaces/web_materialization.rs',
 'crates/adapters/src/opencode/desktop_runtime/local_workspaces/web_event_policy.rs',
 'crates/adapters/src/opencode/local_web_transport.rs']
def change(path,data):
 if path==WEB:return (ROOT/'sources'/path).read_bytes()
 if path==AUTH:
  helper=b'''fn exact_resource_origin(expected:&Url,raw:&str,context:COREWEBVIEW2_WEB_RESOURCE_CONTEXT)->bool{
    if exact_origin(expected,raw){return true;}
    if context.0!=COREWEBVIEW2_WEB_RESOURCE_CONTEXT_WEBSOCKET.0||raw.len()>32768{return false;}
    let Ok(mut url)=Url::parse(raw)else{return false;};
    let mapped=match (url.scheme(),expected.scheme()){("ws","http")=>"http",("wss","https")=>"https",_=>return false};
    if url.set_scheme(mapped).is_err(){return false;}
    exact_origin(expected,url.as_str())
}
'''
  data=replace(data,b'fn block(args:',helper+b'fn block(args:')
  data=replace(data,b'        let uri=CoTaskMemPWSTR::from(raw).to_string();\n',b'        let uri=CoTaskMemPWSTR::from(raw).to_string();\n        let mut context=COREWEBVIEW2_WEB_RESOURCE_CONTEXT_ALL;args.ResourceContext(&mut context)?;\n')
  data=replace(data,b'!exact_origin(lease.proxy_origin(),&uri)',b'!exact_resource_origin(lease.proxy_origin(),&uri,context)')
  tests=b'''    #[test]fn websocket_scheme_equivalence_requires_actual_native_websocket_context(){
        let expected=Url::parse("http://127.0.0.1:48123/").unwrap();
        assert!(exact_resource_origin(&expected,"ws://127.0.0.1:48123/api/pty/pty_actual/connect",COREWEBVIEW2_WEB_RESOURCE_CONTEXT_WEBSOCKET));
        assert!(!exact_resource_origin(&expected,"ws://127.0.0.1:48123/api/pty/pty_actual/connect",COREWEBVIEW2_WEB_RESOURCE_CONTEXT_FETCH));
        for raw in ["wss://127.0.0.1:48123/","ws://localhost:48123/","ws://127.0.0.1:48124/","ws://name:secret@127.0.0.1:48123/","ws://127.0.0.1:48123/#fragment"]{
            assert!(!exact_resource_origin(&expected,raw,COREWEBVIEW2_WEB_RESOURCE_CONTEXT_WEBSOCKET));
        }
    }
'''
  return replace(data,b'    #[test]fn failed_add_keeps_observed_token',tests+b'    #[test]fn failed_add_keeps_observed_token')
 if path==SVCWEB:return (ROOT/'sources'/path).read_bytes()
 if path==FACADE:
  addition=b'''    pub(super) fn submit_local_web_prompt_original<F>(&self,lease:&veyra_adapters::opencode::desktop_runtime::LocalWebLease,original:veyra_adapters::opencode::desktop_runtime::NativeWebOriginal,current:&dyn Fn()->Result<(),String>,reserve:F)->Result<veyra_adapters::opencode::desktop_runtime::LocalWebOriginalSubmission,String>
    where F:FnOnce(veyra_adapters::opencode::desktop_runtime::NativeWebOriginal,veyra_adapters::opencode::desktop_runtime::EffectiveWebBody,veyra_adapters::opencode::attachments::NativeWebFilesOriginal)->Result<veyra_adapters::projects::NativeWebReservation,String>{
        self.runtime.submit_local_web_prompt_original(lease,original,current,reserve).map_err(|_|"Original Web prompt outcome unavailable; no effect repeated".into())
    }
'''
  return replace(data,b'    pub(super) fn mint_local_web_lease',addition+b'    pub(super) fn mint_local_web_lease')
 if path==SVCLOCAL:
  operation=b'async fn operation(State(state):State<Arc<ServiceState>>,Extension(actor):Extension<LocalRequest>,Json(body):Json<LocalOperationRequest>)->Response{\n let result=tokio::task::spawn_blocking(move||->Result<Value,String>{\n'
  serialized=b'''async fn operation(State(state):State<Arc<ServiceState>>,Extension(actor):Extension<LocalRequest>,Json(body):Json<LocalOperationRequest>)->Response{
  let serial=if matches!(body.operation,LocalOperation::SessionCreate{..}|LocalOperation::AgentTurn{..}|LocalOperation::SessionSelectModel{..}|LocalOperation::SessionSelectAgent{..}){
   match tokio::time::timeout(Duration::from_secs(5),state.serial.clone().lock_owned()).await{Ok(guard)=>Some(guard),Err(_)=>return reply(Err("original model admission busy".into()))}
  }else{None};
  let result=tokio::task::spawn_blocking(move||->Result<Value,String>{
   let _serial=serial;
'''
  data=replace(data,operation,serialized)
  data=replace(data,b' custodies:Arc<veyra_adapters::local_custody::LocalCustodyOriginals>,\n',b' custodies:Arc<veyra_adapters::local_custody::LocalCustodyOriginals>,\n web:Arc<web_original::WebPending>,\n')
  data=replace(data,b'  self.custodies.finish_until(deadline)\n',b'  self.custodies.finish_until(deadline)?;\n  self.web.check_empty()\n')
  retained=b'''   if store.local_receipt(&body.request_id).map_err(|_|"original receipt unavailable")?.is_some(){
    if !store.reserve_local_operation(&body,&state.instance_id).map_err(|_|"original conflict")?{return Ok((false,None));}
    return Err("retained original cannot become fresh".into());
   }
   if matches!(body.operation,LocalOperation::SessionCreate{..}|LocalOperation::AgentTurn{..}|LocalOperation::SessionSelectModel{..}|LocalOperation::SessionSelectAgent{..}){store.require_no_unknown_native_web_original(&body.owner.workspace_id).map_err(|_|"reconcile original Web input before native mutation")?;}
   if !store.reserve_local_operation(&body,&state.instance_id)'''
  data=replace(data,b'   if !store.reserve_local_operation(&body,&state.instance_id)',retained)
  before=b''' state.local_workspaces.terminals.finish_until(deadline).map_err(|_|"private terminal originals retained")?;
 state.local_workspaces.git.finish_until(deadline)?;
 with_store(state,|store|state.local_workspaces.git.persist_wsl(&mut |closed|store.record_local_wsl_git_closed(closed).map_err(|_|"actual WSL closure persistence refused".into())))?;
 state.local_workspaces.custodies.finish_until(deadline)
'''
  after=b''' let web=state.local_workspaces.web.flush(state,deadline);
 let terminals=state.local_workspaces.terminals.finish_until(deadline).map_err(|_|"private terminal originals retained".to_owned());
 let git=state.local_workspaces.git.finish_until(deadline);
 let witnesses=with_store(state,|store|state.local_workspaces.git.persist_wsl(&mut |closed|store.record_local_wsl_git_closed(closed).map_err(|_|"actual WSL closure persistence refused".into())));
 let custody=state.local_workspaces.custodies.finish_until(deadline);
 web.and(terminals).and(git).and(witnesses).and(custody).and(state.local_workspaces.web.check_empty())
'''
  return replace(data,before,after)
 if path==RUNTIME:
  data=replace(data,b'pub use local_workspaces::web_original::{LocalWebLease, NativeWebOriginal, LocalWebPromptInspection};\n',b'pub use local_workspaces::web_original::{LocalWebLease, NativeWebOriginal, LocalWebPromptInspection,LocalWebPromptOutcome,LocalWebOriginalSubmission};\npub use local_workspaces::web_materialization::{EffectiveWebBody,WebUriReplacement,WebUriTransformation,materialize_web_uri_spans,materialize_resolved_web_files};\npub use local_workspaces::web_event_policy::{WebEventDecision,NativeSseFrames,project_local_web_event};\n')
  data=replace(data,b'    local_original: Option<veyra_contracts::LocalPromptOriginal>,\n',b'    local_original: Option<veyra_contracts::LocalPromptOriginal>,\n    #[serde(default, skip_serializing_if = "Option::is_none")]\n    web_original: Option<Value>,\n')
  return replace(data,b'            local_original,\n            session_id: id.into(),',b'            local_original,\n            web_original:None,\n            session_id: id.into(),')
 if path==CLIENT:
  return replace(data,b'mod local_conversations;\n',b'mod local_conversations;\nmod local_web_transport;\n')
 if path==LOCALRUNTIME:
  return replace(data,b'pub(super) mod web_original;\n',b'pub(super) mod web_original;\npub(super) mod web_materialization;\npub(super) mod web_event_policy;\n')
 if path==PROJECTS:
  data=replace(data,b'mod local_workspaces;\n',b'mod local_workspaces;\nmod local_web_originals;\npub use local_web_originals::{NativeWebDispatch,NativeWebReservation,NativeWebAcknowledgement,SavedNativeWebPty};\n')
  return replace(data,b'[SCHEMA_VERSION, 6].contains',b'[SCHEMA_VERSION, 6, 7].contains')
 if path==LOCAL:
  data=replace(data,b'if version>6{',b'if version>7{')
  data=replace(data,b'let mut store=if version==6 {',b'let mut store=if version==6 || version==7 {')
  data=replace(data,b'}else if current!=6{return Err(StoreError::Corrupt);}',b'}else if current!=6 && current!=7{return Err(StoreError::Corrupt);}')
  before=b'''  let expected=Connection::open_in_memory()?;
  expected.execute_batch(include_str!("0006.sql"))?;
  fn ddl(db:&Connection)->Result<Vec<(String,String)>,StoreError>{
   let mut statement=db.prepare("SELECT name,sql FROM sqlite_master WHERE name LIKE 'local_%' AND sql IS NOT NULL ORDER BY name")?;
   let values=statement.query_map([],|row|Ok((row.get(0)?,row.get(1)?)))?.collect::<Result<Vec<_>,_>>()?;
   Ok(values)
  }
  if ddl(&tx)?!=ddl(&expected)?{return Err(StoreError::Corrupt);}
'''
  after=b'''  if schema_version(&tx)?==6 {
   super::local_web_originals::validate_allocated_schema(&tx,6)?;
   let before=digest_legacy(&tx)?;
   tx.execute_batch(include_str!("0007.sql"))?;
   if digest_legacy(&tx)?!=before{return Err(StoreError::Corrupt);}
  }
  super::local_web_originals::validate_allocated_schema(&tx,7)?;
'''
  return replace(data,before,after)
 raise AssertionError(path)
parser=argparse.ArgumentParser();parser.add_argument('--freeze',action='store_true');parser.add_argument('--extend-inputs',action='store_true');args=parser.parse_args()
pinpath=ROOT/'native15-inputs.json'
if args.freeze:
 assert not pinpath.exists(),'Native15 originals already pinned'
 old=json.loads((ROOT/'assembly-manifest.json').read_text())
 for item in old['files']:
  current=git('show',':'+item['path'])
  assert sha(current)==item['postimage_sha256'],('original imported source changed; reconcile before advance',item['path'])
 records=[]
 for path in [WEB,PROJECTS,LOCAL]:
  blob=git('rev-parse',':'+path).decode().strip();data=git('cat-file','blob',blob)
  records.append({'path':path,'blob':blob,'bytes':len(data),'sha256':sha(data)})
 pinpath.write_text(json.dumps({'schema':1,'records':records},indent=2)+'\n')
pins=json.loads(pinpath.read_text())
if args.extend_inputs:
 known={record['path'] for record in pins['records']}
 for path in [RUNTIME,LOCALRUNTIME,CLIENT,SVCWEB,SVCLOCAL,FACADE,AUTH]:
  if path in known:continue
  blob=git('rev-parse',':'+path).decode().strip();data=git('cat-file','blob',blob)
  pins['records'].append({'path':path,'blob':blob,'bytes':len(data),'sha256':sha(data)})
 pinpath.write_text(json.dumps(pins,indent=2)+'\n')
patch=[];manifest=[]
for pin in pins['records']:
 data=git('cat-file','blob',pin['blob']);assert sha(data)==pin['sha256']
 post=change(pin['path'],data)
 patch.extend(difflib.unified_diff(data.decode().splitlines(True),post.decode().splitlines(True),fromfile='a/'+pin['path'],tofile='b/'+pin['path']))
 manifest.append({'path':pin['path'],'preimage_blob':pin['blob'],'preimage_sha256':sha(data),'postimage_sha256':sha(post),'bytes':len(post)})
for path in NEW:
 data=(ROOT/'sources'/path).read_bytes()
 patch.extend(difflib.unified_diff([],data.decode().splitlines(True),fromfile='/dev/null',tofile='b/'+path))
 manifest.append({'path':path,'preimage_blob':None,'postimage_sha256':sha(data),'bytes':len(data)})
# Git accepts a bare empty context line. Omit only its synthetic diff prefix
# so the tracked patch artifact passes whitespace checks; source bytes/hunk
# counts and exact pre/postimage hashes are unchanged.
data=''.join(line[1:] if line in (' \n',' \r\n') else line for line in patch).encode();(ROOT/'native15-originals.patch').write_bytes(data)
(ROOT/'native15-manifest.json').write_text(json.dumps({'scope':'source proposal; no compiler/runtime acceptance','patch_sha256':sha(data),'patch_bytes':len(data),'files':manifest},indent=2)+'\n')
print(json.dumps({'files':len(manifest),'patch_bytes':len(data),'patch_sha256':sha(data)}))
