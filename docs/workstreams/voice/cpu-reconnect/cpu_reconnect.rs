//! Proposed v2 adapter contract. Existing Speech/Voice/process custody owns
//! enrollment, original durable bindings and proof acceptance; no second journal.
use serde::{Deserialize, Serialize};
use sha2::{Digest, Sha256};
use std::sync::atomic::{AtomicBool, Ordering};

#[derive(Clone, PartialEq, Eq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Identity {
    pub instance_id: String,
    pub boot_id: String,
    pub owner_id: String,
    pub owner_generation: u64,
    pub request_id: String,
    pub operation_id: String,
    pub generation: String,
    pub kind: String,
    pub digest: String,
}
fn uuid(value: &str) -> bool {
    uuid::Uuid::parse_str(value).is_ok_and(|id| !id.is_nil() && id.to_string() == value)
}
impl Identity {
    pub fn valid(&self) -> bool {
        !self.instance_id.is_empty() && self.instance_id.len() <= 160
            && self.instance_id.bytes().all(|c| c.is_ascii_alphanumeric() || b":_-".contains(&c))
            && [&self.boot_id, &self.owner_id, &self.request_id, &self.operation_id, &self.generation].iter().all(|id| uuid(id))
            && self.operation_id == self.request_id && (1..=9007199254740991).contains(&self.owner_generation)
            && ["transcribe", "synthesize"].contains(&self.kind.as_str()) && self.digest.len() == 64
            && self.digest.bytes().all(|c| c.is_ascii_digit() || (b'a'..=b'f').contains(&c))
    }
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct LeaseInfo {
    pub protocol: String,
    pub boot_id: String,
    pub owner_id: String,
    pub owner_generation: u64,
    pub capacity: u32,
    pub retained: u32,
    pub quarantined: bool,
}
#[derive(Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase", deny_unknown_fields)]
pub struct Proof {
    pub identity: Identity,
    pub state: String,
    pub outcome: Option<String>,
    pub drained: bool,
    pub retention_id: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub accepted: Option<bool>,
}
impl Proof {
    pub fn valid_for(&self, original: &Identity) -> bool {
        if !original.valid() || self.identity != *original || self.accepted.is_some_and(|v| !v) { return false; }
        if self.state == "terminal" {
            self.drained && self.retention_id.as_deref().is_some_and(uuid)
                && self.outcome.as_deref().is_some_and(|state| ["completed", "failed", "cancelled", "cancelled-before-dispatch"].contains(&state))
        } else {
            ["reserved", "running", "uncertain"].contains(&self.state.as_str()) && !self.drained
                && self.outcome.is_none() && self.retention_id.as_deref().is_none_or(uuid)
        }
    }
}
/// Returned only after matching the worker's transition against the existing
/// durable original/process binding. This is REMOTE-REQUEST retirement, never
/// proof that every worker/process/native helper has joined or its result exists.
pub struct AcceptedTerminal { pub identity: Identity, pub retention_id: String }
pub enum Error { Uncertain, RetentionUnconfirmed }
pub trait SupervisorOwner: Send + Sync {
    /// Atomically persist exact wire identity and claim this workflow ONCE in the
    /// existing Speech original. Health is a challenge, not process enrollment.
    fn claim_original(&self, id: &str, kind: &str, digest: &str, worker: &LeaseInfo) -> Result<Identity, Error>;
    /// Verify retained native/API journal transition and original process lease.
    /// Never synthesize success from fields copied out of an HTTP response.
    fn accept_terminal(&self, original: &Identity, proof: &Proof) -> Result<AcceptedTerminal, Error>;
    fn quarantine_original(&self, id: &str, original: Option<&Identity>) -> Result<(), Error>;
}
pub struct WireReply { pub status: u16, pub body: Vec<u8> }
pub trait Transport {
    fn post(&self, path: &str, body: &[u8], identity: Option<&Identity>, binary: bool, cancel: Option<&AtomicBool>) -> Result<WireReply, Error>;
}
pub struct RemoteResult {
    pub proof: Proof,
    /// None on reconnect/lost response; never replay to recover text/audio.
    /// Some bytes still require existing native transcript/WAV validation.
    pub response: Option<WireReply>,
}
pub fn payload_digest(kind: &str, body: &[u8]) -> String {
    let mut hash = Sha256::new(); hash.update(kind.as_bytes()); hash.update([0]); hash.update(body);
    format!("{:x}", hash.finalize())
}
fn query(transport: &dyn Transport, action: &str, original: &Identity) -> Result<Proof, Error> {
    if !original.valid() { return Err(Error::Uncertain); }
    let body = serde_json::to_vec(original).map_err(|_| Error::Uncertain)?;
    let reply = transport.post(&format!("/v2/operations/{action}"), &body, None, false, None)?;
    if reply.status != 200 || reply.body.len() > 8192 { return Err(Error::Uncertain); }
    let proof: Proof = serde_json::from_slice(&reply.body).map_err(|_| Error::Uncertain)?;
    if !proof.valid_for(original) { return Err(Error::Uncertain); }
    Ok(proof)
}
fn accept(owner: &dyn SupervisorOwner, original: &Identity, proof: &Proof) -> Result<(), Error> {
    if !proof.valid_for(original) || !proof.drained { return Err(Error::Uncertain); }
    let accepted = owner.accept_terminal(original, proof)?;
    if accepted.identity != *original || Some(accepted.retention_id.as_str()) != proof.retention_id.as_deref() { return Err(Error::Uncertain); }
    Ok(())
}
fn quarantine(owner: &dyn SupervisorOwner, id: &str, original: Option<&Identity>) -> Error {
    if owner.quarantine_original(id, original).is_err() { Error::RetentionUnconfirmed } else { Error::Uncertain }
}
/// Exactly one reservation/execute workflow. Even a lost reservation response
/// consumes the original claim; reconnect only observes/cancels this identity.
pub fn execute(owner: &dyn SupervisorOwner, transport: &dyn Transport, instance: &str, id: &str, kind: &str,
    body: &[u8], worker: &LeaseInfo, cancel: &AtomicBool) -> Result<RemoteResult, Error> {
    if !uuid(id) || (if kind == "transcribe" { body.len() < 8000 || body.len() > 480000 || body.len() % 2 != 0 }
        else { kind != "synthesize" || body.is_empty() || body.len() > 4096 }) { return Err(quarantine(owner, id, None)); }
    if worker.protocol != "veyra-cpu-ownership-v2" || worker.quarantined || !uuid(&worker.boot_id)
        || !uuid(&worker.owner_id) || worker.capacity == 0 || worker.capacity > 1024 || worker.retained > worker.capacity {
        return Err(quarantine(owner, id, None));
    }
    let digest = payload_digest(kind, body);
    let original = owner.claim_original(id, kind, &digest, worker).map_err(|_| quarantine(owner, id, None))?;
    if !original.valid() || original.instance_id != instance || original.request_id != id || original.kind != kind || original.digest != digest
        || original.boot_id != worker.boot_id || original.owner_id != worker.owner_id || original.owner_generation != worker.owner_generation {
        return Err(quarantine(owner, id, Some(&original)));
    }
    let work = || {
        let reserved = query(transport, "reserve", &original)?;
        if reserved.drained { accept(owner, &original, &reserved)?; return Ok(RemoteResult { proof: reserved, response: None }); }
        if reserved.state != "reserved" { return Err(Error::Uncertain); }
        if cancel.load(Ordering::Acquire) {
            let proof = query(transport, "cancel", &original)?;
            accept(owner, &original, &proof)?;
            return Ok(RemoteResult { proof, response: None });
        }
        let response = transport.post(if kind == "transcribe" { "/v2/transcriptions" } else { "/v2/speech" },
            body, Some(&original), kind == "transcribe", Some(cancel)).ok();
        // A failed original read may still have a terminal proof. No execution
        // is repeated. A running/missing/replacement observation remains unknown.
        let proof = query(transport, "observe", &original)?;
        accept(owner, &original, &proof)?;
        let response = response.filter(|reply| (reply.status == 200) == (proof.outcome.as_deref() == Some("completed")));
        Ok(RemoteResult { proof, response })
    };
    work().map_err(|_| quarantine(owner, id, Some(&original)))
}
/// Existing original proof is required, including after owner restart. This does
/// not reserve/execute, consult idle/health, or mutate a global quarantine latch.
pub fn reconcile(owner: &dyn SupervisorOwner, transport: &dyn Transport, original: &Identity) -> Result<RemoteResult, Error> {
    let work = || { let proof = query(transport, "observe", original)?; accept(owner, original, &proof)?;
        Ok(RemoteResult { proof, response: None }) };
    work().map_err(|_| quarantine(owner, &original.request_id, Some(original)))
}

#[cfg(test)]
mod tests {
    use super::*;
    fn identity() -> Identity {
        let id = "21af783b-b665-43b4-8482-c68606c1c166".to_owned();
        Identity { instance_id:"fixture".into(),boot_id:id.clone(),owner_id:id.clone(),owner_generation:1,
            request_id:id.clone(),operation_id:id.clone(),generation:id,kind:"transcribe".into(),digest:"a".repeat(64) }
    }
    #[test] fn exact_identity_is_required_for_terminal_proof() {
        let original = identity();
        let mut proof = Proof { identity:original.clone(),state:"terminal".into(),outcome:Some("cancelled".into()),
            drained:true,retention_id:Some(original.request_id.clone()),accepted:None };
        assert!(proof.valid_for(&original));
        proof.identity.owner_generation += 1; assert!(!proof.valid_for(&original));
    }
    #[test] fn cancel_ack_and_missing_retention_are_not_terminal() {
        let original = identity();
        let mut proof = Proof { identity:original.clone(),state:"running".into(),outcome:None,
            drained:false,retention_id:None,accepted:Some(true) };
        assert!(proof.valid_for(&original)); assert!(!proof.drained);
        proof.state = "terminal".into(); proof.drained = true; assert!(!proof.valid_for(&original));
    }
    #[test] fn cross_language_exact_payload_digest_vector() {
        assert_eq!(payload_digest("transcribe", b"fixture"), "510701dc62875afbcb25e60d5329d7af23278177905e9742fd600f0a92aa79ee");
    }
}
