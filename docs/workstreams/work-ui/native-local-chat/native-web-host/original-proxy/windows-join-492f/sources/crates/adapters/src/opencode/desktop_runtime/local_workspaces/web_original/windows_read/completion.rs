//! Retention-only source evidence and materialization verification for the
//! actual carrier. These read methods never mint dispatch or join authority.
use super::*;
use base64::{Engine as _,engine::general_purpose::STANDARD};
impl NativeWindowsWebRead{
 pub(crate) fn matches_original(&self,original:&NativeWebOriginal)->bool{
  self.original==original.engine&&self.operation==original.operation_id()&&self.input_sha256==original.input_sha256()
   &&self.binding_id==original.binding_id&&self.invalidation_epoch==original.invalidation_epoch
 }
 pub(crate) fn check_captured(&self,binding:&LocalWorkspaceBinding,session:&str,operation:&str,input:&str,current:&dyn Fn()->Result<(),String>)->Result<(),String>{
  if session!=self.original.session_id||operation!=self.operation||input!=self.input_sha256{return Err("different original Windows input".into());}
  self.held.check(binding,session,operation,input,&self.engine_key,current)
 }
 pub(crate) fn contains_image(&self)->Result<bool,String>{self.held.contains_image()}
 pub(crate) fn begin_actual_send(&self)->Result<(),String>{self.held.begin_send()}
 pub(crate) fn retire_never_sent(&self,deadline:Instant)->Result<(),String>{self.held.retire_never_sent(deadline)}
 pub(crate) fn held_original(&self)->Arc<RetainedWindowsWebRead>{self.held.clone()}
 pub(crate) fn journal_original(&self,original:&NativeWebOriginal)->Result<Value,String>{
  if !self.matches_original(original){return Err("different original Windows source owner".into());}
  let view:Value=serde_json::from_slice(original.body()).map_err(|_|"original Windows input JSON invalid")?;
  let files=view.get("files").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]);
  let uris=files.iter().enumerate().filter_map(|(index,file)|file.get("uri").and_then(Value::as_str).filter(|uri|!uri.starts_with("data:")).map(|uri|(index,uri))).collect::<Vec<_>>();
  let chain=self.held.chain_projection()?;let mut entries=Vec::new();
  self.held.visit_sources(&mut|source_index,absolute,bytes,mime|{
   let(index,uri)=*uris.get(source_index).ok_or("captured source count differs from original URI occurrences")?;
   let url=Url::parse(uri).map_err(|_|"original file URI invalid")?;
   if url.to_file_path().ok().and_then(|p|p.to_str().map(str::to_owned)).as_deref()!=Some(absolute){return Err("original URI differs from actual retained open".into());}
   entries.push(json!({"pointer":format!("/files/{index}/uri"),"file_index":index,"original_uri":uri,"effective_uri":uri,
    "fallback_name":Value::Null,"source_sha256":format!("{:x}",Sha256::digest(bytes)),"effective_sha256":format!("{:x}",Sha256::digest(bytes)),
    "source_bytes_base64":STANDARD.encode(bytes),"source_identity":{"absolute":absolute,"mime":mime,"chain_projection_sha256":format!("{:x}",Sha256::digest(serde_json::to_vec(&chain).map_err(|_|"chain projection invalid")?))}}));Ok(())
  })?;
  if entries.len()!=uris.len(){return Err("original URI capture incomplete".into());}
  Ok(json!({"kind":"retained-windows-original-uri-v1","owner":self.original.owner,"directory":self.original.directory,
   "session_id":self.original.session_id,"project_id":self.original.project_id,"operation_id":self.operation,
   "original_input_sha256":self.input_sha256,"prompt_view_sha256":format!("{:x}",Sha256::digest(serde_json::to_vec(&view).map_err(|_|"original JSON invalid")?)),
   "engine_key":self.engine_key,"held_chain":chain,"files":entries}))
 }
 /// Validate materialized files against actual retained source bytes. Called
 /// only by the actual sender slot after its complete native HTTP response.
 /// Returns no proof; the slot alone may mint the typed read-join witness.
 pub(crate) fn verify_materialized_user(&self,original:&NativeWebOriginal,user:&Value)->Result<(),String>{
  if !self.matches_original(original){return Err("different original Windows completion".into());}
  let request:Value=serde_json::from_slice(original.body()).map_err(|_|"original JSON invalid")?;
  let inputs=request.get("files").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]);
  let payload=user.get("payload").filter(|p|p.get("text").is_some_and(Value::is_string)).ok_or("materialized User payload invalid")?;
  if ["files","agents","skills"].iter().any(|key|payload.get(*key).is_some_and(|v|!v.is_array())){return Err("materialized optional attachment arrays invalid".into());}
  let outputs=payload.get("files").and_then(Value::as_array).map(Vec::as_slice).unwrap_or(&[]);
  if inputs.len()!=outputs.len(){return Err("materialized file occurrences differ".into());}
  let mut native_index=0usize;
  self.held.visit_sent_sources(&mut|source_index,absolute,bytes,mime|{
   while native_index<inputs.len()&&inputs[native_index].get("uri").and_then(Value::as_str).is_some_and(|u|u.starts_with("data:")){
    verify_inline(&inputs[native_index],&outputs[native_index])?;native_index+=1;
   }
   let input=inputs.get(native_index).ok_or("unexpected materialized source")?;let output=&outputs[native_index];
   let uri=input.get("uri").and_then(Value::as_str).ok_or("original URI absent")?;
   let url=Url::parse(uri).map_err(|_|"original URI invalid")?;
   if source_index>=inputs.len()||url.to_file_path().ok().and_then(|p|p.to_str().map(str::to_owned)).as_deref()!=Some(absolute)
    ||output.pointer("/source/type").and_then(Value::as_str)!=Some("uri")||output.pointer("/source/uri").and_then(Value::as_str)!=Some(uri){return Err("materialized source differs from actual held read".into());}
   let expected=if mime=="text/plain"{text_range(bytes,&url)?}else{bytes.to_vec()};
   verify_materialized_data(input,output,&expected,mime)?;native_index+=1;Ok(())
  })?;
  while native_index<inputs.len(){verify_inline(&inputs[native_index],&outputs[native_index])?;native_index+=1;}
  Ok(())
 }
}
fn verify_inline(input:&Value,output:&Value)->Result<(),String>{
 let uri=input.get("uri").and_then(Value::as_str).filter(|u|u.starts_with("data:")).ok_or("uncaptured original file")?;
 let(header,data)=uri.split_once(',').ok_or("inline data absent")?;
 if !header.ends_with(";base64"){return Err("inline decoder parity remains unqualified".into());}
 let bytes=STANDARD.decode(data).map_err(|_|"inline base64 invalid")?;
 if STANDARD.encode(&bytes)!=data||output.pointer("/source/type").and_then(Value::as_str)!=Some("inline"){return Err("materialized inline identity differs".into());}
 let(mime,_)=crate::attachments::sniff_for_prompt(&bytes).map_err(|_|"inline MIME unqualified")?;
 verify_materialized_data(input,output,&bytes,mime)
}
fn verify_materialized_data(input:&Value,output:&Value,bytes:&[u8],mime:&str)->Result<(),String>{
 let data=output.get("data").and_then(Value::as_str).ok_or("materialized bytes absent")?;
 let decoded=STANDARD.decode(data).map_err(|_|"materialized base64 invalid")?;
 let actual=output.get("mime").and_then(Value::as_str).ok_or("materialized MIME absent")?;
 if STANDARD.encode(&decoded)!=data||["description","mention"].iter().any(|key|input.get(*key)!=output.get(*key))
  ||input.get("name").is_some_and(|name|output.get("name")!=Some(name)){return Err("materialized occurrence differs".into());}
 if mime.starts_with("image/"){
  // Normalization legitimately changes data. Pinned prepare() emits this
  // complete payload only AFTER its source read and normalizeImage finish.
  let(sniffed,_)=crate::attachments::sniff_for_prompt(&decoded).map_err(|_|"materialized image MIME invalid")?;
  if !sniffed.starts_with("image/")||actual!=sniffed{return Err("materialized image invalid".into());}
 }else if decoded!=bytes||actual!=mime{return Err("materialized bytes differ from captured read".into());}
 Ok(())
}
fn text_range(bytes:&[u8],url:&Url)->Result<Vec<u8>,String>{
 let query=url.query_pairs().collect::<std::collections::BTreeMap<_,_>>();
 let Some(start)=query.get("start")else{return Ok(bytes.to_vec())};
 let start=start.parse::<usize>().ok().filter(|n|*n>0).ok_or("line range parity unqualified")?;
 let end=query.get("end").map(|v|v.parse::<usize>().ok().filter(|n|*n>0).ok_or("line range parity unqualified")).transpose()?;
 let text=std::str::from_utf8(bytes).map_err(|_|"lossy UTF8 line semantics unqualified")?;
 Ok(text.split('\n').skip(start-1).take(end.map(|e|e.saturating_sub(start-1)).unwrap_or(usize::MAX)).collect::<Vec<_>>().join("\n").into_bytes())
}

#[cfg(test)]mod tests{
 use super::*;
 #[test]fn materialized_data_requires_canonical_bytes_and_same_occurrence(){
  let input=json!({"uri":"file:///C:/work/a.txt","name":"a.txt","description":"original"});
  let actual=json!({"data":"eA==","mime":"text/plain","source":{"type":"uri","uri":"file:///C:/work/a.txt"},"name":"a.txt","description":"original"});
  verify_materialized_data(&input,&actual,b"x","text/plain").unwrap();
  for changed in [json!({"data":"eQ=="}),json!({"data":"eA"}),json!({"description":"copied"}),json!({"name":"other.txt"}),json!({"mime":"image/png"})]{
   let mut bad=actual.clone();for(k,v)in changed.as_object().unwrap(){bad[k]=v.clone();}
   assert!(verify_materialized_data(&input,&bad,b"x","text/plain").is_err());
  }
 }
 #[test]fn inline_completion_cannot_impersonate_a_uri_read(){
  let input=json!({"uri":"data:text/plain;base64,eA=="});
  let actual=json!({"data":"eA==","mime":"text/plain","source":{"type":"inline"}});
  verify_inline(&input,&actual).unwrap();let mut bad=actual.clone();bad["source"]=json!({"type":"uri","uri":"file:///C:/foreign.txt"});
  assert!(verify_inline(&input,&bad).is_err());
 }
 #[test]fn text_range_uses_pinned_utf8_lf_slice_and_refuses_unqualified_lossy_input(){
  let url=Url::parse("file:///C:/work/a.txt?start=2&end=3").unwrap();
  assert_eq!(text_range(b"one\r\ntwo\r\nthree\nfour",&url).unwrap(),b"two\r\nthree");
  assert!(text_range(b"\xff\nvalid",&url).is_err());
 }
}
