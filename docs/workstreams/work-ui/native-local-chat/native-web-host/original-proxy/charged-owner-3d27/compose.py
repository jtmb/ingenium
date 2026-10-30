"""Exact source-only proposal. Never writes Native or applies the patch.
python3 -B compose.py --native <windows-source>
Writes integration.patch + inputs.json + review.json beside this recipe.
"""
import argparse,difflib,hashlib,json
from pathlib import Path
p=argparse.ArgumentParser();p.add_argument('--native',type=Path,required=True);a=p.parse_args()
root=Path(__file__).resolve().parent
pin_file=root/'inputs.json'
pins=json.loads(pin_file.read_text()) if pin_file.exists() else {}
pre={};post={}
def read(path):
 raw=(a.native/path).read_bytes();pre[path]=raw
 if path in pins:assert hashlib.sha256(raw).hexdigest()==pins[path]['preimage_sha256'],('Native preimage drift; retain proposal, do not overwrite pins',path)
 assert b'\r' not in raw,path
 post[path]=raw.decode();return post[path]
def replace(path,old,new,count=1):
 if path not in post:read(path)
 assert post[path].count(old)==count,(path,old,post[path].count(old))
 post[path]=post[path].replace(old,new)
def add(path,source):
 assert not (a.native/path).exists(),path
 pre[path]=b'';post[path]=(root/source).read_text()
lib='crates/adapters/src/lib.rs'
replace(lib,'pub mod local_custody;','pub mod local_custody;\npub mod native_web_payload;')
add('crates/adapters/src/native_web_payload.rs','native_web_payload.rs')
base='crates/adapters/src/opencode/desktop_runtime'
original=base+'/local_workspaces/web_original.rs'
replace(original,'pub struct NativeWebOriginal {','mod intake;\npub use intake::NativeWebIntake;\nuse crate::native_web_payload::Payload;\npub struct NativeWebOriginal {')
add(base+'/local_workspaces/web_original/intake.rs','intake.rs')
replace(original,'target: &str, headers: &[(String, String)], body: Vec<u8>,','target: &str, headers: &[(String, String)], intake: NativeWebIntake,')
replace(original,'let captured = NativeWebOriginal::capture(lease, method, target, headers, body)?;','let body=self.take_local_web_intake(lease,intake)?;\n        let captured = NativeWebOriginal::capture(lease, method, target, headers, body)?;')
replace(original,'body:Arc<[u8]>','body:Payload')
replace(original,'headers: &[(String, String)], body: Vec<u8>)','headers: &[(String, String)], body: Payload)')
replace(original,'body:Arc::from(body)','body')
replace(original,'fn body_owner(&self)->Arc<[u8]>','fn body_owner(&self)->Payload')
replace(original,'let metadata = serde_json::to_vec(&(&lease.original, method.as_str(), target,\n            &route, &query, &content)).map_err(|_| RuntimeError::Storage)?;',
 'let metadata = crate::native_web_payload::json_payload(body.pool(),&(&lease.original, method.as_str(), target,\n            &route, &query, &content)).map_err(|_| RuntimeError::Storage)?;')
start=post[original].index('    pub fn journal_original(&self) -> Value {')
end=post[original].index('    pub fn journal_scope(&self) -> Value {',start)
post[original]=post[original][:start]+post[original][end:] # unused full-byte JSON escape
runtime=base+'.rs'
replace(runtime,'LocalWebLease, NativeWebOriginal,','LocalWebLease, NativeWebIntake, NativeWebOriginal,')
completion=base+'/local_workspaces/web_completion.rs'
replace(completion,'#[derive(Default)]\npub struct NativeWebCompletions{slots:Mutex<BTreeMap<String,Arc<NativeWebSendSlot>>>,generation:Arc<NativeWebRegistryOriginal>}',
 'pub struct NativeWebCompletions{slots:Mutex<BTreeMap<String,Arc<NativeWebSendSlot>>>,generation:Arc<NativeWebRegistryOriginal>,pub(crate) payload_pool:Arc<crate::native_web_payload::Pool>}\nimpl Default for NativeWebCompletions{fn default()->Self{Self{slots:Mutex::new(BTreeMap::new()),generation:Arc::new(NativeWebRegistryOriginal::default()),payload_pool:crate::native_web_payload::Pool::for_registry()}}}')
replace(completion,'impl NativeWebCompletions{','impl NativeWebCompletions{\n pub fn reserve_history_page(&self)->crate::projects::NativeWebPageRead{crate::projects::NativeWebPageRead::for_registry(self.payload_pool.clone())}')
material=base+'/local_workspaces/web_materialization.rs'
replace(material,'use serde::{Serialize,Deserialize};','use serde::{Serialize,Deserialize};\nuse crate::native_web_payload::{Payload,json_payload};')
replace(material,'bytes:Arc<[u8]>','bytes:Payload')
replace(material,'fn bytes_owner(&self)->Arc<[u8]>','fn bytes_owner(&self)->Payload')
replace(material,'original:&[u8],resolved:','original:&Payload,resolved:')
replace(material,'original:&[u8],replacements:','original:&Payload,replacements:')
replace(material,'let mut effective=Vec::new();let mut last=0;',
 'let capacity=edits.iter().try_fold(original.len(),|n,(span,literal)|n.checked_sub(span.len()).and_then(|n|n.checked_add(literal.len()))).ok_or_else(invalid)?;\n    let mut effective=original.pool().allocate(capacity.max(1)).map_err(|_|invalid())?;let mut last=0;')
replace(material,'effective.extend_from_slice(&original[last..span.start]);effective.extend_from_slice(&literal);last=span.end;',
 'effective.append(&original[last..span.start]).map_err(|_|invalid())?;effective.append(literal.as_ref()).map_err(|_|invalid())?;last=span.end;')
replace(material,'effective.extend_from_slice(&original[last..]);','effective.append(&original[last..]).map_err(|_|invalid())?;')
replace(material,'bytes:Arc::from(effective)','bytes:effective.freeze()')
replace(material,'let literal=serde_json::to_vec(&replacement.effective_uri).map_err(|_|invalid())?;',
 'let literal=json_payload(original.pool(),&replacement.effective_uri).map_err(|_|invalid())?;')
replace(material,'let mut insertion=if *comma{b",\\\"name\\\":".to_vec()}else{b"\\\"name\\\":".to_vec()};\n            insertion.extend_from_slice(&serde_json::to_vec(name).map_err(|_|invalid())?);\n            edits.push((*end..*end,insertion));',
 'let prefix=if *comma{b",\\\"name\\\":".as_slice()}else{b"\\\"name\\\":".as_slice()};\n            let literal=json_payload(original.pool(),name).map_err(|_|invalid())?;\n            let mut insertion=original.pool().allocate(prefix.len()+literal.len()).map_err(|_|invalid())?;\n            insertion.append(prefix).map_err(|_|invalid())?;insertion.append(literal.as_ref()).map_err(|_|invalid())?;\n            edits.push((*end..*end,insertion.freeze()));')
# Existing finite transformation fixtures get explicitly test-only charged input.
replace(material,'use super::*;\n    fn replacement','use super::*;\n    fn charged(raw:&[u8])->Payload{let pool=crate::native_web_payload::Pool::for_registry();let mut b=pool.allocate(raw.len().max(1)).unwrap();b.append(raw).unwrap();b.freeze()}\n    fn replacement')
post[material]=post[material].replace('materialize_web_uri_spans(raw,','materialize_web_uri_spans(&charged(raw),')
for raw in ['br#"{\"files\":[{\"uri\":\"file:///wrong\"}]}"#','br#"{\"files\":[{\"uri\":\"file:///private/a\",\"name\":\"original\"}]}"#']:
 post[material]=post[material].replace('materialize_web_uri_spans('+raw+',','materialize_web_uri_spans(&charged('+raw+'),')
fileinput=base+'/local_workspaces/web_file_input.rs'
replace(fileinput,'materialize_resolved_web_files(original.body(),s)','materialize_resolved_web_files(&original.body_owner(),s)')
transport='crates/adapters/src/opencode/local_web_transport.rs'
replace(transport,'use std::sync::Arc;','use std::sync::Arc;\nuse crate::native_web_payload::{Buffer,Payload};')
replace(transport,'pub body:Vec<u8>','pub body:Buffer')
replace(transport,'effective_body:Arc<[u8]>','effective_body:Payload')
replace(transport,'let length=effective_body.len() as u64;','let mut body=effective_body.pool().allocate(LIMIT+1).map_err(|_|EngineError::Transport)?;\n  let length=effective_body.len() as u64;')
replace(transport,'std::io::Cursor::new(effective_body)','effective_body.cursor()')
replace(transport,'let mut body=Vec::new();body.try_reserve_exact(LIMIT+1).map_err(|_|EngineError::Transport)?;','')
replace(transport,'let mut chunk=[0u8;8192];','')
replace(transport,'match response.read(&mut chunk[..remaining.min(8192)]){','match observed.body.read_once(response,remaining.min(8192)){')
replace(transport,'Ok(count)=>observed.body.extend_from_slice(&chunk[..count]),','Ok(_count)=>{},')
post[transport]+='\n#[cfg(test)]fn fixture_payload(raw:&[u8])->Payload{let p=crate::native_web_payload::Pool::for_registry();let mut b=p.allocate(raw.len().max(1)).unwrap();b.append(raw).unwrap();b.freeze()}\n'
post[transport]=post[transport].replace('Arc::from(&b"{}"[..])','fixture_payload(b"{}")').replace('let expected:Arc<[u8]>=Arc::from(','let expected:Payload=fixture_payload(')
post[transport]=post[transport].replace('assert_eq!(owned.observation.body,','assert_eq!(owned.observation.body.as_ref(),').replace('assert_eq!(request.observation.body,','assert_eq!(request.observation.body.as_ref(),')
replace(transport,'assert!(Arc::strong_count(&expected)>=2,"prepared actual reader must retain shared original bytes");',
 'assert!(expected.owner_count()>=2,"prepared actual reader must retain the same charged allocation");')
closure='crates/adapters/src/opencode/local_web_transport/closure.rs'
replace(closure,'Arc::from(&b"{}"[..])','fixture_payload(b"{}")')
replace(closure,'assert_eq!(observed.body,b"{}");','assert_eq!(observed.body.as_ref(),b"{}");')
replace(closure,'body:Vec::new(),phase:','body:crate::native_web_payload::Pool::for_registry().allocate(1).unwrap(),phase:')
projects='crates/adapters/src/projects/local_web_originals.rs'
read(projects)
start=post[projects].index('    pub fn read_native_web_acknowledgement(')
end=post[projects].index('    /// Exact actual response',start)
post[projects]=post[projects][:start]+post[projects][end:]
post[projects]='mod acknowledgement_page;\npub use acknowledgement_page::{NativeWebAcknowledgementPage,NativeWebPageRead};\n'+post[projects]
add('crates/adapters/src/projects/local_web_originals/acknowledgement_page.rs','acknowledgement_page.rs')
replace('crates/adapters/src/projects.rs','pub use local_web_originals::{','pub use local_web_originals::{NativeWebAcknowledgementPage,NativeWebPageRead,')
live='apps/service/src/routes/live_agent.rs'
replace(live,'headers:&[(String,String)],body:Vec<u8>,','headers:&[(String,String)],body:veyra_adapters::opencode::desktop_runtime::NativeWebIntake,')
replace(live,'    pub(super) fn capture_local_web_request',
 '    pub(super) fn begin_local_web_intake(&self,lease:&veyra_adapters::opencode::desktop_runtime::LocalWebLease,current:&dyn Fn()->Result<(),String>)->Result<veyra_adapters::opencode::desktop_runtime::NativeWebIntake,String>{self.runtime.begin_local_web_intake(lease,current).map_err(|_|"Original charged intake refused".into())}\n    pub(super) fn capture_local_web_request')
service='apps/service/src/routes/local_workspaces/web_original.rs'
replace(service,'content_headers: &[(String,String)], body: Vec<u8>,','content_headers: &[(String,String)], body: veyra_adapters::opencode::desktop_runtime::NativeWebIntake,')
replace(service,'pub(super) struct WebPending {registry:Mutex<Option<Arc<veyra_adapters::opencode::desktop_runtime::NativeWebCompletions>>>}',
 'pub(super) struct WebPending {registry:Mutex<Option<Arc<veyra_adapters::opencode::desktop_runtime::NativeWebCompletions>>>,pages:Mutex<Vec<Arc<page_response::PageWork>>>}')
replace(service,' pub(super) fn check_empty(&self)->Result<(),String>{',
 ' pub(super) fn check_empty(&self)->Result<(),String>{\n  page_response::reconcile_abandoned(self)?;\n  if !self.pages.lock().map_err(|_|"Original page registry poisoned")?.is_empty(){return Err("Actual page worker ownership retained".into())}')
replace(service,' pub(super) fn flush(&self,service:&ServiceState,deadline:Instant)->Result<(),String>{',
 ' pub(super) fn flush(&self,service:&ServiceState,deadline:Instant)->Result<(),String>{\n  page_response::reconcile_abandoned(self)?;')
# The response worker/Body composition is supplied as concrete source separately.
post[service]='mod scoped_intake;\nmod page_response;\nmod retained_page_worker;\n'+post[service]
add('apps/service/src/routes/local_workspaces/web_original/scoped_intake.rs','service_scoped_intake.rs')
add('apps/service/src/routes/local_workspaces/web_original/retained_page_worker.rs','retained_page_worker.rs')
add('apps/service/src/routes/local_workspaces/web_original/page_response.rs','service_page_response.rs')
replace(service,'Result<NativeWebAcknowledgement,String>','Result<axum::response::Response,String>')
replace(service,'    tokio::task::spawn_blocking(move||{','    let response_state=state.clone();let response_binding=binding.clone();let response_lease=lease.clone();\n    let operation=tokio::task::spawn_blocking(move||{')
start=post[service].index('            let writer=state.projects.try_lock()',post[service].index('if let Some(retained)=retained{'))
end=post[service].index('\n        }',start)
post[service]=post[service][:start]+'            return Ok(retained.request_id);'+post[service][end:]
start=post[service].index('        let writer=state.projects.try_lock()',post[service].index('let settled_operation=match result{'))
end=post[service].index('\n    }).await',start)
post[service]=post[service][:start]+'        Ok(settled_operation)'+post[service][end:]
replace(service,'}).await.map_err(|_|"Original Web worker ended; preserve original uncertainty")?',
 '}).await.map_err(|_|"Original Web worker ended; preserve original uncertainty")??;\n    page_response::response_for_operation(response_state,response_binding,response_lease,operation).await')
# Do NOT add a public router/auth fake. Root must bind the actual child producer.
patch=[]
for path,new in post.items():post[path]=''.join(line.rstrip(' \t\r\n')+'\n' for line in new.splitlines())
for path,new in post.items():
 old=pre[path].decode()
 patch.extend(difflib.unified_diff(old.splitlines(True),new.splitlines(True),fromfile=('a/'+path if old else '/dev/null'),tofile='b/'+path,n=0))
data=''.join(patch).encode();(root/'integration.patch').write_bytes(data)
inputs={path:{'preimage_sha256':hashlib.sha256(raw).hexdigest(),'proposed_sha256':hashlib.sha256(post[path].encode()).hexdigest(),'new':not raw}for path,raw in pre.items()}
(root/'inputs.json').write_text(json.dumps(inputs,indent=2)+'\n')
print(json.dumps({'paths':len(post),'patch_bytes':len(data),'patch_sha256':hashlib.sha256(data).hexdigest()}))
