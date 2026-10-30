//! Scoped original Web input materialization. No public positive constructor,
//! Deserialize, raw-path permit, data fabrication, or request reserialization.
use super::*;
use crate::local_execution::LocalWorkspaceBinding;
use crate::opencode::EngineSession;
use serde_json::{Value,json};
use veyra_contracts::local_workspaces::{LocalEnvironment,LocalWorkspaceOwner};

pub struct NativeWebFileReplacement{
 pointer:String,original_uri:String,effective_uri:String,fallback_name:Option<String>,
 source_sha256:String,effective_sha256:String,source_bytes:Vec<u8>,identity:Value,
 start:Option<usize>,end:Option<usize>,
}
impl NativeWebFileReplacement{
 pub fn json_pointer(&self)->&str{&self.pointer}
 pub fn original_uri(&self)->&str{&self.original_uri}
 pub fn effective_uri(&self)->&str{&self.effective_uri}
 pub fn fallback_name(&self)->Option<&str>{self.fallback_name.as_deref()}
}
/// This binds actual captured bytes to the original input. It is not a send
/// permit. The caller MUST hold the retained OwnedEngine lock, re-observe its
/// lease/saved session and current ProjectStore ownership at resolve + dispatch.
/// Root's allocation7 journal records original + mapping before single dispatch.
pub struct NativeWebFilesOriginal{
 owner:LocalWorkspaceOwner,directory:String,session_id:String,project_id:String,
 operation_id:String,input_sha256:String,prompt_view_sha256:String,
 replacements:Vec<NativeWebFileReplacement>,contains_image:bool,
}
impl NativeWebFilesOriginal{
 pub fn replacements(&self)->&[NativeWebFileReplacement]{&self.replacements}
 pub fn contains_image(&self)->bool{self.contains_image}
 pub fn check_current(&self,binding:&LocalWorkspaceBinding,session_id:&str,operation_id:&str,input_sha256:&str,current:&dyn Fn()->Result<(),String>)->Result<(),String>{
  current()?;binding.verify()?;
  if binding.owner()!=&self.owner||binding.directory()!=self.directory||session_id!=self.session_id||operation_id!=self.operation_id||input_sha256!=self.input_sha256{return Err("Web file original binding changed".into());}
  current()
 }
 /// Private original-writer projection only. Exact source/effective bytes and
 /// original URI/name/range provenance survive separately from forwarded bytes.
 pub fn journal_original(&self)->Value{
  json!({"kind":"native-web-files-original-v1","owner":self.owner,"directory":self.directory,"session_id":self.session_id,"project_id":self.project_id,
   "operation_id":self.operation_id,"original_input_sha256":self.input_sha256,"prompt_view_sha256":self.prompt_view_sha256,
   "contains_image":self.contains_image,"files":self.replacements.iter().map(|f|json!({"pointer":f.pointer,"original_uri":f.original_uri,"effective_uri":f.effective_uri,"fallback_name":f.fallback_name,
    "source_sha256":f.source_sha256,"effective_sha256":f.effective_sha256,"source_bytes_base64":STANDARD.encode(&f.source_bytes),"source_identity":f.identity,"start":f.start,"end":f.end})).collect::<Vec<_>>()})
 }
}
fn hash(bytes:&[u8])->String{format!("{:x}",Sha256::digest(bytes))}
fn unavailable()->String{"Original scoped Web files unavailable".into()}
fn valid_hash(value:&str)->bool{value.len()==64&&value.bytes().all(|b|b.is_ascii_digit()||(b'a'..=b'f').contains(&b))}
fn valid_operation(value:&str)->bool{uuid::Uuid::parse_str(value).is_ok_and(|v|!v.is_nil()&&v.to_string()==value)}
fn percent_path(value:&str)->Result<String,String>{
 let bytes=value.as_bytes();let mut out=Vec::new();let mut i=0;
 while i<bytes.len(){
  if bytes[i]==b'%' {
   let a=*bytes.get(i+1).ok_or_else(unavailable)?;let b=*bytes.get(i+2).ok_or_else(unavailable)?;
   let digit=|v:u8|->Option<u8>{match v{b'0'..=b'9'=>Some(v-b'0'),b'a'..=b'f'=>Some(v-b'a'+10),b'A'..=b'F'=>Some(v-b'A'+10),_=>None}};
   let value=digit(a).ok_or_else(unavailable)?*16+digit(b).ok_or_else(unavailable)?;
   if matches!(value,b'/'|b'\\'|0){return Err(unavailable());}out.push(value);i+=3;
  }else{out.push(bytes[i]);i+=1;}
 }
 String::from_utf8(out).map_err(|_|unavailable())
}
struct FileTarget{parts:Vec<String>,basename:String,start:Option<usize>,end:Option<usize>}
fn file_target(uri:&str,directory:&str,environment:&LocalEnvironment)->Result<FileTarget,String>{
 if uri.len()>16384||!uri.starts_with("file://")||uri.contains('#')||uri.chars().any(|c|c.is_control()||c=='\\'){return Err(unavailable());}
 let url=reqwest::Url::parse(uri).map_err(|_|unavailable())?;
 if url.scheme()!="file"||url.host_str().is_some_and(|h|h!="localhost")||!url.username().is_empty()||url.password().is_some()||url.port().is_some(){return Err(unavailable());}
 // Reject original dot components BEFORE Url can normalize them away.
 let raw_path=uri.strip_prefix("file://").ok_or_else(unavailable)?.split('?').next().ok_or_else(unavailable)?;
 let original=percent_path(raw_path)?;
 if original.split('/').any(|v|v=="."||v==".."){return Err(unavailable());}
 let decoded=percent_path(url.path())?;
 let mut start=None;let mut end=None;let mut seen=Vec::new();
 for (key,value) in url.query_pairs(){
  if !["start","end"].contains(&key.as_ref())||seen.contains(&key.to_string()){return Err(unavailable());}seen.push(key.to_string());
  let n=value.parse::<u64>().ok().filter(|n|*n>0&&*n<=9_007_199_254_740_991).and_then(|n|usize::try_from(n).ok()).ok_or_else(unavailable)?;
  if key=="start"{start=Some(n);}else{end=Some(n);}
 }
 let windows=matches!(environment,LocalEnvironment::Windows);
 let (target,root)=if windows{
  // UNC/network volumes remain an explicit compatibility gate; actual private
  // custody is pinned to qualified local HarddiskVolume roots only.
  let target=decoded.strip_prefix('/').unwrap_or(&decoded);
  if target.as_bytes().get(1)!=Some(&b':')||!target.as_bytes()[0].is_ascii_alphabetic()||directory.as_bytes().get(1)!=Some(&b':'){return Err(unavailable());}
  (target.replace('\\',"/"),directory.replace('\\',"/"))
 }else{
  if !decoded.starts_with('/')||!directory.starts_with('/')||decoded.contains('\\'){return Err(unavailable());}
  (decoded,directory.into())
 };
 let split=|v:&str|v.split('/').filter(|s|!s.is_empty()).map(str::to_owned).collect::<Vec<_>>();
 let target=split(&target);let root=split(root.trim_end_matches('/'));
 if root.is_empty()||target.len()<=root.len()||!target.iter().zip(&root).all(|(a,b)|if windows{a.eq_ignore_ascii_case(b)}else{a==b}){return Err(unavailable());}
 let parts=target[root.len()..].to_vec();
 if parts.len()>128||parts.iter().any(|p|p.is_empty()||p=="."||p==".."||p.len()>255||p.chars().any(char::is_control)
  ||(windows&&(p.contains(':')||(p.ends_with('.')||p.ends_with(' '))||p.split('.').next().is_some_and(|v|["CON","PRN","AUX","NUL","COM1","COM2","COM3","COM4","COM5","COM6","COM7","COM8","COM9","LPT1","LPT2","LPT3","LPT4","LPT5","LPT6","LPT7","LPT8","LPT9"].iter().any(|r|v.eq_ignore_ascii_case(r)))))){return Err(unavailable());}
 let basename=parts.last().ok_or_else(unavailable)?.clone();Ok(FileTarget{parts,basename,start,end})
}
fn selected_text(bytes:&[u8],start:Option<usize>,end:Option<usize>)->Result<Vec<u8>,String>{
 let Some(start)=start else{return Ok(bytes.to_vec());};
 let text=std::str::from_utf8(bytes).map_err(|_|unavailable())?;
 // Exact pinned Buffer.toString('utf8').split('\n').slice(start-1,end).join('\n')
 // for already validated UTF8 text, retaining CR and trailing empty line.
 Ok(text.split('\n').enumerate().filter(|(i,_)|*i>=start-1&&end.is_none_or(|end|*i<end)).map(|(_,line)|line).collect::<Vec<_>>().join("\n").into_bytes())
}
fn mention(file:&Value,text:&str)->Result<(),String>{
 if let Some(v)=file.get("mention"){
  let start=v.get("start").and_then(Value::as_u64).ok_or_else(unavailable)?;
  let end=v.get("end").and_then(Value::as_u64).ok_or_else(unavailable)?;
  if start>end||end>text.encode_utf16().count() as u64||v.get("text").and_then(Value::as_str).is_none(){return Err(unavailable());}
 }Ok(())
}
/// Call ONLY under Work1's actual retained OwnedEngine and saved-session lease.
/// `current` rechecks the actual ProjectStore owner AND saved local session.
/// A caller-supplied path/session/JSON alone cannot mint a positive capture.
pub fn resolve_local_web_files(binding:&LocalWorkspaceBinding,session:&EngineSession,operation_id:&str,original_input_sha256:&str,full_prompt:&Value,current:&dyn Fn()->Result<(),String>)->Result<NativeWebFilesOriginal,String>{
 current()?;binding.verify()?;
 if session.id.is_empty()||session.location.directory!=binding.directory()||session.project_id.is_empty()||!valid_operation(operation_id)||!valid_hash(original_input_sha256){return Err(unavailable());}
 let object=full_prompt.as_object().ok_or_else(unavailable)?;let text=object.get("text").and_then(Value::as_str).ok_or_else(unavailable)?;
 let files=object.get("files").map(|v|v.as_array().ok_or_else(unavailable)).transpose()?;
 let files=files.map(Vec::as_slice).unwrap_or(&[]);
 if files.len()>MAX_PROMPT_ATTACHMENTS{return Err(unavailable());}
 let mut replacements=Vec::new();let mut total=0usize;let mut contains_image=false;
 for (index,file) in files.iter().enumerate(){
  current()?;binding.verify()?;mention(file,text)?;
  let uri=file.get("uri").and_then(Value::as_str).ok_or_else(unavailable)?;
  if let Some(name)=file.get("name"){if !name.as_str().is_some_and(valid_name){return Err(unavailable());}}
  if let Some(description)=file.get("description"){if !description.is_string(){return Err(unavailable());}}
  let (source,identity,target)=if uri.starts_with("data:"){
   let (_,bytes)=decode_data_uri(uri).ok_or_else(unavailable)?;
   (bytes,json!({"kind":"original-inline-bytes"}),None)
  }else{
   let target=file_target(uri,binding.directory(),&binding.owner().environment)?;
   let captured=binding.capture_web_file(&target.parts,MAX_PROMPT_BYTES.saturating_sub(total),current)?;
   (captured.bytes,captured.identity,Some(target))
  };
  let (mime,_)=crate::attachments::sniff_for_prompt(&source).map_err(|_|"Web file MIME/bounds unsupported")?;
  total=total.checked_add(source.len()).filter(|n|*n<=MAX_PROMPT_BYTES).ok_or_else(unavailable)?;
  contains_image|=mime.starts_with("image/");
  let effective=if mime=="text/plain"{selected_text(&source,target.as_ref().and_then(|v|v.start),target.as_ref().and_then(|v|v.end))?}else{source.clone()};
  let effective_uri=if target.is_some(){format!("data:{mime};base64,{}",STANDARD.encode(&effective))}else{uri.into()};
  // Identity mappings for actual inline bytes are retained too; no replacement
  // is needed but their bytes/MIME/vision limit are still checked and journaled.
  replacements.push(NativeWebFileReplacement{pointer:format!("/files/{index}/uri"),original_uri:uri.into(),effective_uri,
   fallback_name:if file.get("name").is_none(){target.as_ref().map(|v|v.basename.clone())}else{None},
   source_sha256:hash(&source),effective_sha256:hash(&effective),source_bytes:source,identity,
   start:target.as_ref().and_then(|v|v.start),end:target.as_ref().and_then(|v|v.end)});
 }
 let result=NativeWebFilesOriginal{owner:binding.owner().clone(),directory:binding.directory().into(),session_id:session.id.clone(),project_id:session.project_id.clone(),operation_id:operation_id.into(),input_sha256:original_input_sha256.into(),prompt_view_sha256:hash(&serde_json::to_vec(full_prompt).map_err(|_|unavailable())?),replacements,contains_image};
 result.check_current(binding,&session.id,operation_id,original_input_sha256,current)?;Ok(result)
}
#[cfg(test)]
mod tests{
 use super::*;
 #[test]fn scope_and_platform_parsing_is_not_a_path_permit(){
  let wsl=LocalEnvironment::Wsl{distro:"Ubuntu".into(),user:"actual".into()};
  assert_eq!(file_target("file:///private/a%20b.rs?start=2&end=3","/private",&wsl).unwrap().parts,vec!["a b.rs"]);
  for uri in ["file:///private2/a","file:///private/../escape","file:///private/%2e%2e/escape","file:///private/a%2fb","file://server/share/a","file:///private/a?start=0","file:///private/a?start=1&start=2","https://host/a"]{assert!(file_target(uri,"/private",&wsl).is_err(),"{uri}");}
  assert_eq!(file_target("file:///C:/private/sub/a.rs","C:\\private",&LocalEnvironment::Windows).unwrap().parts,vec!["sub","a.rs"]);
  for uri in ["file:///C:/private/a:stream","file:///C:/private/NUL","file:///C:/private/a.","file:///D:/private/a"]{assert!(file_target(uri,"C:\\private",&LocalEnvironment::Windows).is_err(),"{uri}");}
 }
 #[test]fn selection_is_exact_pinned_text_slice(){
  assert_eq!(selected_text(b"a\r\nb\r\nc\n",Some(2),Some(3)).unwrap(),b"b\r\nc");
  assert_eq!(selected_text(b"a\nb\n",Some(3),None).unwrap(),b"");
  assert_eq!(selected_text(b"a\nb",None,Some(1)).unwrap(),b"a\nb");
  assert_eq!(selected_text(b"a\nb",Some(2),Some(1)).unwrap(),b"");
 }
 #[test]fn mention_offsets_follow_js_utf16_and_retain_metadata(){
  assert!(mention(&json!({"mention":{"start":0,"end":2,"text":"emoji"}}),"😀").is_ok());
  assert!(mention(&json!({"mention":{"start":0,"end":3,"text":"bad"}}),"😀").is_err());
 }
}
