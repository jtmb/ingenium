//! Pinned event projection, not a global raw SSE forwarder. Raw accepted frame
//! bytes are relayed unchanged. Volatile disconnects are never called replay.
use super::web_original::LocalWebLease;
use crate::{local_execution::LocalWorkspaceBinding,projects::{ProjectStore,StoreError}};
use serde_json::Value;

const SESSION_EVENTS:&[&str]=&[
    "session.created",
    "session.agent.selected",
    "session.model.selected",
    "session.moved",
    "session.renamed",
    "session.permissions",
    "session.viewed",
    "session.message.content.updated",
    "session.usage.recorded",
    "session.usage.updated",
    "session.deleted",
    "session.forked",
    "session.inbox.delivered",
    "session.inbox.enqueued",
    "session.inbox.cancelled",
    "session.inbox.delivery.changed",
    "session.execution.started",
    "session.execution.succeeded",
    "session.execution.failed",
    "session.execution.interrupted",
    "session.instructions.updated",
    "session.synthetic",
    "session.skill.activated",
    "session.shell.started",
    "session.shell.ended",
    "session.step.started",
    "session.step.streamed",
    "session.step.ended",
    "session.step.failed",
    "session.text.started",
    "session.text.delta",
    "session.text.ended",
    "session.reasoning.started",
    "session.reasoning.delta",
    "session.reasoning.ended",
    "session.tool.input.started",
    "session.tool.input.delta",
    "session.tool.input.ended",
    "session.tool.called",
    "session.tool.progress",
    "session.tool.success",
    "session.tool.failed",
    "session.retry.scheduled",
    "session.compaction.started",
    "session.compaction.delta",
    "session.compaction.ended",
    "session.compaction.failed",
    "session.revert.staged",
    "session.revert.cleared",
    "session.revert.committed",
];
#[derive(Debug,PartialEq)]
pub enum WebEventDecision { Forward,Foreign,InvalidateBinding }
#[derive(Debug,PartialEq)]
enum Claims {
    Nonprivate,
    Session{session:String,parent:Option<String>,directory:Option<String>,project:Option<String>},
    Pty{pty:String,directory:Option<String>},
    UnqualifiedGlobal,
}
fn refused()->String{"Original Web event needs its actual scoped owner/projection".into()}
fn opaque(value:&str,prefix:&str)->bool{value.starts_with(prefix)&&value.len()>prefix.len()&&value.len()<=256&&value.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'_'||b==b'-')}
fn string(value:&Value,pointer:&str)->Result<String,String>{value.pointer(pointer).and_then(Value::as_str).map(str::to_owned).ok_or_else(refused)}
fn claims(frame:&[u8])->Result<Claims,String>{
    if frame==b": heartbeat\n\n"||frame==b": heartbeat\r\n\r\n"{return Ok(Claims::Nonprivate)}
    let text=std::str::from_utf8(frame).map_err(|_|refused())?;
    if !text.ends_with("\n\n")&&!text.ends_with("\r\n\r\n"){return Err(refused())}
    let mut data=String::new();let mut count=0;
    for line in text.lines(){
        if line.is_empty(){continue;}
        let Some(value)=line.strip_prefix("data:")else{return Err(refused())};
        if count>0{data.push('\n');}data.push_str(value.strip_prefix(' ').unwrap_or(value));count+=1;
    }
    if count==0{return Err(refused())}
    let event:Value=serde_json::from_str(&data).map_err(|_|refused())?;
    let kind=string(&event,"/type")?;
    if !event.get("id").and_then(Value::as_str).is_some_and(|id|opaque(id,"evt_")){return Err(refused())}
    if kind=="server.connected"{
        if event.as_object().is_some_and(|o|o.len()==3&&o.keys().all(|k|["id","type","data"].contains(&k.as_str())))
            &&event.get("data").and_then(Value::as_object).is_some_and(|o|o.is_empty()) {return Ok(Claims::Nonprivate)}
        return Err(refused());
    }
    let directory=event.pointer("/location/directory").map(|v|v.as_str().map(str::to_owned).ok_or_else(refused)).transpose()?;
    if SESSION_EVENTS.contains(&kind.as_str())||["permission.asked","permission.replied","form.created","form.replied","form.cancelled"].contains(&kind.as_str()){
        let session=string(&event,if kind=="form.created"{"/data/form/sessionID"}else{"/data/sessionID"})?;
        if !opaque(&session,"ses_"){return Err(refused())}
        let parent=if ["session.created","session.forked"].contains(&kind.as_str()){
            event.pointer("/data/parentID").map(|v|v.as_str().filter(|s|opaque(s,"ses_")).map(str::to_owned).ok_or_else(refused)).transpose()?
        }else{None};
        let inner=event.pointer("/data/location/directory").map(|v|v.as_str().map(str::to_owned).ok_or_else(refused)).transpose()?;
        if let (Some(outer),Some(inner))=(&directory,&inner){if outer!=inner&&kind!="session.moved"{return Err(refused())}}
        let project=event.pointer("/data/projectID").map(|v|v.as_str().map(str::to_owned).ok_or_else(refused)).transpose()?;
        return Ok(Claims::Session{session,parent,directory:inner.or(directory),project});
    }
    if ["pty.created","pty.updated","pty.exited","pty.deleted"].contains(&kind.as_str()){
        let pty=string(&event,if ["pty.created","pty.updated"].contains(&kind.as_str()){"/data/info/id"}else{"/data/id"})?;
        if !opaque(&pty,"pty_"){return Err(refused())}
        return Ok(Claims::Pty{pty,directory});
    }
    // RPC/model/provider/plugin/global events need their original resource
    // projection. A type prefix/location claim is never a permission grant.
    Ok(Claims::UnqualifiedGlobal)
}
pub fn project_local_web_event(store:&ProjectStore,binding:&LocalWorkspaceBinding,lease:&LocalWebLease,frame:&[u8])->Result<WebEventDecision,String>{
    if lease.revoked()||binding.owner()!=lease.owner()||binding.directory()!=lease.directory(){return Err(refused())}
    binding.verify_current(store,&binding.owner().service_instance_id)?;
    store.require_local_session(&binding.owner().workspace_id,lease.session_id()).map_err(|_|refused())?;
    match claims(frame)?{
        Claims::Nonprivate=>Ok(WebEventDecision::Forward),
        Claims::UnqualifiedGlobal=>Err(refused()),
        Claims::Session{session,parent,directory,project}=>{
            let foreign=directory.as_deref().is_some_and(|d|d!=binding.directory())||project.as_deref().is_some_and(|p|p!=lease.engine_project_id());
            if foreign{
                if session==lease.session_id(){lease.revoke();return Ok(WebEventDecision::InvalidateBinding)}
                return Ok(WebEventDecision::Foreign);
            }
            for id in std::iter::once(session).chain(parent){
                match store.require_local_session(&binding.owner().workspace_id,&id){
                    Ok(())=>{},Err(StoreError::NotFound)=>return Ok(WebEventDecision::Foreign),Err(_)=>return Err(refused())
                }
            }
            Ok(WebEventDecision::Forward)
        },
        Claims::Pty{pty,directory}=>{
            if directory.as_deref()!=Some(binding.directory()){return Ok(WebEventDecision::Foreign)}
            match store.saved_native_web_pty(binding,lease,&pty,&binding.owner().service_instance_id){
                Ok(_)=>Ok(WebEventDecision::Forward),Err(StoreError::NotFound)=>Ok(WebEventDecision::Foreign),Err(_)=>Err(refused())
            }
        }
    }
}
/// Bounded frame assembly only. Actual projection above is still mandatory
/// before forwarding. No resume cursor is invented on stream loss/overflow.
#[derive(Default)]
pub struct NativeSseFrames {pending:Vec<u8>}
impl NativeSseFrames{
    pub fn push(&mut self,bytes:&[u8])->Result<Vec<Vec<u8>>,String>{
        if self.pending.len().checked_add(bytes.len()).is_none_or(|n|n>32*1024*1024){return Err("Original Web SSE frame exceeds its retained bound".into())}
        self.pending.extend_from_slice(bytes);let mut output=Vec::new();
        loop{
            let lf=self.pending.windows(2).position(|v|v==b"\n\n").map(|p|p+2);
            let crlf=self.pending.windows(4).position(|v|v==b"\r\n\r\n").map(|p|p+4);
            let end=match(lf,crlf){(Some(a),Some(b))=>a.min(b),(Some(a),None)=>a,(None,Some(b))=>b,(None,None)=>break};
            let tail=self.pending.split_off(end);output.push(std::mem::replace(&mut self.pending,tail));
        }Ok(output)
    }
    pub fn finish(&self)->Result<(),String>{if !self.pending.is_empty(){return Err("Original Web SSE ended mid-frame; reconnect requires actual reads".into())}Ok(())}
}
#[cfg(test)]mod tests{
    use super::*;
    #[test]fn actual_heartbeat_and_connected_are_closed_nonprivate_cases(){
        assert_eq!(claims(b": heartbeat\n\n").unwrap(),Claims::Nonprivate);
        assert_eq!(claims(b"data: {\"id\":\"evt_actual\",\"type\":\"server.connected\",\"data\":{}}\n\n").unwrap(),Claims::Nonprivate);
        assert!(claims(b"data: {\"id\":\"evt_actual\",\"type\":\"server.connected\",\"data\":{\"secret\":1}}\n\n").is_err());
        assert!(matches!(claims(b"data: {\"id\":\"evt_actual\",\"type\":\"rpc.private\",\"location\":{\"directory\":\"/private\"},\"data\":{}}\n\n").unwrap(),Claims::UnqualifiedGlobal));
    }
    #[test]fn actual_session_form_and_pty_paths_remain_distinct_owner_claims(){
        assert!(matches!(claims(b"data: {\"id\":\"evt_a\",\"type\":\"session.text.delta\",\"data\":{\"sessionID\":\"ses_actual\",\"delta\":\"literal\\ntext\"}}\n\n").unwrap(),Claims::Session{session,..} if session=="ses_actual"));
        assert!(matches!(claims(b"data: {\"id\":\"evt_a\",\"type\":\"form.created\",\"data\":{\"form\":{\"sessionID\":\"ses_actual\"}}}\n\n").unwrap(),Claims::Session{..}));
        assert!(matches!(claims(b"data: {\"id\":\"evt_a\",\"type\":\"pty.created\",\"location\":{\"directory\":\"/private\"},\"data\":{\"info\":{\"id\":\"pty_actual\"}}}\n\n").unwrap(),Claims::Pty{..}));
    }
    #[test]fn chunk_boundaries_crlf_and_frame_bytes_are_preserved(){
        let first=b": heartbeat\n\n";let second=b"data: {\"id\":\"evt_a\",\"type\":\"server.connected\",\"data\":{}}\r\n\r\n";
        let mut all=first.to_vec();all.extend_from_slice(second);let mut frames=NativeSseFrames::default();let mut received=Vec::new();
        for chunk in all.chunks(3){received.extend(frames.push(chunk).unwrap());}
        assert_eq!(received,vec![first.to_vec(),second.to_vec()]);assert!(frames.finish().is_ok());
        let mut incomplete=NativeSseFrames::default();incomplete.push(b"data: {").unwrap();assert!(incomplete.finish().is_err());
    }
}
