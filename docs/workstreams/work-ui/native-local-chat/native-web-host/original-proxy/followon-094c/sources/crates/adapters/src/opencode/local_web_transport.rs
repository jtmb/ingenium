//! Exactly-once original transport. The caller retains this object BEFORE I/O.
use super::*;
use std::sync::Arc;
const LIMIT:usize=16*1024*1024;
#[derive(PartialEq,Eq)]
pub(crate) enum WebTransportPhase{Prepared,Sending,Complete,Unknown}
pub(crate) struct WebPromptObservation{
 pub status:Option<u16>,pub content_type:Option<String>,pub body:Vec<u8>,
 pub phase:WebTransportPhase,pub failure:Option<&'static str>,
}
pub(crate) struct OriginalWebPromptRequest{
 http:Client,request:Option<reqwest::blocking::Request>,
 // Actual response remains here even on header/body failure or a panic.
 response:Option<reqwest::blocking::Response>,
 pub observation:Arc<WebPromptObservation>,
}
impl OriginalWebPromptRequest{
 pub(crate) fn execute_retained(&mut self){
  // No observation clone escapes until this call ends. A poisoned slot never
  // retries; the registry still owns request/response and the read carrier.
  let Some(observed)=Arc::get_mut(&mut self.observation)else{return};
  if observed.phase!=WebTransportPhase::Prepared{return;}
  let Some(request)=self.request.take()else{return};
  observed.phase=WebTransportPhase::Sending;
  match self.http.execute(request){
   Ok(response)=>self.response=Some(response),
   Err(_)=>{observed.phase=WebTransportPhase::Unknown;observed.failure=Some("send-or-response-unknown");return;}
  }
  let response=self.response.as_mut().expect("actual response assigned before inspection");
  observed.status=Some(response.status().as_u16());
  observed.content_type=response.headers().get(reqwest::header::CONTENT_TYPE).and_then(|h|h.to_str().ok()).map(str::to_owned);
  // The retained Response owns parsed headers. No claim of raw HTTP header
  // wire preservation is made by reqwest. Body prefix bytes ARE exact.
  let mut chunk=[0u8;8192];
  loop{
   let remaining=LIMIT+1-observed.body.len();
   if remaining==0{observed.phase=WebTransportPhase::Unknown;observed.failure=Some("body-limit-observed");return;}
   match response.read(&mut chunk[..remaining.min(8192)]){
    Ok(0)=>{
     if observed.status.is_some_and(|s|(300..400).contains(&s)){
      observed.phase=WebTransportPhase::Unknown;observed.failure=Some("redirect-not-followed");
     }else{observed.phase=WebTransportPhase::Complete;}
     return;
    },
    Ok(count)=>observed.body.extend_from_slice(&chunk[..count]),
    Err(_)=>{observed.phase=WebTransportPhase::Unknown;observed.failure=Some("body-read-unknown");return;}
   }
  }
 }
}
impl OpenCodeClient{
 pub(crate) fn prepare_original_web_prompt(&self,session:&str,raw_target:&str,
  content_headers:&[(String,String)],effective_body:&[u8])->Result<OriginalWebPromptRequest,EngineError>{
  validate_session(session)?;
  let target=self.base.join(raw_target).map_err(|_|EngineError::InvalidEndpoint)?;
  let rendered=format!("{}{}",target.path(),target.query().map(|q|format!("?{q}")).unwrap_or_default());
  if target.origin()!=self.base.origin()||rendered!=raw_target
   ||target.path()!=format!("/api/session/{session}/prompt")||target.fragment().is_some()
   ||!target.username().is_empty()||target.password().is_some()||effective_body.len()>LIMIT{return Err(EngineError::Malformed);}
  let http=Client::builder().no_proxy().redirect(reqwest::redirect::Policy::none())
   .retry(reqwest::retry::never()).connect_timeout(Duration::from_secs(5))
   .timeout(Duration::from_secs(30)).build().map_err(|_|EngineError::Transport)?;
  let mut request=http.request(Method::POST,target);
  if let Some(auth)=&self.auth{request=request.basic_auth(&auth.username,Some(&auth.password));}
  let mut seen=std::collections::BTreeSet::new();
  for(name,value)in content_headers{
   if !["content-type","accept","content-encoding"].contains(&name.as_str())||!seen.insert(name)
    ||(name=="content-encoding"&&value!="identity")||value.chars().any(char::is_control){return Err(EngineError::Malformed);}
   request=request.header(name.as_str(),value.as_str());
  }
  let request=request.body(effective_body.to_vec()).build().map_err(|_|EngineError::Transport)?;
  let mut body=Vec::new();body.try_reserve_exact(LIMIT+1).map_err(|_|EngineError::Transport)?;
  Ok(OriginalWebPromptRequest{http,request:Some(request),response:None,
   observation:Arc::new(WebPromptObservation{status:None,content_type:None,body,phase:WebTransportPhase::Prepared,failure:None})})
 }
}

#[cfg(test)]mod tests{
 use super::*;
 use std::{io::{BufRead,BufReader,Write},net::TcpListener,thread};
 #[test]fn partial_response_remains_exact_and_cannot_retry(){
  let listener=TcpListener::bind("127.0.0.1:0").unwrap();
  let client=OpenCodeClient::new(&format!("http://{}",listener.local_addr().unwrap()),None,Duration::from_secs(2)).unwrap();
  let worker=thread::spawn(move||{
   let(mut stream,_)=listener.accept().unwrap();let mut reader=BufReader::new(stream.try_clone().unwrap());
   loop{let mut line=String::new();reader.read_line(&mut line).unwrap();if line=="\r\n"{break;}}
   stream.write_all(b"HTTP/1.1 200 OK\r\nContent-Type: application/json\r\nContent-Length: 999\r\nConnection: close\r\n\r\n{\"data\":").unwrap();
   stream.flush().unwrap();
  });
  let mut owned=client.prepare_original_web_prompt("ses_fixture","/api/session/ses_fixture/prompt",&[],b"{}").unwrap();
  owned.execute_retained();worker.join().unwrap();
  assert_eq!(owned.observation.status,Some(200));assert_eq!(owned.observation.body,b"{\"data\":");
  assert!(owned.observation.phase==WebTransportPhase::Unknown);assert!(owned.response.is_some());
  owned.execute_retained();assert_eq!(owned.observation.body,b"{\"data\":");
 }
}
