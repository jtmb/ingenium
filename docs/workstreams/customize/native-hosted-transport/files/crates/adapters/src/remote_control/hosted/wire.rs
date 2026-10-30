//! Frozen Worker5 /api/v1/native-customize v1 only. No legacy API/PATCH proxy.
use super::*;
use crate::account_vault::node_hosted::Session;
const BASE:&str="/api/v1/native-customize";
const SAFE:i64=9_007_199_254_740_991;
fn canonical(v:&Value)->Result<String,Error>{
 Ok(match v{
  Value::Null=>"null".into(),Value::Bool(b)=>b.to_string(),
  Value::Number(n)=>{
   if let Some(i)=n.as_i64(){if !(-SAFE..=SAFE).contains(&i){return Err(Error::Invalid);}i.to_string()}
   else if let Some(i)=n.as_u64(){if i>SAFE as u64{return Err(Error::Invalid);}i.to_string()}
   else {let f=n.as_f64().ok_or(Error::Invalid)?;if !f.is_finite()||f.fract()!=0.0||f.abs()>SAFE as f64{return Err(Error::Invalid);}if f==0.0{"0".into()}else{format!("{f:.0}")}}
  },
  Value::String(s)=>serde_json::to_string(s).map_err(|_|Error::Invalid)?,
  Value::Array(a)=>"[".to_string()+&a.iter().map(canonical).collect::<Result<Vec<_>,_>>()?.join(",")+"]",
  Value::Object(o)=>{let mut keys=o.keys().collect::<Vec<_>>();keys.sort_by(|a,b|a.encode_utf16().cmp(b.encode_utf16()));"{".to_string()+&keys.into_iter().map(|k|Ok(canonical(&Value::String(k.clone()))?+":"+&canonical(&o[k])?)).collect::<Result<Vec<_>,Error>>()?.join(",")+"}"}
 })
}
pub fn payload_hash(original:&Original)->Result<String,Error>{let bytes=canonical(&serde_json::to_value(original).map_err(|_|Error::Invalid)?)?;if bytes.len()>2_000_000{return Err(Error::Invalid);}Ok(hash(bytes.as_bytes()))}
fn url(target:&Target<'_>,path:&str)->Result<reqwest::Url,Error>{
 let mut url=reqwest::Url::parse(target.endpoint).map_err(|_|Error::Invalid)?;
 if url.scheme()!="https"||url.path()!="/"||url.query().is_some()||url.fragment().is_some()||!url.username().is_empty()||url.password().is_some(){return Err(Error::Invalid);}
 url.set_path(path);Ok(url)
}
fn decode(response:reqwest::blocking::Response)->Result<Value,Error>{
 if !response.status().is_success(){return Err(Error::Unavailable);}
 let mut bytes=Vec::new();response.take(3*1024*1024+1).read_to_end(&mut bytes).map_err(|_|Error::Unavailable)?;
 if bytes.len()>3*1024*1024{return Err(Error::Unavailable);}
 let parsed:Value=serde_json::from_slice(&bytes).map_err(|_|Error::Unavailable)?;
 if !parsed.is_object()||parsed.as_object().is_none_or(|m|m.len()!=1||!m.contains_key("data")){return Err(Error::Unavailable);}
 Ok(parsed["data"].clone())
}
fn get(target:&Target<'_>,s:&Session<'_>,path:&str,query:&[(&str,&str)])->Result<Value,Error>{
 decode(target.client.get(url(target,path)?).query(query).header(reqwest::header::COOKIE,s.cookie).send().map_err(|_|Error::Unavailable)?)
}
fn post(target:&Target<'_>,s:&Session<'_>,path:&str,body:&Value,locks:Option<&crate::account_vault::node_hosted::Maintenance>)->Result<Value,Error>{
 let mut request=target.client.post(url(target,path)?).header(reqwest::header::COOKIE,s.cookie).header(reqwest::header::ORIGIN,target.dashboard_origin)
  .header("x-ingenium-ui","dashboard").header("x-csrf-token",s.csrf).json(body);
 if let Some(locks)=locks{
  if let Some(token)=locks.target{request=request.header("x-ingenium-lock-token",token);}
  if let Some(token)=locks.source{request=request.header("x-ingenium-source-lock-token",token);}
 }
 decode(request.send().map_err(|_|Error::Unavailable)?)
}
pub fn identity(target:&Target<'_>,s:&Session<'_>,grant_id:&str)->Result<Identity,Error>{
 if !crate::utility_operations::canonical(grant_id){return Err(Error::Invalid);}
 let value=get(target,s,&format!("{BASE}/enrollments/{grant_id}"),&[])?;
 let identity:Identity=serde_json::from_value(value).map_err(|_|Error::Unavailable)?;
 if identity.session_actor_id!=s.actor_id||identity.binding.actor_id!=s.actor_id||identity.binding.grant_id!=grant_id||identity.capability_revision.len()!=64{return Err(Error::Forbidden);}
 Ok(identity)
}
pub fn enroll(target:&Target<'_>,s:&Session<'_>,request_id:&str,hosted_project:&str,visibility:&Visibility)->Result<Identity,Error>{
 let value=post(target,s,&format!("{BASE}/enrollments"),&json!({"enrollmentRequestId":request_id,"hostedProjectId":hosted_project,"visibility":visibility}),None)?;
 let result:Identity=serde_json::from_value(value).map_err(|_|Error::Unavailable)?;
 if result.session_actor_id!=s.actor_id||result.binding.actor_id!=s.actor_id||result.binding.hosted_project_id!=hosted_project||result.binding.visibility!=*visibility{return Err(Error::Forbidden);}
 Ok(result)
}
pub fn read(target:&Target<'_>,s:&Session<'_>,binding:&Binding,command:&Read)->Result<Value,Error>{
 let value=post(target,s,&format!("{BASE}/read"),&json!({"grantId":binding.grant_id,"command":command}),None)?;
 if value["session_actor_id"]!=s.actor_id||value["binding"]!=json!(binding)||!value.as_object().is_some_and(|m|m.contains_key("value")){return Err(Error::Forbidden);}
 Ok(value["value"].clone())
}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
struct CoreReceipt{operation_id:Option<String>,payload_hash:Option<String>,outcome:Outcome,value_ref:Option<Value>,error:Option<PublicError>,first_failure_code:Option<String>}
fn receipt(value:Value,original:&Original)->Result<Receipt,Error>{
 let r:CoreReceipt=serde_json::from_value(value).map_err(|_|Error::Unavailable)?;
 if r.operation_id.as_deref()!=Some(&original.id){return Err(Error::Conflict);}
 if r.outcome==Outcome::Unknown&&r.payload_hash.is_none(){return Ok(unknown(original));}
 if r.payload_hash.as_deref()!=Some(payload_hash(original)?.as_str()){return Err(Error::Conflict);}
 if let Some(value)=r.value_ref.as_ref(){if value["projectId"]!=original.binding.hosted_project_id{return Err(Error::Conflict);}}
 // Metadata-only receipt stays metadata-only. A separately authorized readback supplies actual bodies.
 let mut error=r.error;
 if error.is_none(){if let Some(code)=r.first_failure_code{error=Some(PublicError{status:None,code,message:"The original owner retained its first failure.".into()});}}
 Ok(Receipt{original:original.clone(),outcome:r.outcome,value:None,error})
}
pub fn effect(target:&Target<'_>,s:&Session<'_>,original:&Original,locks:&crate::account_vault::node_hosted::Maintenance)->Result<Receipt,Error>{
 receipt(post(target,s,&format!("{BASE}/effects"),&json!({"original":original}),Some(locks))?,original)
}
pub fn inspect(target:&Target<'_>,s:&Session<'_>,current:&Binding,original:&Original)->Result<Receipt,Error>{
 if current.grant_id!=original.binding.grant_id||!crate::utility_operations::canonical(&original.id){return Err(Error::Forbidden);}
 receipt(get(target,s,&format!("{BASE}/operations/{}",original.id),&[("grantId",&current.grant_id)])?,original)
}
#[cfg(test)] mod tests {
 use super::*;
 #[test]fn canonical_utf16_order_and_exact_strings(){let value:Value=serde_json::from_str(r#"{"z":"x\r\n","a":1,"𐀀":true,"":false}"#).unwrap();assert_eq!(canonical(&value).unwrap(),"{\"a\":1,\"z\":\"x\\r\\n\",\"𐀀\":true,\"\":false}");}
 #[test]fn unsafe_numbers_are_not_hashed(){assert!(canonical(&json!(9_007_199_254_740_992u64)).is_err());}
}

pub struct RemotePending{pub operation_id:String,pub payload_hash:String}
pub fn pending(target:&Target<'_>,s:&Session<'_>,current:&Binding)->Result<Vec<RemotePending>,Error>{
 let mut result=Vec::new();let mut after=String::new();let mut ids=std::collections::BTreeSet::new();
 for _ in 0..41{
  let mut query=vec![("grantId",current.grant_id.as_str()),("limit","100")];if !after.is_empty(){query.push(("after",after.as_str()));}
  let value=get(target,s,&format!("{BASE}/operations"),&query)?;
  let rows=value["data"].as_array().filter(|rows|rows.len()<=100).ok_or(Error::Unavailable)?;
  for row in rows{
   let r:CoreReceipt=serde_json::from_value(row.clone()).map_err(|_|Error::Unavailable)?;
   let id=r.operation_id.filter(|id|crate::utility_operations::canonical(id)).ok_or(Error::Unavailable)?;
   let payload_hash=r.payload_hash.filter(|h|h.len()==64&&h.bytes().all(|b|b.is_ascii_hexdigit())).ok_or(Error::Unavailable)?;
   if r.outcome!=Outcome::Unknown||!ids.insert(id.clone()){return Err(Error::Conflict);}
   result.push(RemotePending{operation_id:id,payload_hash});
  }
  if value["pagination"]["hasMore"]==false&&value["pagination"]["nextCursor"].is_null(){return Ok(result);}
  let next=value["pagination"]["nextCursor"].as_str().filter(|v|!v.is_empty()&&*v!=after).ok_or(Error::Unavailable)?;
  if value["pagination"]["hasMore"]!=true||rows.is_empty()||result.len()>=4096{return Err(Error::Unavailable);}after=next.into();
 }
 Err(Error::Unavailable)
}
#[derive(Deserialize)]
#[serde(rename_all="camelCase",deny_unknown_fields)]
pub(super) struct SiteIdentity{pub actor_id:String,pub installation_id:String,pub hosted_service_instance_id:String,pub authority_id:String,#[serde(rename="session_actor_id")]pub session_actor_id:String}
pub(super) fn site_identity(target:&Target<'_>,s:&Session<'_>)->Result<SiteIdentity,Error>{
 let value=get(target,s,&format!("{BASE}/identity"),&[])?;
 let actual:SiteIdentity=serde_json::from_value(value).map_err(|_|Error::Unavailable)?;
 if actual.actor_id!=s.actor_id||actual.session_actor_id!=s.actor_id||actual.installation_id.is_empty()||actual.hosted_service_instance_id.is_empty()||actual.authority_id.is_empty(){return Err(Error::Forbidden);}Ok(actual)
}

#[cfg(test)]mod frozen_vectors{
 use super::*;
 #[test]fn actual_core_whole_original_canonical_vectors(){
  let vectors:Value=serde_json::from_str(include_str!("canonical-vectors.json")).unwrap();
  for vector in vectors.as_array().unwrap(){let text=canonical(&vector["value"]).unwrap();assert_eq!(text,vector["canonical"].as_str().unwrap());assert_eq!(hash(text.as_bytes()),vector["sha256"].as_str().unwrap());}
 }
}

#[cfg(test)]mod official_whole_originals {
 use super::*;
 #[test]fn frozen34351_typed_original_roundtrip_and_hash(){
  let file:Value=serde_json::from_str(include_str!("official-vectors.json")).unwrap();
  for vector in file["vectors"].as_array().unwrap(){
   let original:Original=serde_json::from_value(vector["original"].clone()).unwrap();
   let serialized=serde_json::to_value(&original).unwrap();assert_eq!(serialized,vector["original"]);
   assert_eq!(canonical(&serialized).unwrap(),vector["canonical"].as_str().unwrap());
   assert_eq!(payload_hash(&original).unwrap(),vector["payloadHash"].as_str().unwrap());
  }
 }
}
