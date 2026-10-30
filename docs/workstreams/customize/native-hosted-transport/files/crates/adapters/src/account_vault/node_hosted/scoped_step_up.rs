//! Purpose-bound actual same-account step-up. No renderer cookies or login replay.
use super::*;
const STEP_ATTEMPT:&str="NODE_HOSTED_SCOPED_STEPUP_ATTEMPT_TOKEN";
struct Secrets(BTreeMap<String,String>);
impl Drop for Secrets{fn drop(&mut self){for value in self.0.values_mut(){unsafe{erase(value.as_bytes_mut());}}}}
struct Payload(Value);
impl Drop for Payload{fn drop(&mut self){if let Some(Value::String(value))=self.0.get_mut("credential"){unsafe{erase(value.as_bytes_mut());}}}}
impl AccountVault{
 /// Caller durably retains a separately versioned consent command before this function.
 /// An unconfirmed attempt is never replayed; a new explicit reviewed attempt has a new UUID.
 pub(crate) fn node_hosted_scoped_step_up(&self,target:&Target<'_>,expected:&AccountReview,attempt:&str,credential_file:&Path)->Result<AccountReview,Error>{
  uuid(attempt)?;
  let values=Secrets(super::super::read_credential_file(credential_file)?);
  if values.0.len()!=1{return Err(Error::Invalid);}
  let credential=values.0.get("NODE_HOSTED_PASSWORD").or_else(||values.0.get("NODE_HOSTED_MFA_CREDENTIAL")).ok_or(Error::Invalid)?;
  if credential.len()<6||credential.len()>1024||credential.chars().any(char::is_control){return Err(Error::Invalid);}
  let _lock=self.lock()?;let mut contents=self.read()?;
  let r=contents.accounts.iter_mut().find(|r|r.account.id==expected.account.id).ok_or(Error::NotFound)?;
  if !account_matches(r,expected)||r.credentials.get(CONNECTION).map(String::as_str)!=Some(target.connection_id)||r.credentials.get(STEP_ATTEMPT).is_some_and(|id|id==attempt){return Err(Error::Conflict);}
  let session_cookie=r.credentials.get(COOKIE).ok_or(Error::Conflict)?.clone();
  let csrf_token=r.credentials.get(CSRF).ok_or(Error::Conflict)?.clone();
  let actor=r.credentials.get(ACTOR).ok_or(Error::Conflict)?.clone();
  let before=body(target.client.get(url(target,"/api/v1/auth/session")?).header(reqwest::header::COOKIE,&session_cookie).send().map_err(|_|Error::Unavailable)?)?;
  if before["data"]["user"]["id"].as_str()!=Some(&actor){return Err(Error::Conflict);}
  // Only an actually current original session is eligible. This does not renew an expired login.
  r.credentials.insert(STEP_ATTEMPT.into(),attempt.into());
  r.account.credential_names=r.credentials.keys().cloned().collect();self.write(&contents)?;
  let payload=Payload(json!({"credential":credential}));
  let response=target.client.post(url(target,"/api/v1/auth/step-up")?).header(reqwest::header::COOKIE,&session_cookie)
   .header(reqwest::header::ORIGIN,target.dashboard_origin).header("x-ingenium-ui","dashboard").header("x-csrf-token",&csrf_token)
   .json(&payload.0).send().map_err(|_|Error::Unavailable)?;
  let rotated_cookie=cookie(&response,SESSION)?;let data=body(response)?;
  if data["data"]["recentStepUp"]!=true{return Err(Error::Unavailable);}
  let rotated_csrf=secret(&data["data"],"csrfToken")?;
  // Store the actual rotated response before a subsequent read; loss here remains an unconfirmed command.
  let r=contents.accounts.iter_mut().find(|r|r.account.id==expected.account.id).ok_or(Error::NotFound)?;
  r.credentials.insert(COOKIE.into(),rotated_cookie);r.credentials.insert(CSRF.into(),rotated_csrf);
  r.credentials.insert("NODE_HOSTED_SESSION_REVISION_TOKEN".into(),uuid::Uuid::new_v4().to_string());
  r.account.credential_names=r.credentials.keys().cloned().collect();self.write(&contents)?;
  let r=contents.accounts.iter().find(|r|r.account.id==expected.account.id).ok_or(Error::NotFound)?;
  let after=body(target.client.get(url(target,"/api/v1/auth/session")?).header(reqwest::header::COOKIE,r.credentials.get(COOKIE).ok_or(Error::Conflict)?).send().map_err(|_|Error::Unavailable)?)?;
  if after["data"]["user"]["id"].as_str()!=Some(&actor)||after["data"]["recentStepUp"]!=true{return Err(Error::Conflict);}
  Ok(review(r))
 }
}