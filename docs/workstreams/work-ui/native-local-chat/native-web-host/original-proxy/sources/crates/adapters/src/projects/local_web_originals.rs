//! Native-only original admission in the existing ProjectStore connection.
//! No renderer DTO, alternate database, adapter journal, or second run queue.
use super::*;
use crate::opencode::desktop_runtime::{NativeWebOriginal,EffectiveWebBody};
use crate::opencode::attachments::NativeWebFilesOriginal;
use veyra_contracts::local_workspaces::LocalOperationReceipt;

/// A move-only witness created only after the actual original writer committed
/// exact input + the existing operation's unknown fence in ONE transaction.
pub struct NativeWebDispatch { original: NativeWebOriginal, effective:EffectiveWebBody,files:NativeWebFilesOriginal }
impl NativeWebDispatch {
    pub(crate) fn into_parts(self) -> (NativeWebOriginal,EffectiveWebBody,NativeWebFilesOriginal) { (self.original,self.effective,self.files) }
}
pub enum NativeWebReservation { Fresh(NativeWebDispatch), Retained(LocalOperationReceipt) }
/// Actual private original response only; never a public operation receipt or
/// deserializable replay/send permit.
pub struct NativeWebAcknowledgement {status:u16,headers:Vec<(String,String)>,body:Vec<u8>}
pub struct SavedNativeWebPty {id:String,pid:u64,definition:serde_json::Value}
impl SavedNativeWebPty {
    pub fn id(&self)->&str{&self.id}
    pub fn matches_info(&self,info:&serde_json::Value)->bool{
        info.get("id").and_then(serde_json::Value::as_str)==Some(self.id.as_str())
            &&info.get("pid").and_then(serde_json::Value::as_u64)==Some(self.pid)
            &&["command","args","cwd"].iter().all(|key|info.get(*key)==self.definition.get(*key))
    }
}
impl NativeWebAcknowledgement {
    pub fn status(&self)->u16{self.status}
    pub fn headers(&self)->&[(String,String)]{&self.headers}
    pub fn body(&self)->&[u8]{&self.body}
}

pub(super) fn validate_allocated_schema(db:&Connection, version:u32)->Result<(),StoreError>{
    let expected=Connection::open_in_memory()?;
    expected.execute_batch(include_str!("0006.sql"))?;
    if version==7 { expected.execute_batch(include_str!("0007.sql"))?; }
    else if version!=6 { return Err(StoreError::Corrupt); }
    fn ddl(db:&Connection)->Result<Vec<(String,String)>,StoreError>{
        let mut query=db.prepare("SELECT name,sql FROM sqlite_master WHERE name LIKE 'local_%' AND sql IS NOT NULL ORDER BY name")?;
        let values=query.query_map([],|r|Ok((r.get(0)?,r.get(1)?)))?.collect::<Result<Vec<_>,_>>()?;
        Ok(values)
    }
    if ddl(db)?!=ddl(&expected)? { return Err(StoreError::Corrupt); }
    Ok(())
}

impl ProjectStore {
    /// Saved creation acknowledgement is necessary but not a current process
    /// permit. The runtime must query the SAME original engine's retained PTY
    /// object before a ticket/upgrade/control; no PID adoption is performed.
    pub fn saved_native_web_pty(&self,binding:&crate::local_execution::LocalWorkspaceBinding,
        lease:&crate::opencode::desktop_runtime::LocalWebLease,pty:&str,instance:&str)->Result<SavedNativeWebPty,StoreError>{
        binding.verify_current(self,instance).map_err(|_|StoreError::Conflict)?;
        if binding.owner()!=lease.owner()||lease.revoked()||binding.directory()!=lease.directory(){return Err(StoreError::Conflict);}
        self.require_local_session(&binding.owner().workspace_id,lease.session_id())?;
        if !pty.starts_with("pty_")||pty.len()>160||!pty.bytes().all(|b|b.is_ascii_alphanumeric()||b==b'_'||b==b'-'){return Err(StoreError::Invalid);}
        let mut query=self.connection.prepare("SELECT p.scope_engine_json,a.body FROM local_web_original_payloads p JOIN local_web_original_acknowledgements a ON a.operation_id=p.operation_id JOIN local_workspace_operations o ON o.id=p.operation_id JOIN local_web_original_keys k ON k.operation_id=o.id WHERE o.workspace_id=? AND json_extract(o.result_json,'$.upstream_id')=? AND json_extract(p.scope_engine_json,'$.route')='/api/pty' AND o.kind='native_web_original' AND o.state='committed' AND a.status=200 AND a.input_sha256=k.input_sha256 AND p.method='POST'")?;
        let rows=query.query_map(params![&binding.owner().workspace_id,pty],|r|Ok((r.get::<_,String>(0)?,r.get::<_,Vec<u8>>(1)?)))?;
        for row in rows{
            let (scope,body)=row?;let scope:serde_json::Value=serde_json::from_str(&scope).map_err(|_|StoreError::Corrupt)?;
            if scope.get("route").and_then(serde_json::Value::as_str)!=Some("/api/pty")
                ||!scope.get("engine").is_some_and(|s|lease.matches_saved_workspace_engine(s)){continue;}
            let body:serde_json::Value=serde_json::from_slice(&body).map_err(|_|StoreError::Corrupt)?;
            if body.pointer("/data/id").and_then(serde_json::Value::as_str)!=Some(pty){continue;}
            if body.pointer("/location/directory").and_then(serde_json::Value::as_str)!=Some(binding.directory()){return Err(StoreError::Corrupt);}
            let definition=body.get("data").cloned().ok_or(StoreError::Corrupt)?;
            let pid=definition.get("pid").and_then(serde_json::Value::as_u64).filter(|p|*p>0).ok_or(StoreError::Corrupt)?;
            return Ok(SavedNativeWebPty{id:pty.into(),pid,definition});
        }
        Err(StoreError::NotFound)
    }
    /// Read original identity BEFORE consulting today's skill/file/model
    /// selection. Never turn an old unknown, missing ack or forgotten payload
    /// into a fresh effect. Stable ID conflict binds the COMPLETE raw input.
    pub fn lookup_native_web_original(&self,original:&NativeWebOriginal,instance:&str)->Result<Option<LocalOperationReceipt>,StoreError>{
        self.check_local_owner(original.owner(),instance)?;
        self.require_local_session(&original.owner().workspace_id,original.session_id())?;
        let stable=original.stable_upstream_key().map_err(|_|StoreError::Invalid)?;
        let row:Option<(String,String)>=self.connection.query_row(
            "SELECT operation_id,input_sha256 FROM local_web_original_keys WHERE operation_id=? OR (? IS NOT NULL AND stable_key=?)",
            params![original.operation_id(),stable,stable],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
        let Some((id,hash))=row else{return Ok(None)};
        if hash!=original.input_sha256(){return Err(StoreError::Conflict);}
        let receipt=self.local_receipt(&id)?.ok_or(StoreError::Corrupt)?;
        if receipt.owner!=*original.owner(){return Err(StoreError::Conflict);}
        Ok(Some(receipt))
    }
    pub fn require_no_unknown_native_web_original(&self,workspace:&str)->Result<(),StoreError>{
        self.local_custody()?;
        let pending:bool=self.connection.query_row("SELECT EXISTS(SELECT 1 FROM local_workspace_operations WHERE workspace_id=? AND kind='native_web_original' AND state IN ('intent','unknown'))",[workspace],|r|r.get(0))?;
        if pending{return Err(StoreError::Conflict);}Ok(())
    }
    pub fn read_native_web_acknowledgement(&self,owner:&veyra_contracts::local_workspaces::LocalWorkspaceOwner,
        session:&str,operation:&str,instance:&str)->Result<Option<NativeWebAcknowledgement>,StoreError>{
        use sha2::{Digest,Sha256};
        self.check_local_owner(owner,instance)?;self.require_local_session(&owner.workspace_id,session)?;
        let receipt=self.local_receipt(operation)?.ok_or(StoreError::NotFound)?;
        if receipt.owner.installation_id!=owner.installation_id||receipt.owner.custodian_key!=owner.custodian_key
            ||receipt.owner.workspace_id!=owner.workspace_id||receipt.owner.environment!=owner.environment{return Err(StoreError::Conflict);}
        let row:Option<(String,i64,String,String,Vec<u8>,String)>=self.connection.query_row(
            "SELECT a.input_sha256,a.status,a.content_headers_json,a.body_sha256,a.body,p.scope_engine_json FROM local_web_original_acknowledgements a JOIN local_web_original_payloads p ON p.operation_id=a.operation_id WHERE a.operation_id=?",
            [operation],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?,r.get(4)?,r.get(5)?))).optional()?;
        let Some((input,status,headers,body_hash,body,scope))=row else{return Ok(None)};
        let scope:serde_json::Value=serde_json::from_str(&scope).map_err(|_|StoreError::Corrupt)?;
        if input!=receipt.request_sha256||format!("{:x}",Sha256::digest(&body))!=body_hash
            ||scope.pointer("/engine/session_id").and_then(serde_json::Value::as_str)!=Some(session){return Err(StoreError::Corrupt);}
        let headers:Vec<(String,String)>=serde_json::from_str(&headers).map_err(|_|StoreError::Corrupt)?;
        if headers.len()>1||headers.iter().any(|(k,v)|k!="content-type"||v.chars().any(char::is_control)){return Err(StoreError::Corrupt);}
        Ok(Some(NativeWebAcknowledgement{status:u16::try_from(status).map_err(|_|StoreError::Corrupt)?,headers,body}))
    }

    /// Exact actual response + the SAME original minimal settlement commit
    /// together. Caller retains the sealed actual outcome until this succeeds;
    /// a writer/IO fault must never drop it, re-POST, or fabricate settlement.
    pub fn acknowledge_native_web_prompt(&mut self,outcome:&crate::opencode::desktop_runtime::LocalWebPromptOutcome,instance:&str)->Result<(),StoreError>{
        use sha2::{Digest,Sha256};
        self.check_local_owner(outcome.owner(),instance)?;
        self.require_local_session(&outcome.owner().workspace_id,outcome.session_id())?;
        let receipt=self.local_receipt(outcome.operation_id())?.ok_or(StoreError::NotFound)?;
        if receipt.owner!=*outcome.owner()||receipt.request_sha256!=outcome.input_sha256(){return Err(StoreError::Conflict);}
        let headers=outcome.content_type().map(|v|vec![("content-type".to_owned(),v.to_owned())]).unwrap_or_default();
        if headers.iter().any(|(_,v)|v.chars().any(char::is_control)){return Err(StoreError::Invalid);}
        let headers=serde_json::to_string(&headers).map_err(|_|StoreError::Invalid)?;
        let hash=format!("{:x}",Sha256::digest(outcome.body()));
        let retained=headers.len().checked_add(outcome.body().len()).and_then(|n|n.checked_add(64)).ok_or(StoreError::Invalid)?;
        if headers.len()>16384||outcome.body().len()>16*1024*1024{return Err(StoreError::Invalid);}
        let prior:Option<(String,i64,String,String)>=self.connection.query_row(
            "SELECT input_sha256,status,content_headers_json,body_sha256 FROM local_web_original_acknowledgements WHERE operation_id=?",
            [outcome.operation_id()],|r|Ok((r.get(0)?,r.get(1)?,r.get(2)?,r.get(3)?))).optional()?;
        if let Some(prior)=prior{
            if prior!=(outcome.input_sha256().into(),i64::from(outcome.status()),headers,hash){return Err(StoreError::Conflict);}return Ok(());
        }
        let summary=serde_json::json!({"admission":outcome.admission(),"upstream_id":outcome.upstream_id(),"status":outcome.status()});
        let summary=serde_json::to_string(&summary).map_err(|_|StoreError::Invalid)?;
        let tx=self.connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute("INSERT INTO local_web_original_acknowledgements VALUES(?,?,?,?,?,?,?)",
            params![outcome.operation_id(),outcome.input_sha256(),outcome.status(),headers,hash,outcome.body(),retained as i64])?;
        let sql=if ["admitted","rejected"].contains(&outcome.admission()){
            "UPDATE local_workspace_operations SET state='committed',result_json=? WHERE id=? AND state='unknown'"
        }else{"UPDATE local_workspace_operations SET result_json=? WHERE id=? AND state='unknown'"};
        if tx.execute(sql,params![summary,outcome.operation_id()])?!=1{return Err(StoreError::Conflict);}
        tx.commit()?;Ok(())
    }

    /// Caller retains original ModelWork/queue/creation/cancellation admission
    /// before this call and through its single guarded dispatch. This method
    /// does not manufacture that admission from a caller boolean or descriptor.
    pub fn reserve_native_web_original(&mut self, original:NativeWebOriginal,effective:EffectiveWebBody, files:NativeWebFilesOriginal, instance:&str)->Result<NativeWebReservation,StoreError>{
        self.check_local_owner(original.owner(),instance)?;
        self.require_local_session(&original.owner().workspace_id,original.session_id())?;
        if !uuid::Uuid::parse_str(original.operation_id()).is_ok_and(|id|!id.is_nil()&&id.to_string()==original.operation_id())
            || !matches!(original.method().as_str(),"POST"|"PUT"|"PATCH"|"DELETE") { return Err(StoreError::Invalid); }
        let stable=original.stable_upstream_key().map_err(|_|StoreError::Invalid)?;
        // Reconciliation lookup precedes every fresh admission. It never
        // repeats the original HTTP effect, including old intent/unknown rows.
        let prior:Option<(String,String)>=self.connection.query_row(
            "SELECT operation_id,input_sha256 FROM local_web_original_keys WHERE operation_id=? OR (? IS NOT NULL AND stable_key=?)",
            params![original.operation_id(),stable,stable],|r|Ok((r.get(0)?,r.get(1)?))).optional()?;
        if let Some((id,hash))=prior {
            if hash!=original.input_sha256(){return Err(StoreError::Conflict);}
            let receipt=self.local_receipt(&id)?.ok_or(StoreError::Corrupt)?;
            if receipt.owner!=*original.owner(){return Err(StoreError::Conflict);}
            return Ok(NativeWebReservation::Retained(receipt));
        }
        // Preserve exact received body independently from metadata JSON so its
        // byte budget is not inflated by a JSON array encoding of every byte.
        let scope=original.journal_scope();
        let scope=serde_json::to_string(&scope).map_err(|_|StoreError::Invalid)?;
        let headers=serde_json::to_string(original.headers()).map_err(|_|StoreError::Invalid)?;
        let size=original.method().as_str().len().checked_add(original.raw_target().len())
            .and_then(|n|n.checked_add(headers.len())).and_then(|n|n.checked_add(scope.len()))
            .and_then(|n|n.checked_add(original.body().len())).ok_or(StoreError::Invalid)?;
        if size>16*1024*1024{return Err(StoreError::Invalid);}
        use sha2::{Digest,Sha256};
        if format!("{:x}",Sha256::digest(original.body()))!=effective.original_body_sha256(){return Err(StoreError::Invalid);}
        let transformations=serde_json::to_string(effective.transformations()).map_err(|_|StoreError::Invalid)?;
        if transformations.len()>65536{return Err(StoreError::Invalid);}
        let verified=crate::opencode::desktop_runtime::materialize_resolved_web_files(original.body(),&files).map_err(|_|StoreError::Conflict)?;
        if verified.bytes()!=effective.bytes()||verified.effective_body_sha256()!=effective.effective_body_sha256()
            ||serde_json::to_vec(verified.transformations()).map_err(|_|StoreError::Invalid)?!=serde_json::to_vec(effective.transformations()).map_err(|_|StoreError::Invalid)?{return Err(StoreError::Conflict);}
        let binding=crate::local_execution::LocalWorkspaceBinding::acquire(self,original.owner(),instance).map_err(|_|StoreError::Conflict)?;
        files.check_current(&binding,original.session_id(),original.operation_id(),original.input_sha256(),&||{
            self.check_local_owner(original.owner(),instance).map_err(|_|"original Web owner changed")?;
            self.require_local_session(&original.owner().workspace_id,original.session_id()).map_err(|_|"original Web session changed")?;Ok(())
        }).map_err(|_|StoreError::Conflict)?;
        let mut provenance=files.journal_original();
        let mut sources=std::collections::BTreeMap::<String,Vec<u8>>::new();
        let full_provenance_hash=format!("{:x}",Sha256::digest(serde_json::to_vec(&provenance).map_err(|_|StoreError::Invalid)?));
        // Lossless compact projection: URI values already survive at exact JSON
        // pointers in raw/effective bodies. Retain hashes/pointers/source bytes
        // instead of duplicating large data URIs in a third JSON copy.
        if let Some(entries)=provenance.get_mut("files").and_then(serde_json::Value::as_array_mut){
            for entry in entries{
                let object=entry.as_object_mut().ok_or(StoreError::Invalid)?;
                use base64::{Engine as _,engine::general_purpose::STANDARD};
                let encoded=object.remove("source_bytes_base64").and_then(|v|v.as_str().map(str::to_owned)).ok_or(StoreError::Invalid)?;
                let bytes=STANDARD.decode(&encoded).map_err(|_|StoreError::Invalid)?;
                let source_hash=object.get("source_sha256").and_then(serde_json::Value::as_str).ok_or(StoreError::Invalid)?.to_owned();
                if format!("{:x}",Sha256::digest(&bytes))!=source_hash||STANDARD.encode(&bytes)!=encoded{return Err(StoreError::Conflict);}
                if let Some(previous)=sources.insert(source_hash.clone(),bytes.clone()){if previous!=bytes{return Err(StoreError::Conflict);}}
                object.insert("source_blob_sha256".into(),serde_json::json!(source_hash));
                for field in ["original_uri","effective_uri"]{
                    let uri=object.remove(field).and_then(|v|v.as_str().map(str::to_owned)).ok_or(StoreError::Invalid)?;
                    object.insert(format!("{field}_sha256"),serde_json::json!(format!("{:x}",Sha256::digest(uri.as_bytes()))));
                }
            }
        }
        provenance["full_projection_sha256"]=serde_json::json!(full_provenance_hash);
        let provenance=serde_json::to_string(&provenance).map_err(|_|StoreError::Invalid)?;
        if provenance.len()>16*1024*1024{return Err(StoreError::Invalid);}
        let source_bytes=sources.values().try_fold(0usize,|sum,bytes|sum.checked_add(bytes.len()+64)).ok_or(StoreError::Invalid)?;
        let retained=size.checked_add(effective.bytes().len()).and_then(|n|n.checked_add(transformations.len())).and_then(|n|n.checked_add(provenance.len())).and_then(|n|n.checked_add(source_bytes)).ok_or(StoreError::Invalid)?;
        let owner=serde_json::to_string(original.owner()).map_err(|_|StoreError::Invalid)?;
        let tx=self.connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        let count:i64=tx.query_row("SELECT count(*) FROM local_workspace_operations",[],|r|r.get(0))?;
        if count>=4096{return Err(StoreError::Invalid);}
        let pending:bool=tx.query_row("SELECT EXISTS(SELECT 1 FROM local_workspace_operations WHERE workspace_id=? AND kind='native_web_original' AND state IN ('intent','unknown'))",
            [&original.owner().workspace_id],|r|r.get(0))?;
        if pending{return Err(StoreError::Conflict);}
        tx.execute("INSERT INTO local_workspace_operations VALUES(?,?,?,?,?,'intent',NULL)",
            params![original.operation_id(),original.owner().workspace_id,owner,original.input_sha256(),"native_web_original"])?;
        tx.execute("INSERT INTO local_web_original_keys VALUES(?,?,?,?,?,?)",
            params![original.operation_id(),stable,original.input_sha256(),effective.effective_body_sha256(),size as i64,retained as i64])?;
        for (hash,bytes) in sources{tx.execute("INSERT INTO local_web_original_sources VALUES(?,?,?)",params![original.operation_id(),hash,bytes])?;}
        tx.execute("INSERT INTO local_web_original_payloads VALUES(?,?,?,?,?,?,?,?,?)",
            params![original.operation_id(),original.method().as_str(),original.raw_target(),headers,scope,original.body(),effective.bytes(),transformations,provenance])?;
        if tx.execute("UPDATE local_workspace_operations SET state='unknown' WHERE id=? AND state='intent'",[original.operation_id()])?!=1{return Err(StoreError::Conflict);}
        tx.commit()?;
        Ok(NativeWebReservation::Fresh(NativeWebDispatch{original,effective,files}))
    }

    /// Explicit native privacy action only, after positive original terminal
    /// settlement. No auto-expiry/prune and no unknown-input destruction. This
    /// is logical payload forgetting, not a claim of SQLite/backup erasure.
    pub fn forget_native_web_payload(&mut self,operation:&str,expected_hash:&str,forget_request:&str,instance:&str)->Result<(),StoreError>{
        if !uuid::Uuid::parse_str(forget_request).is_ok_and(|id|!id.is_nil()&&id.to_string()==forget_request){return Err(StoreError::Invalid);}
        let receipt=self.local_receipt(operation)?.ok_or(StoreError::NotFound)?;
        self.check_local_owner(&receipt.owner,instance)?;
        if receipt.request_sha256!=expected_hash || !["committed","denied"].contains(&receipt.state.as_str()){return Err(StoreError::Conflict);}
        let tx=self.connection.transaction_with_behavior(TransactionBehavior::Immediate)?;
        tx.execute("INSERT INTO local_web_original_forget_receipts VALUES(?,?,?)",params![operation,expected_hash,forget_request])?;
        tx.execute("DELETE FROM local_web_original_acknowledgements WHERE operation_id=?",[operation])?;
        tx.execute("DELETE FROM local_web_original_sources WHERE operation_id=?",[operation])?;
        if tx.execute("DELETE FROM local_web_original_payloads WHERE operation_id=?",[operation])?!=1{return Err(StoreError::Conflict);}
        tx.commit()?;Ok(())
    }
}
