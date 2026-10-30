"""Read the recorded native tree inputs; emit ONLY a delta under this owned docs root.
No source checkout writes, copies, Git index mutation, dependency or build work.
"""
from pathlib import Path
import argparse,difflib,hashlib,json
a=argparse.ArgumentParser();a.add_argument('--native-root',required=True);args=a.parse_args()
native=Path(args.native_root);owned=Path(__file__).resolve().parent
assert native.is_absolute() and native.resolve()==native and native.is_dir()
expected={
'apps/service/src/routes.rs':'cdd13f467919794b5282682b3ebf51614437f9f3',
'apps/service/src/routes/remote_control/proxy.rs':'a2e63d498f66bbf2f02d0649a1cde7741c004cf9',
'apps/service/src/routes/state_startup/assembly.rs':'b91782227a7fca4663349d35f273c6f93d1eac0e',
'crates/adapters/src/interactive_terminal.rs':'71f81961df2fb0366203f93ec49d3e3489c3f5ee',
'crates/adapters/src/lib.rs':'57fbd1b8516be1cd525a7d928d7d9dfdd47de478',
'crates/adapters/src/opencode/desktop_runtime.rs':'b7a87c01af74b914c8fbd04f6329d1ecf83bc42f',
'crates/adapters/src/projects.rs':'ea07d39b8371fcb4cd61ed69b45303bcd09b4208',
'crates/contracts/src/lib.rs':'2bf07f372dda8b6f5d11c20001b7139ca5f11ce3',
'apps/service/src/routes/live_agent.rs':'27eba510d1d8528250ccf20d82cc1ebd640f4d70',
'apps/service/src/routes/workspace_retirement.rs':'1319b041bb36e60ef0508ca9f56a9740240b6cc4',
'crates/adapters/src/wsl_workspace.rs':'9316c3f6042f74b15af5e424e5f757f09fbca836',
'crates/adapters/src/windows_acl.rs':'f181fa87f0f41f2193c7a1405c21eaf9fed5ea51',
'apps/service/src/routes/state_startup/effects.rs':'52851bafde41c72c8715826059438499915efcea',
'apps/service/src/routes/state_startup/legacy.rs':'dac8d6e8246743f9c16af223ef95db33e25fa0be',
'apps/service/src/routes/state_startup.rs':'f1fbb49d7fceeebffc2145b04863a6874be2a2a9',
'crates/adapters/src/projects/close.rs':'a1b3c36eefc9fd68d3b8ce4132bb0b543a856fe2',
'crates/adapters/src/task_workspaces.rs':'6096614e56b1a5190827f6070888d47732bd2c77',
'crates/adapters/src/task_workspaces/windows.rs':'acadb4a622b5c4fb1dc609503765af5efe0bb701',
'crates/adapters/src/service_registration/guards/native.rs':'e61349c111b9c2d32ef5862d7897bfb75d0ce86e',
'crates/adapters/src/projects/close/tests.rs':'8e454b413e29b8971a3e14593db2fca0f789329c',
'crates/adapters/src/projects/presentation/task_names/saved_metadata/tests.rs':'a70ae5b9a42288199e5a085467cf805dd951d39b',
'crates/adapters/src/projects/presentation/task_names/tests.rs':'b4eafe6fac90583e9d70e1e378600d8333a3e1a2',
'crates/adapters/src/projects/presentation/tests.rs':'902eeaade35c8037c6a0cf9f6b188a13c083ecdc',
'crates/adapters/src/projects/saved_metadata_search/tests.rs':'f611adf86dae6559b34f54de4ea977f264eb38a0',
'crates/adapters/src/projects/test_support/busy.rs':'77dc964ccdc5b72f0fa75f5645789d80ccc2583d',
'crates/adapters/src/projects/configuration.rs':'1f7a8ce816671f7f0525bb711e90cd3472487b36',
'crates/adapters/src/projects/presentation.rs':'d3643797fe668e028b2f196737afc04952a9762f',
'crates/adapters/src/projects/presentation/task_names/saved_metadata.rs':'c42ea61c54f5524af88c17fee38aebacae264e5f',
'crates/adapters/src/projects/saved_metadata_search.rs':'528026f1dc534e87f435e4e1c8a6280c93d29694',
}
original={}
for rel,blob in expected.items():
 raw=(native/rel).read_bytes()
 actual=hashlib.sha1(('blob '+str(len(raw))+'\0').encode()+raw).hexdigest()
 if actual!=blob: raise RuntimeError('native source drift; no fallback: '+rel)
 original[rel]=raw.decode()
changed=dict(original)
def replace(rel,before,after):
 text=changed[rel]
 if text.count(before)!=1:raise RuntimeError('exact integration anchor drift: '+rel+' '+before[:80])
 changed[rel]=text.replace(before,after,1)
replace('crates/contracts/src/lib.rs','use serde::{Deserialize, Serialize};','pub mod local_workspaces;\nuse serde::{Deserialize, Serialize};')
replace('crates/adapters/src/lib.rs','//!','pub mod local_custody;\npub mod local_execution;\n#[cfg(windows)]\npub mod local_git_launch;\n//!') if False else None
# Insert after module-level inner docs, before normal items.
rel='crates/adapters/src/lib.rs';text=changed[rel];lines=text.splitlines(keepends=True);i=0
while i<len(lines) and (lines[i].startswith('//!') or not lines[i].strip()):i+=1
lines[i:i]=['pub mod local_custody;\n','pub mod local_execution;\n#[cfg(windows)]\npub mod local_git_launch;\n'];changed[rel]=''.join(lines)
rel='crates/adapters/src/projects.rs'
replace(rel,'mod backup;','mod local_workspaces;\npub use local_workspaces::LocalWorkspaceRecord;\nmod backup;')
replace(rel,'pub struct ProjectStore {\n    connection: Connection,\n}','''pub struct ProjectStore {
    connection: Connection,
    local_custody: Option<std::sync::Arc<crate::local_custody::LocalCustody>>,
    local_installation_id: Option<String>,
}''')
replace(rel,'Ok(Self { connection })','Ok(Self { connection, local_custody: None, local_installation_id: None })')
replace(rel,'Ok(ProjectStore { connection })','Ok(ProjectStore { connection, local_custody: None, local_installation_id: None })')
replace(rel,'if schema_version(&connection)? != SCHEMA_VERSION { return Err(StoreError::Corrupt); }',
 'if ![SCHEMA_VERSION, 6].contains(&schema_version(&connection)?) { return Err(StoreError::Corrupt); }')
rel='crates/adapters/src/windows_acl.rs'
replace(rel,'pub(crate) fn verify_owner_only(file: &File, kind: ProtectedAclKind) -> Result<(), String> {','''pub(crate) fn verify_owner_only(file: &File, kind: ProtectedAclKind) -> Result<(), String> {
    verify_owner_only_inner(file,kind,false)
}
/// SQLite siblings may inherit the one exact owner ACE from the held protected
/// root. No broad ACE, different owner, changed descriptor or ACL repair.
pub(crate) fn verify_private_inherited_file(file: &File) -> Result<(), String> {
    verify_owner_only_inner(file,ProtectedAclKind::File,true)
}
fn verify_owner_only_inner(file: &File, kind: ProtectedAclKind, inherited_file: bool) -> Result<(), String> {''')
replace(rel,'|| control & SE_DACL_PROTECTED == 0','|| (!inherited_file && control & SE_DACL_PROTECTED == 0)')
replace(rel,'header.AceFlags != kind.flags()',
 '(header.AceFlags != kind.flags() && !(inherited_file && header.AceFlags == INHERITED_ACE as u8))')
rel='crates/adapters/src/interactive_terminal.rs'
replace(rel,'pub mod shells;','pub mod shells;\n#[cfg(windows)]\nmod local_workspaces;\n#[cfg(windows)]\npub use local_workspaces::LocalTerminals;')
rel='crates/adapters/src/wsl_workspace.rs'
replace(rel,'const SCRIPT: &str = r#"','const SCRIPT: &str = concat!(include_str!("local_custody/wsl-helper.py"), r#"')
replace(rel,'"#;\n\n','"#);\n\n')
anchor="    op, a = req['operation'], req.get('args', {})"
replace(rel,anchor,anchor+"""
    if op=='local_private':
        result=local_private_operation(a)
        print(json.dumps({'ok':True,'result':result},separators=(',',':')))
        raise SystemExit(0)""")
changed[rel]+='''
/// Separate typed local owner, never a synthetic Project. Uses the same fixed
/// helper and original retained run_wsl process/pipe/deadline supervisor.
pub fn local_private_request(environment:&veyra_contracts::local_workspaces::LocalEnvironment,args:Value,guard:&dyn Fn()->bool)->Result<Value,Error>{
 let veyra_contracts::local_workspaces::LocalEnvironment::Wsl{distro,user}=environment else{return Err(Error::Unsupported);};
 if distro.is_empty()||user.is_empty()||[distro,user].iter().any(|s|s.len()>128||s.starts_with('-')||s.chars().any(|c|c.is_control()||matches!(c,'/'|'\\\\'|':'))){return Err(Error::Invalid);}
 if !guard(){return Err(Error::Unavailable);}
 let input=serde_json::to_vec(&json!({"operation":"local_private","args":args})).map_err(|_|Error::Invalid)?;
 if input.len()>LIMIT{return Err(Error::TooLarge);}
 #[cfg(windows)] {run_wsl(distro,user,input,false,guard)}
 #[cfg(not(windows))] {let _=(distro,user,input);Err(Error::Unsupported)}
}
'''
rel='crates/adapters/src/opencode/desktop_runtime.rs'
replace(rel,'mod creation;','mod creation;\nmod local_workspaces;')
anchor='''    fn prompt_scoped_checked(&self, id: &str, directory: &str, request_id: &str, text: &str,
        files: &[super::attachments::PromptFile], skill_ids: &[String], require_idle: bool,
        original: Option<&veyra_contracts::PromptOriginal>,
    ) -> Result<Value, RuntimeError> {'''
replace(rel,anchor,anchor+'''
        self.prompt_scoped_checked_local(id,directory,request_id,text,files,skill_ids,require_idle,original,None)
    }
    fn prompt_scoped_checked_local(&self,id:&str,directory:&str,request_id:&str,text:&str,
        files:&[super::attachments::PromptFile],skill_ids:&[String],require_idle:bool,
        original:Option<&veyra_contracts::PromptOriginal>,local:Option<&crate::local_execution::LocalWorkspaceBinding>,
    )->Result<Value,RuntimeError>{''')
a=changed[rel].index('    fn prompt_scoped_checked_local');z=changed[rel].index('    pub fn lookup_prompt',a)
section=changed[rel][a:z]
needle='        let engine = self.lock_engine_for_directory(directory)?;'
assert section.count(needle)==1
section=section.replace(needle,needle+'\n        if let Some(binding)=local {local_workspaces::require_local_engine(&engine,binding)?;}')
needle='        let admission = if files.is_empty() && skill_ids.is_empty() {'
assert section.count(needle)==1
section=section.replace(needle,'        if let Some(binding)=local {local_workspaces::require_local_engine(&engine,binding)?;}\n'+needle)
changed[rel]=changed[rel][:a]+section+changed[rel][z:]
rel='apps/service/src/routes/live_agent.rs'
anchor='impl LiveAgent {'
replace(rel,anchor,anchor+'''
    pub(super) fn create_local_session(&self,binding:&veyra_adapters::local_execution::LocalWorkspaceBinding,request:&str,title:&str,agent:&str)->Result<Value,String>{
        self.runtime.create_local_session(binding,request,title,agent).map(|session|json!({"result_kind":"session_created","session":session})).map_err(|_|"private session original outcome unknown".into())
    }
    pub(super) fn prompt_local(&self,binding:&veyra_adapters::local_execution::LocalWorkspaceBinding,session:&str,request:&str,text:&str)->Result<Value,String>{
        self.runtime.prompt_local(binding,session,request,text).map_err(|_|"private prompt original outcome unknown".into())
    }
    pub(super) fn local_session(&self,binding:&veyra_adapters::local_execution::LocalWorkspaceBinding,session:&str)->Result<Value,String>{
        self.runtime.local_session(binding,session).and_then(|s|serde_json::to_value(s).map_err(|_|RuntimeError::Binding)).map_err(|_|"private session unavailable".into())
    }
''')
rel='apps/service/src/routes.rs'
replace(rel,'mod catalog;','mod catalog;\n#[cfg(windows)]\nmod local_workspaces;')
replace(rel,'    projects: Mutex<Option<veyra_adapters::projects::ProjectStore>>,','''    #[cfg(windows)]
    local_workspaces: Arc<local_workspaces::Runtime>,
    projects: Mutex<Option<veyra_adapters::projects::ProjectStore>>,''')
a=changed[rel].index('fn workspace_store(');z=changed[rel].index('\npub(crate) type Runtime',a)
changed[rel]=changed[rel][:a]+changed[rel][a:z]+'''#[cfg(windows)]
fn workspace_store_local(directory: &FsPath,original:Arc<dyn veyra_adapters::local_custody::OriginalStateGuardSource>) -> Result<veyra_adapters::projects::ProjectStore, String> {
    // Capture original OS/root custody BEFORE any migration or identity write.
    let custody=veyra_adapters::local_custody::LocalCustody::from_original_state(directory,original)?;
    let utility=directory.join("utility-operations");
    if utility.exists() {
        let original=custody.capture_related(&utility)?;
        for name in ["originals.db","originals.db-wal","originals.db-shm"] {
            let path=utility.join(name);
            if path.exists(){original.verify_private_file(&path)?;}
        }
    }
    // This is the ORIGINAL library/bootstrap owner, not a new account registry.
    let library=veyra_adapters::utility_operations::Store::open(directory)?.library_id()?;
    veyra_adapters::projects::ProjectStore::open_local(&directory.join("workspace.db"),custody,&library)
        .map_err(|_|"Local workspace custody refused; preserve the original state without reassignment".into())
}
''' + changed[rel][z:]
anchor='''    #[cfg(windows)]
    let app = app
        .route("/v1/tasks/{id}/activity", get(task_activity::read::get))'''
replace(rel,anchor,'''    #[cfg(windows)]
    let app = app
        .nest("/v1/local-workspaces",local_workspaces::router().route_layer(
            middleware::from_fn_with_state(state.clone(),interactive_terminal::admission)))
        .route("/v1/tasks/{id}/activity", get(task_activity::read::get))''')
a=changed[rel].index('async fn authenticate(');z=changed[rel].index('/// The engine receives',a)
section=changed[rel][a:z]
section=section.replace('    request: axum::extract::Request,','    mut request: axum::extract::Request,',1)
section=section.replace('    next.run(request).await','''    #[cfg(windows)]
    if request.uri().path()=="/v1/local-workspaces"||request.uri().path().starts_with("/v1/local-workspaces/"){
        request.extensions_mut().insert(local_workspaces::LocalRequest::from_existing_admission(&state));
    }
    next.run(request).await''',1)
changed[rel]=changed[rel][:a]+section+changed[rel][z:]
rel='apps/service/src/routes/state_startup/assembly.rs'
replace(rel,'            live_agent: Arc::new(live_agent::LiveAgent::new(&self.directory)),','''            live_agent: Arc::new(live_agent::LiveAgent::new(&self.directory)),
            #[cfg(windows)]
            local_workspaces: Arc::new(local_workspaces::Runtime::from_store(&parts.workspace)),''')
rel='apps/service/src/routes/workspace_retirement.rs'
anchor='''        #[cfg(windows)]
        state.task_activity.check_storage_closed_idle()?;'''
replace(rel,anchor,'''        #[cfg(windows)]
        {
            if !state.live_agent.credentials_stopped(){return Err("Private engine custody must retire before workspace originals".into());}
            state.local_workspaces.finish_until(self.deadline)?;
        }
''' + anchor)

rel='crates/adapters/src/projects/close.rs'
replace(rel,'let Self { connection } = self;','let Self { connection, local_custody, local_installation_id } = self;')
replace(rel,'Err((connection, error)) => Err((Self { connection }, bounded_reason(&error))),',
 'Err((connection, error)) => Err((Self { connection, local_custody, local_installation_id }, bounded_reason(&error))),')
rel='crates/adapters/src/task_workspaces.rs'
replace(rel,'mod task;','mod task;\nmod private;\npub use private::{PrivateRootCustody,NativeRootSeparation};')
rel='crates/adapters/src/task_workspaces/windows.rs'
replace(rel,'fn invoke(&mut self, destination: &mut Option<ManuallyDrop<File>>) -> Result<(), Error> {','''fn invoke(&mut self, destination: &mut Option<ManuallyDrop<File>>) -> Result<(), Error> {
        self.invoke_with_security(destination,false)
    }
    fn invoke_with_security(&mut self,destination:&mut Option<ManuallyDrop<File>>,security:bool)->Result<(),Error>{''')
replace(rel,'FILE_READ_ATTRIBUTES | FILE_TRAVERSE | 0x00100000,','FILE_READ_ATTRIBUTES | FILE_TRAVERSE | 0x00100000 | if security { 0x00020000 } else { 0 },')
anchor='    pub(super) fn acquire(&mut self, plans: &[Plan], deadline: Instant) -> Result<(), Error> {'
replace(rel,anchor,anchor+'''
        self.acquire_inner(plans,deadline,false)
    }
    pub(super) fn acquire_private(&mut self,plans:&[Plan],deadline:Instant)->Result<(),Error>{
        self.acquire_inner(plans,deadline,true)
    }
    fn acquire_inner(&mut self,plans:&[Plan],deadline:Instant,security:bool)->Result<(),Error>{''')
replace(rel,'node.open.invoke(&mut node.file)?;','''if security && name==plan.names.last().ok_or(Error::Path)?{
                    node.open.invoke_with_security(&mut node.file,true)?;
                }else{node.open.invoke(&mut node.file)?;}''')
anchor='    pub(super) fn never_invoked(&self) -> bool {'
replace(rel,anchor,'''    // These Win32 information calls are synchronous and have fixed stack
    // outputs. They never reset a retained NT acquisition/query deadline.
    pub(super) fn pinned_private_root(&self)->Result<(&File,(u64,[u8;16])),Error>{
        for node in &self.nodes{
            let file=node.file.as_deref().ok_or(Error::Unknown)?;
            let mut id:FILE_ID_INFO=unsafe{std::mem::zeroed()};
            let mut attributes:FILE_ATTRIBUTE_TAG_INFO=unsafe{std::mem::zeroed()};
            let handle=file.as_raw_handle().cast();
            if unsafe{GetFileInformationByHandleEx(handle,FileIdInfo,(&mut id as *mut FILE_ID_INFO).cast(),size_of::<FILE_ID_INFO>() as u32)}==0
                ||unsafe{GetFileInformationByHandleEx(handle,FileAttributeTagInfo,(&mut attributes as *mut FILE_ATTRIBUTE_TAG_INFO).cast(),size_of::<FILE_ATTRIBUTE_TAG_INFO>() as u32)}==0
                ||attributes.FileAttributes&FILE_ATTRIBUTE_REPARSE_POINT!=0
                ||attributes.FileAttributes&FILE_ATTRIBUTE_DIRECTORY==0
                ||node.identity!=Some(Identity(id.VolumeSerialNumber,id.FileId.Identifier))
            {return Err(Error::Unknown);}
        }
        self.private_root()
    }
'''+anchor)

replace(rel,anchor,'''    pub(super) fn private_root(&self)->Result<(&File,(u64,[u8;16])),Error>{
        let index=*self.chains.first().ok_or(Error::Unknown)?.1.last().ok_or(Error::Unknown)?;
        let node=self.nodes.get(index).ok_or(Error::Unknown)?;
        let id=node.identity.ok_or(Error::Unknown)?;
        Ok((node.file.as_deref().ok_or(Error::Unknown)?,(id.0,id.1)))
    }
'''+anchor)
rel='crates/adapters/src/service_registration/guards/native.rs'
anchor="impl<'g> ServiceGuardDirectory<'g> {"
replace(rel,anchor,anchor+'''
    /// Actual original guard identity and process SID; no path reopen or clone.
    pub fn local_custody_observation(&self,root:&std::path::Path)->Result<crate::local_custody::LocalStateObservation,String>{
        let prepared=self.guard.prepared.as_ref().ok_or("Original native preparation unavailable")?;
        if prepared.directory!=root{return Err("Original state spelling changed".into());}
        let (file,identity)=self.original_directory().map_err(|_|"Original native directory unavailable")?;
        crate::windows_acl::verify_owner_only(file,crate::windows_acl::ProtectedAclKind::Directory)?;
        Ok(crate::local_custody::LocalStateObservation{
            subject:crate::windows_acl::owner_sid()?,
            physical:serde_json::to_string(&identity).map_err(|_|"Original native identity unavailable")?,
        })
    }
''')
rel='apps/service/src/routes/state_startup.rs'
replace(rel,'mod effects;','mod effects;\n#[cfg(windows)]\nmod local_custody;')
replace(rel,'let _same_original_guards = guards;\n        let effects = ProductionStateStartupEffects::without_task_storage();',
 'let effects = ProductionStateStartupEffects::with_local_custody(guards);')
rel='apps/service/src/routes/state_startup/effects.rs'
replace(rel,'pub(super) struct ProductionStateStartupEffects {','''pub(super) struct ProductionStateStartupEffects {
    #[cfg(windows)]
    local_custody: Option<Arc<super::local_custody::OriginalStateGuard>>,''')
replace(rel,'            task_storage: None,','            task_storage: None,\n            #[cfg(windows)]\n            local_custody: None,')
replace(rel,'impl ProductionStateStartupEffects {','''impl ProductionStateStartupEffects {
    #[cfg(windows)]
    pub(super) fn with_local_custody(guards:Arc<crate::server::guard_reader::GuardOriginal<veyra_adapters::service_registration::ServiceGuards>>)->Self{
        Self{task_storage:None,local_custody:Some(super::local_custody::OriginalStateGuard::new(guards))}
    }
''')
replace(rel,'            task_storage: Some(super::task_storage::TaskStorageStartup::prepare(','''            local_custody: Some(super::local_custody::OriginalStateGuard::new(guards.clone())),
            task_storage: Some(super::task_storage::TaskStorageStartup::prepare(''')
replace(rel,'        workspace_store(directory)','''        #[cfg(windows)]
        if let Some(original)=&self.local_custody{
            return workspace_store_local(directory,original.clone());
        }
        // Explicit unenrolled Source/legacy constructor remains version5.
        workspace_store(directory)''')
rel='apps/service/src/routes/state_startup/legacy.rs'
replace(rel,'let workspace = effects.workspace(directory)?;','let workspace = workspace_store(directory)?;')


# Namespace checks precede NEW grants only; retained originals remain read-only.
rel='crates/adapters/src/projects.rs'
replace(rel,'        validate_draft(&canonical)?;','''        validate_draft(&canonical)?;
        if self.lookup_creation(&id,original)?.is_none(){
            self.require_private_namespace_separation(&canonical.environment,&canonical.primary_root,&canonical.roots)?;
        }''')
replace(rel,'        check_update(&self.get(id)?, expected_revision, name, pinned, archived).map(|_| ())','''        let current=self.get(id)?;
        if current.archived&&archived==Some(false){
            self.require_private_namespace_separation(&current.environment,&current.primary_root,&current.roots)?;
        }
        check_update(&current, expected_revision, name, pinned, archived).map(|_| ())''')
anchor='''        if name.is_none() && pinned.is_none() && archived.is_none() {
            return Err(StoreError::Invalid);
        }
        let transaction = self'''
replace(rel,anchor,'''        if name.is_none() && pinned.is_none() && archived.is_none() {
            return Err(StoreError::Invalid);
        }
        let current=self.get(&id)?;
        if current.archived&&archived==Some(false){
            self.require_private_namespace_separation(&current.environment,&current.primary_root,&current.roots)?;
        }
        let transaction = self''')
rel='crates/adapters/src/projects/configuration.rs'
anchor='''        let tx = self
            .connection
            .transaction_with_behavior(TransactionBehavior::Immediate)?;
        let existing = read(&tx, &original.request_id)?.ok_or(StoreError::NotFound)?;'''
replace(rel,anchor,'''        if resolved.as_ref()==Some(resolved_destination){
            self.require_private_namespace_separation(&resolved_destination.environment,&resolved_destination.primary_root,&resolved_destination.roots)?;
        }
'''+anchor)
# Existing project metadata stays readable in locally enrolled v6. Unenrolled
# writers still target5 and cannot migrate/open6 or fabricate a custodian.
rel='crates/adapters/src/projects/presentation.rs'
replace(rel,'if super::schema_version(connection)? != super::SCHEMA_VERSION {',
 'if ![super::SCHEMA_VERSION,6].contains(&super::schema_version(connection)?) {')
for rel,prefix in [('crates/adapters/src/projects/saved_metadata_search.rs','super::'),
 ('crates/adapters/src/projects/presentation/task_names/saved_metadata.rs','super::super::super::')]:
 replace(rel,'if version > '+prefix+'SCHEMA_VERSION {','if version > 6 {')
 replace(rel,'if version != '+prefix+'SCHEMA_VERSION {','if !['+prefix+'SCHEMA_VERSION,6].contains(&version) {')
rel='crates/adapters/src/wsl_workspace.rs'
anchor='''fn request_internal(
    project: &Project,
    operation: &str,
    args: Value,
    capture_save_errors: bool,
    guard: &dyn Fn() -> bool,
) -> Result<Value, Error> {'''
replace(rel,anchor,anchor+'''
    // Old Project-granted facades cannot invoke the separately typed local owner.
    if operation=="local_private"{return Err(Error::Invalid);}
''')

# Preserve explicit unenrolled metadata fixtures without manufacturing OS custody.
import re
for rel in expected:
 if rel.startswith('crates/adapters/src/projects/') and ('/tests.rs' in rel or '/test_support/' in rel):
  changed[rel]=re.sub(r'ProjectStore \{(\s*)(connection(?=\s*[:,}]))',
   r'ProjectStore {\1local_custody: None, local_installation_id: None,\1\2',changed[rel])

# The original remote authority/allowlist is byte-identical; no change is emitted.
assert changed['apps/service/src/routes/remote_control/proxy.rs']==original['apps/service/src/routes/remote_control/proxy.rs']
patch=[];proof=[]
for rel,before in original.items():
 after=changed[rel]
 proof.append({'path':rel,'baseBlob':expected[rel],'proposedSha256':hashlib.sha256(after.encode()).hexdigest(),'changed':before!=after})
 if before!=after:patch.extend(difflib.unified_diff(before.splitlines(keepends=True),after.splitlines(keepends=True),fromfile='a/'+rel,tofile='b/'+rel))
(owned/'integration.patch').write_text(''.join(patch))
new=[]
for file in sorted((owned/'sources').rglob('*')):
 if file.is_file():
  rel=str(file.relative_to(owned/'sources'))
  if (native/rel).exists():raise RuntimeError('new source collides with original: '+rel)
  new.append({'path':rel,'bytes':file.stat().st_size,'sha256':hashlib.sha256(file.read_bytes()).hexdigest()})
(owned/'proposal.json').write_text(json.dumps({'nativeTree':'a04ab38bd0e0c7b96f40689733cad3f2332b9a0b','nativeSchemaAllocation':6,'nodeMigrationsChanged':False,'existingInputs':proof,'canonicalNewSources':new,'integrationPatchSha256':hashlib.sha256((owned/'integration.patch').read_bytes()).hexdigest(),'nativeCheckoutWritten':False,'applied':False,'compiled':False,'runtimeOrStateMigrationRun':False},indent=2)+'\n')
print(json.dumps({'existingDeltas':sum(v['changed'] for v in proof),'canonicalNewFiles':len(new),'patchBytes':(owned/'integration.patch').stat().st_size}))
