//! Actual Ingenium local-user sign-in; session/CSRF remain in the existing DPAPI vault.
//! No secret-bearing type implements Serialize or Debug. No automatic login or refresh.
use super::*;
use reqwest::blocking::{Client,Response};
const SESSION:&str="__Host-ingenium_session";
const PREAUTH:&str="__Host-ingenium_pre_auth";

const COOKIE:&str="NODE_HOSTED_SESSION_TOKEN";
const CSRF:&str="NODE_HOSTED_CSRF_TOKEN";
const CONNECTION:&str="NODE_HOSTED_CONNECTION_CREDENTIAL";
const ATTEMPT:&str="NODE_HOSTED_SIGNIN_ATTEMPT_TOKEN";
const CHALLENGE:&str="NODE_HOSTED_MFA_CHALLENGE_TOKEN";
const ACTOR:&str="NODE_HOSTED_ACTOR_CREDENTIAL";

#[derive(Clone,Serialize,Deserialize)]
#[serde(deny_unknown_fields)]
pub struct AccountReview {pub account:Account,pub session_revision:Option<String>}
#[derive(Serialize)]
pub struct SessionStatus {pub state:&'static str,pub actor_id:Option<String>,pub review:AccountReview}
pub(crate) struct Maintenance<'a>{pub(crate) target:Option<&'a str>,pub(crate) source:Option<&'a str>}
pub(crate) struct Session<'a>{pub(crate) cookie:&'a str,pub(crate) csrf:&'a str,pub(crate) actor_id:&'a str,pub(crate) locks:Maintenance<'a>}
pub(crate) struct Target<'a>{pub(crate) client:&'a Client,pub(crate) endpoint:&'a str,pub(crate) dashboard_origin:&'a str,pub(crate) connection_id:&'a str}
fn url(target:&Target<'_>,path:&str)->Result<reqwest::Url,Error>{
 let mut result=reqwest::Url::parse(target.endpoint).map_err(|_|Error::Invalid)?;
 if result.scheme()!="https"||result.host_str().is_none()||result.path()!="/"||result.query().is_some()||result.fragment().is_some()||!result.username().is_empty()||result.password().is_some(){return Err(Error::Invalid);}
 result.set_path(path);Ok(result)
}
fn secret(value:&Value,key:&str)->Result<String,Error>{
 let s=value.get(key).and_then(Value::as_str).filter(|s|s.len()>=32&&s.len()<=2048&&!s.chars().any(char::is_control)).ok_or(Error::Unavailable)?;Ok(s.to_string())
}
fn cookie(response:&Response,name:&str)->Result<String,Error>{
 let prefix=format!("{name}=");let mut found=None;
 for header in response.headers().get_all(reqwest::header::SET_COOKIE){
  let raw=header.to_str().map_err(|_|Error::Unavailable)?;
  let first=raw.split(';').next().ok_or(Error::Unavailable)?;
  if let Some(value)=first.strip_prefix(&prefix){
   if found.is_some()||value.len()<32||value.len()>2048||!value.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'-'||b==b'_'){return Err(Error::Unavailable);}
   let attributes=raw.split(';').skip(1).map(|s|s.trim().to_ascii_lowercase()).collect::<Vec<_>>();
   if !["secure","httponly","path=/","samesite=strict"].iter().all(|a|attributes.iter().any(|v|v==a))||attributes.iter().any(|a|a.starts_with("domain=")){return Err(Error::Unavailable);}
   found=Some(format!("{name}={value}"));
  }
 }
 found.ok_or(Error::Unavailable)
}
fn body(response:Response)->Result<Value,Error>{
 if !response.status().is_success(){return Err(Error::Conflict);}
 let mut bytes=Vec::new();response.take(256*1024+1).read_to_end(&mut bytes).map_err(|_|Error::Unavailable)?;
 if bytes.len()>256*1024 {erase(&mut bytes);return Err(Error::Unavailable);}
 let result=serde_json::from_slice::<Value>(&bytes).map_err(|_|Error::Unavailable);erase(&mut bytes);result
}
fn csrf(target:&Target<'_>)->Result<(String,String),Error>{
 let response=target.client.get(url(target,"/api/v1/auth/csrf")?).send().map_err(|_|Error::Unavailable)?;
 let cookie=cookie(&response,PREAUTH)?;let value=body(response)?;Ok((cookie,secret(&value["data"],"csrfToken")?))
}
fn account_matches(record:&Record,review:&AccountReview)->bool{
 record.account.revoked_at.is_none()&&record.account.provider=="ingenium-node-hosted"&&record.account.scopes.iter().any(|s|s=="hosted-governance")&&
 serde_json::to_value(&record.account).ok()==serde_json::to_value(&review.account).ok()&&record.credentials.get("NODE_HOSTED_SESSION_REVISION_TOKEN")==review.session_revision.as_ref()
}
fn review(record:&Record)->AccountReview{AccountReview{account:record.account.clone(),session_revision:record.credentials.get("NODE_HOSTED_SESSION_REVISION_TOKEN").cloned()}}
fn status(record:&Record)->SessionStatus{
 SessionStatus{state:if record.credentials.contains_key(COOKIE){"signed_in_unverified"}else if record.credentials.contains_key(CHALLENGE){"second_factor_required"}else{"signed_out"},
 actor_id:record.credentials.get(ACTOR).cloned(),review:review(record)}
}
impl AccountVault {
 pub fn node_hosted_status(&self,id:&str)->Result<SessionStatus,Error>{
  let _lock=self.lock()?;let contents=self.read()?;let r=contents.accounts.iter().find(|r|r.account.id==id&&r.account.revoked_at.is_none()&&r.account.provider=="ingenium-node-hosted").ok_or(Error::NotFound)?;Ok(status(r))
 }
 /// Explicit consumed account command only. Password/MFA were imported through the existing native credential-file owner.
 pub(crate) fn node_hosted_sign_in(&self,target:&Target<'_>,expected:&AccountReview,attempt:&str,second_factor:bool)->Result<SessionStatus,Error>{
  uuid(attempt)?;let _lock=self.lock()?;let mut contents=self.read()?;
  let r=contents.accounts.iter_mut().find(|r|r.account.id==expected.account.id).ok_or(Error::NotFound)?;
  if !account_matches(r,expected)||r.credentials.contains_key(COOKIE){return Err(Error::Conflict);}
  if r.credentials.get(CONNECTION).is_some_and(|id|id!=target.connection_id){return Err(Error::Conflict);}
  // Commit a consumed private sign-in attempt BEFORE a request can authenticate.
  // A lost response never causes an automatic password/MFA replay.
  if r.credentials.get(ATTEMPT).is_some_and(|id|id==attempt){return Err(Error::Conflict);}
  if !second_factor&&r.credentials.contains_key(CHALLENGE){return Err(Error::Conflict);}
  r.credentials.insert(ATTEMPT.into(),attempt.into());r.credentials.insert(CONNECTION.into(),target.connection_id.into());
  r.account.credential_names=r.credentials.keys().cloned().collect();
  self.write(&contents)?;
  let r=contents.accounts.iter_mut().find(|r|r.account.id==expected.account.id).ok_or(Error::NotFound)?;
  let (pre_cookie,pre_csrf)=csrf(target)?;
  let (path,payload)=if second_factor{
   let challenge=r.credentials.remove(CHALLENGE).ok_or(Error::Conflict)?;
   let code=r.credentials.remove("NODE_HOSTED_MFA_CREDENTIAL").ok_or(Error::Conflict)?;
   ("/api/v1/auth/mfa/challenge",json!({"challengeToken":challenge,"code":code}))
  }else{
   let email=r.credentials.get("NODE_HOSTED_EMAIL_CREDENTIAL").ok_or(Error::Invalid)?;
   let password=r.credentials.get("NODE_HOSTED_PASSWORD").ok_or(Error::Invalid)?;
   ("/api/v1/auth/login",json!({"email":email,"password":password,"deviceLabel":"Veyra Native"}))
  };
  // Persist challenge consumption before effect; both password and MFA are single attempts.
  self.write(&contents)?;
  let response=target.client.post(url(target,path)?).header(reqwest::header::ORIGIN,target.dashboard_origin)
   .header(reqwest::header::COOKIE,pre_cookie).header("x-csrf-token",pre_csrf).json(&payload).send().map_err(|_|Error::Unavailable)?;
  let session_cookie=if response.status().as_u16()==200{Some(cookie(&response,SESSION)?)}else{None};
  let value=body(response)?;let data=&value["data"];
  let r=contents.accounts.iter_mut().find(|r|r.account.id==expected.account.id).ok_or(Error::NotFound)?;
  if data["mfaRequired"]==true&&!second_factor{
   r.credentials.insert(CHALLENGE.into(),secret(data,"challengeToken")?);
  }else{
   let actor=data["user"]["id"].as_str().filter(|s|uuid(s).is_ok()).ok_or(Error::Unavailable)?.to_string();
   r.credentials.insert(COOKIE.into(),session_cookie.ok_or(Error::Unavailable)?);r.credentials.insert(CSRF.into(),secret(data,"csrfToken")?);
   r.credentials.insert(ACTOR.into(),actor);
   // The actual user session is retained, not the login password or single-use code.
   for name in ["NODE_HOSTED_PASSWORD","NODE_HOSTED_MFA_CREDENTIAL",CHALLENGE]{if let Some(mut value)=r.credentials.remove(name){unsafe{erase(value.as_bytes_mut());}}}
  }
  r.credentials.insert("NODE_HOSTED_SESSION_REVISION_TOKEN".into(),uuid::Uuid::new_v4().to_string());
  r.account.credential_names=r.credentials.keys().cloned().collect();
  let result=status(r);self.write(&contents)?;Ok(result)
 }
 /// The vault lock retains the account original during this bounded private request.
 /// The hosted server still reauthorizes membership, session and runtime ownership.
 pub(crate) fn with_node_hosted_session<T>(&self,target:&Target<'_>,expected:&AccountReview,work:impl FnOnce(Session<'_>)->Result<T,Error>)->Result<T,Error>{
  let _lock=self.lock()?;let contents=self.read()?;let r=contents.accounts.iter().find(|r|r.account.id==expected.account.id).ok_or(Error::NotFound)?;
  if !account_matches(r,expected)||r.credentials.get(CONNECTION).map(String::as_str)!=Some(target.connection_id){return Err(Error::Conflict);}
  let session=Session{cookie:r.credentials.get(COOKIE).ok_or(Error::Conflict)?,csrf:r.credentials.get(CSRF).ok_or(Error::Conflict)?,actor_id:r.credentials.get(ACTOR).ok_or(Error::Conflict)?,locks:Maintenance{target:r.credentials.get("NODE_HOSTED_TARGET_LOCK_TOKEN").map(String::as_str),source:r.credentials.get("NODE_HOSTED_SOURCE_LOCK_TOKEN").map(String::as_str)}};
  let value=body(target.client.get(url(target,"/api/v1/auth/session")?).header(reqwest::header::COOKIE,session.cookie).send().map_err(|_|Error::Unavailable)?)?;
  if value["data"]["user"]["id"].as_str()!=Some(session.actor_id){return Err(Error::Conflict);}
  work(session)
 }
}

// Called only with the actual pinned Node enrollment reply, never a renderer binding.
impl AccountVault {
 pub(crate) fn node_hosted_bind_enrollment(&self,expected:&AccountReview,request_id:&str,binding:&crate::remote_control::hosted::contracts::Binding)->Result<AccountReview,Error>{
  let _lock=self.lock()?;let mut contents=self.read()?;
  let r=contents.accounts.iter_mut().find(|r|r.account.id==expected.account.id).ok_or(Error::NotFound)?;
  if !account_matches(r,expected)||r.credentials.get(CONNECTION).map(String::as_str)!=Some(request_id)||r.credentials.get(ACTOR)!=Some(&binding.actor_id){return Err(Error::Conflict);}
  r.credentials.insert(CONNECTION.into(),binding.connection_id.clone());r.credentials.insert("NODE_HOSTED_SESSION_REVISION_TOKEN".into(),uuid::Uuid::new_v4().to_string());
  r.account.credential_names=r.credentials.keys().cloned().collect();let result=review(r);self.write(&contents)?;Ok(result)
 }
}

struct MfaCode(String);
impl Drop for MfaCode{fn drop(&mut self){unsafe{erase(self.0.as_bytes_mut());}}}
impl AccountVault {
 pub(crate) fn node_hosted_mfa_file(&self,expected:&AccountReview,path:&Path)->Result<AccountReview,Error>{
  // Reuse the original account credential-file reader (native handle/reparse checks + zeroed buffer).
  let mut values=super::read_credential_file(path)?;
  let value=values.remove("NODE_HOSTED_MFA_CREDENTIAL");
  let extra=!values.is_empty();for secret in values.values_mut(){unsafe{erase(secret.as_bytes_mut());}}
  let code=MfaCode(value.ok_or(Error::Invalid)?);
  if extra||code.0.len()<6||code.0.len()>128||code.0.chars().any(char::is_control){return Err(Error::Invalid);}
  let _lock=self.lock()?;let mut contents=self.read()?;
  let r=contents.accounts.iter_mut().find(|r|r.account.id==expected.account.id).ok_or(Error::NotFound)?;
  if !account_matches(r,expected)||!r.credentials.contains_key(CHALLENGE)||r.credentials.contains_key(COOKIE){return Err(Error::Conflict);}
  r.credentials.insert("NODE_HOSTED_MFA_CREDENTIAL".into(),code.0.clone());
  r.credentials.insert("NODE_HOSTED_SESSION_REVISION_TOKEN".into(),uuid::Uuid::new_v4().to_string());
  r.account.credential_names=r.credentials.keys().cloned().collect();let result=review(r);self.write(&contents)?;Ok(result)
 }
}
