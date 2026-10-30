//! Pinned protocol 9eb6902aaf3c35ce985b67c605a775992249066b:
//! groups/message.ts (first page order=desc; never order with cursor),
//! groups/session.ts (switchAgent and process-owned active/interrupt semantics).
use super::*;
use std::collections::BTreeMap;
fn local_opaque(value:&str)->Result<(),EngineError>{if value.is_empty()||value.len()>4096||value.chars().any(char::is_control){return Err(EngineError::Malformed);}Ok(())}
impl OpenCodeClient{
 pub(crate) fn local_recent_messages(&self,id:&str,cursor:Option<&str>,limit:u32)->Result<MessagePage,EngineError>{
  validate_session(id)?;if !(1..=100).contains(&limit){return Err(EngineError::Malformed);}
  let mut query=vec![("limit",limit.to_string())];
  if let Some(cursor)=cursor{if cursor.len()>4096{return Err(EngineError::Malformed);}local_opaque(cursor)?;query.push(("cursor",cursor.into()));}
  else{query.push(("order","desc".into()));}
  let page:WireMessagePage=decode(self.request_query(Method::GET,&["api","session",id,"message"],&query,None)?)?;
  if page.data.len()>limit as usize{return Err(EngineError::Malformed);}
  let data=page.data.into_iter().map(|message|message.normalize(id)).collect::<Result<Vec<_>,_>>()?;
  Ok(MessagePage{data,cursor:page.cursor})
 }
 pub(crate) fn local_session_running(&self,id:&str)->Result<bool,EngineError>{
  validate_session(id)?;
  let entries:Envelope<BTreeMap<String,Value>>=decode(self.request(Method::GET,&["api","session","active"],None)?)?;
  match entries.data.get(id){None=>Ok(false),Some(value) if value.get("type").and_then(Value::as_str)==Some("running")=>Ok(true),_=>Err(EngineError::Malformed)}
 }
 pub(crate) fn select_local_agent_ack(&self,id:&str,agent:&str)->Result<(),EngineError>{
  validate_session(id)?;local_opaque(agent)?;
  let response=self.request(Method::POST,&["api","session",id,"agent"],Some(json!({"agent":agent})))?;
  if response.status()!=StatusCode::NO_CONTENT{return Err(EngineError::Http(response.status().as_u16()));}Ok(())
 }
}

#[cfg(test)]
mod tests{
 use super::*;
 use std::{io::{BufRead,BufReader,Write},net::TcpListener,thread};
 fn fixture(body:Value,status:&str)->(OpenCodeClient,thread::JoinHandle<String>){
  let listener=TcpListener::bind("127.0.0.1:0").unwrap();let endpoint=format!("http://{}",listener.local_addr().unwrap());
  let status=status.to_owned();
  let worker=thread::spawn(move||{
   let (mut stream,_)=listener.accept().unwrap();stream.set_read_timeout(Some(Duration::from_secs(2))).unwrap();
   let mut reader=BufReader::new(stream.try_clone().unwrap());let mut first=String::new();reader.read_line(&mut first).unwrap();
   loop{let mut line=String::new();reader.read_line(&mut line).unwrap();if line=="\r\n"||line.is_empty(){break;}}
   let body=body.to_string();write!(stream,"HTTP/1.1 {status}\r\nContent-Type: application/json\r\nContent-Length: {}\r\nConnection: close\r\n\r\n{body}",body.len()).unwrap();first
  });
  (OpenCodeClient::new(&endpoint,None,Duration::from_secs(2)).unwrap(),worker)
 }
 #[test] fn recent_first_page_is_descending_and_next_page_uses_only_opaque_cursor(){
  let id="ses_localfixture";
  for (cursor,want) in [(None,"order=desc"),(Some("next:opaque"),"cursor=next%3Aopaque")]{
   let (client,worker)=fixture(json!({"data":[],"cursor":{"previous":null,"next":null}}),"200 OK");
   client.local_recent_messages(id,cursor,25).unwrap();let request=worker.join().unwrap();
   assert!(request.contains("limit=25")&&request.contains(want));
   if cursor.is_some(){assert!(!request.contains("order="));}
  }
 }
 #[test] fn foreign_session_message_and_oversized_page_are_refused(){
  for data in [json!([{"id":"msg_localfixture","sessionID":"ses_foreign","type":"user","text":"private"}]),
   json!([{"id":"msg_first","sessionID":"ses_localfixture","type":"user"},{"id":"msg_second","sessionID":"ses_localfixture","type":"user"}])]{
   let (client,worker)=fixture(json!({"data":data,"cursor":{}}),"200 OK");
   assert!(client.local_recent_messages("ses_localfixture",None,1).is_err());worker.join().unwrap();
  }
 }
 #[test] fn activity_is_filtered_to_only_the_requested_session(){
  let (client,worker)=fixture(json!({"data":{"ses_other":{"type":"running"}}}),"200 OK");
  assert!(!client.local_session_running("ses_localfixture").unwrap());worker.join().unwrap();
 }
 #[test] fn agent_switch_requires_actual_no_content_acknowledgement(){
  let (client,worker)=fixture(Value::Null,"200 OK");
  assert!(client.select_local_agent_ack("ses_localfixture","build").is_err());
  assert!(worker.join().unwrap().starts_with("POST /api/session/ses_localfixture/agent "));
 }
}
