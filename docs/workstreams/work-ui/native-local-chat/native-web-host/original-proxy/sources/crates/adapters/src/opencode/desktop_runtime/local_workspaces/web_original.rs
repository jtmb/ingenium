//! Grounded lease + lossless request producer. No listener, renderer factory,
//! raw forwarding or admission token is supplied by this module.
use super::*;
use reqwest::{Method, Url};
use veyra_contracts::local_workspaces::LocalWorkspaceOwner;

#[derive(Clone, PartialEq, Serialize)]
struct OriginalEngine {
    owner: LocalWorkspaceOwner,
    directory: String,
    session_id: String,
    project_id: String,
    instance_id: String,
    pid: u32,
    revision: u64,
    version: String,
}

/// Not Deserialize, Debug, Clone, or constructible from a claimed descriptor.
/// The private proxy retains this object; only opaque IDs cross native IPC.
pub struct LocalWebLease {
    binding: Arc<LocalWorkspaceBinding>,
    original: OriginalEngine,
    binding_id: String,
    invalidation_epoch: String,
    revoked: AtomicBool,
}
impl LocalWebLease {
    pub fn binding_id(&self) -> &str { &self.binding_id }
    pub fn invalidation_epoch(&self) -> &str { &self.invalidation_epoch }
    pub fn owner(&self) -> &LocalWorkspaceOwner { &self.original.owner }
    pub fn session_id(&self) -> &str { &self.original.session_id }
    pub fn revoked(&self) -> bool { self.revoked.load(Ordering::Acquire) }
    /// Revocation only. It does not close a child, release a proxy/profile,
    /// acknowledge callback detachment, or terminate the retained engine.
    pub fn revoke(&self) { self.revoked.store(true, Ordering::Release); }
}

fn observe(engine: &OwnedEngine, binding: &LocalWorkspaceBinding, session: &str,
    revision: u64, current: &dyn Fn() -> Result<(), String>) -> Result<OriginalEngine, RuntimeError> {
    require_local_engine(engine, binding, current)?;
    let instance = task_permissions::current_engine_instance_id(engine)?;
    let saved = engine.client()?.session_in_project(session, &SessionQuery {
        directory: binding.directory().into(), ..SessionQuery::default()
    })?;
    require_local_engine(engine, binding, current)?;
    let info = engine.client()?.info()?;
    if saved.id != session || saved.location.directory != binding.directory()
        || saved.project_id.is_empty() || info.version != PINNED_VERSION
        || engine.registration_pid != Some(info.pid)
        || task_permissions::current_engine_instance_id(engine)? != instance
    { return Err(local_error()); }
    require_local_engine(engine, binding, current)?;
    Ok(OriginalEngine { owner: binding.owner().clone(), directory: saved.location.directory,
        session_id: saved.id, project_id: saved.project_id, instance_id: instance,
        pid: info.pid, revision, version: info.version })
}

impl LiveRuntime {
    /// Service's current callback MUST also recheck require_local_session on the
    /// original ProjectStore, not merely LocalWorkspaceBinding::verify_current.
    pub fn mint_local_web_lease(&self, binding: Arc<LocalWorkspaceBinding>, session: &str,
        current: &dyn Fn() -> Result<(), String>) -> Result<LocalWebLease, RuntimeError> {
        let engine = self.lock_engine_for_directory(binding.directory())?;
        let revision = self.credentials_revision();
        let original = observe(&engine, &binding, session, revision, current)?;
        if revision != self.credentials_revision() { return Err(local_error()); }
        let binding_id = uuid::Uuid::new_v4().simple().to_string();
        let nonce = uuid::Uuid::new_v4();
        let mut hash = Sha256::new(); hash.update(b"veyra-original-web-lease-v1\0");
        hash.update(nonce.as_bytes());
        hash.update(serde_json::to_vec(&original).map_err(|_| RuntimeError::Storage)?);
        let invalidation_epoch = format!("{:x}", hash.finalize());
        Ok(LocalWebLease { binding, original, binding_id, invalidation_epoch,
            revoked: AtomicBool::new(false) })
    }

    /// Re-observes original registration, retained process, original registry,
    /// real session/project/directory, custody, and credential revision. No
    /// supplied port/URL/PID/positive availability callback is accepted.
    pub fn check_local_web_lease(&self, lease: &LocalWebLease,
        current: &dyn Fn() -> Result<(), String>) -> Result<(), RuntimeError> {
        let result = (|| {
            if lease.revoked() || self.credentials_revision() != lease.original.revision {
                return Err(local_error());
            }
            let engine = self.lock_engine_for_directory(lease.binding.directory())?;
            let observed = observe(&engine, &lease.binding, &lease.original.session_id,
                self.credentials_revision(), current)?;
            if observed != lease.original || lease.revoked()
                || self.credentials_revision() != lease.original.revision { return Err(local_error()); }
            Ok(())
        })();
        if result.is_err() { lease.revoke(); }
        result
    }

    /// Called ONLY inside the authenticated private native proxy, after its
    /// requesting native child/origin validation. Never expose as generic IPC.
    /// This produces an ORIGINAL, not permission to dispatch or replay it.
    pub fn capture_local_web_request(&self, lease: &LocalWebLease, method: &str,
        target: &str, headers: &[(String, String)], body: Vec<u8>,
        current: &dyn Fn() -> Result<(), String>) -> Result<NativeWebOriginal, RuntimeError> {
        self.check_local_web_lease(lease, current)?;
        let captured = NativeWebOriginal::capture(lease, method, target, headers, body)?;
        self.check_local_web_lease(lease, current)?;
        Ok(captured)
    }
}

/// Bytes are never decoded/re-encoded to forward a request. Parsing a separate
/// JSON view for policy cannot replace this original. No Deserialize/Debug or
/// public constructor; renderer JSON and saved descriptors cannot manufacture it.
pub struct NativeWebOriginal {
    operation_id: String,
    binding_id: String,
    invalidation_epoch: String,
    engine: OriginalEngine,
    method: Method,
    route: String,
    query: Vec<(String, String)>,
    headers: Vec<(String, String)>,
    body: Vec<u8>,
    input_sha256: String,
}
impl NativeWebOriginal {
    fn capture(lease: &LocalWebLease, method: &str, target: &str,
        headers: &[(String, String)], body: Vec<u8>) -> Result<Self, RuntimeError> {
        if lease.revoked() || body.len() > 16 * 1024 * 1024 { return Err(local_error()); }
        let (method, route, query, content) = request_parts(method,target,headers,&body,&lease.original.directory)?;
        let operation_id = uuid::Uuid::new_v4().to_string();
        let metadata = serde_json::to_vec(&(lease.binding_id(), lease.invalidation_epoch(),
            &lease.original, method.as_str(), &route, &query, &content)).map_err(|_| RuntimeError::Storage)?;
        let input_sha256 = input_hash(&metadata, &body);
        Ok(Self { operation_id, binding_id: lease.binding_id.clone(),
            invalidation_epoch: lease.invalidation_epoch.clone(), engine: lease.original.clone(),
            method, route, query, headers: content, body, input_sha256 })
    }
    pub fn operation_id(&self) -> &str { &self.operation_id }
    pub fn input_sha256(&self) -> &str { &self.input_sha256 }
    pub fn method(&self) -> &Method { &self.method }
    pub fn route(&self) -> &str { &self.route }
    pub fn query(&self) -> &[(String,String)] { &self.query }
    pub fn headers(&self) -> &[(String,String)] { &self.headers }
    pub fn body(&self) -> &[u8] { &self.body }
    pub fn owner(&self) -> &LocalWorkspaceOwner { &self.engine.owner }
    pub fn session_id(&self) -> &str { &self.engine.session_id }
    pub fn binding_id(&self) -> &str { &self.binding_id }
    pub fn invalidation_epoch(&self) -> &str { &self.invalidation_epoch }
    /// Exact serializable journal projection, private writer only. This is not
    /// a renderer response. Restart JSON never recreates a live lease.
    pub fn journal_original(&self) -> Value {
        json!({"operation_id":self.operation_id,"binding_id":self.binding_id,
            "invalidation_epoch":self.invalidation_epoch,"engine":self.engine,
            "method":self.method.as_str(),"route":self.route,"query":self.query,
            "headers":self.headers,"body_bytes":self.body,"input_sha256":self.input_sha256})
    }
}

type RequestParts = (Method, String, Vec<(String,String)>, Vec<(String,String)>);
fn request_parts(method: &str, target: &str, headers: &[(String,String)], body: &[u8], directory: &str) -> Result<RequestParts, RuntimeError> {
        if target.len() > 16384
            || !target.starts_with('/') || target.starts_with("//")
            || target.chars().any(|c| c.is_control() || c == '\\' || c == '#')
        { return Err(local_error()); }
        let method = Method::from_bytes(method.as_bytes()).map_err(|_| local_error())?;
        if ![Method::GET, Method::HEAD, Method::POST, Method::PUT, Method::PATCH, Method::DELETE].contains(&method)
            || ((method == Method::GET || method == Method::HEAD) && !body.is_empty())
        { return Err(local_error()); }
        let path = target.split('?').next().ok_or_else(local_error)?;
        let lowered = path.to_ascii_lowercase();
        if path.split('/').any(|s| s == "." || s == "..")
            || ["%2e", "%2f", "%5c", "%00", "%25"].iter().any(|s| lowered.contains(s))
        { return Err(local_error()); }
        let parsed = Url::parse(&format!("http://native.invalid{target}")).map_err(|_| local_error())?;
        if parsed.path() != path || parsed.host_str() != Some("native.invalid") { return Err(local_error()); }
        let query: Vec<(String, String)> = parsed.query_pairs().map(|(k,v)|(k.into_owned(),v.into_owned())).collect();
        let scope: Vec<_> = query.iter().filter(|(k,_)| k == "directory" || k == "location[directory]").collect();
        if scope.len() > 1 || scope.first().is_some_and(|(_,v)| v != directory)
            || query.iter().any(|(k,_)| ["project", "subpath", "location", "location[project]", "location[subpath]"].contains(&k.as_str()))
            || query.iter().any(|(k,v)|k.chars().chain(v.chars()).any(char::is_control))
        { return Err(local_error()); }
        // Transport/ambient auth is NOT part of replayable content. Unknown
        // headers are refused, not silently smuggled through to the engine.
        let mut content = Vec::new();
        for (name, value) in headers {
            let name = name.to_ascii_lowercase();
            if !["content-type", "content-encoding", "accept", "last-event-id"].contains(&name.as_str())
                || value.chars().any(char::is_control)
                || content.iter().any(|(previous, _): &(String,String)| previous == &name)
            { return Err(local_error()); }
            content.push((name, value.clone()));
        }
        Ok((method,path.into(),query,content))
}
fn input_hash(metadata: &[u8], body: &[u8]) -> String {
    let mut hash = Sha256::new(); hash.update(b"veyra-original-web-request-v1\0");
    hash.update((metadata.len() as u64).to_be_bytes()); hash.update(metadata);
    hash.update((body.len() as u64).to_be_bytes()); hash.update(body);
    format!("{:x}", hash.finalize())
}

/// Read-only policy inspection of the FULL original. It is deliberately not a
/// dispatch permit: Root's original journal/broker must fence before HTTP, then
/// repeat these checks under the same engine lock used for that single send.
pub struct LocalWebPromptInspection {
    pub upstream_message_id: Option<String>,
    pub delivery: Option<String>,
    pub resume: Option<bool>,
    pub skill_ids: Vec<String>,
}
impl LiveRuntime {
    pub fn inspect_local_web_prompt(&self, lease: &LocalWebLease, original: &NativeWebOriginal,
        current: &dyn Fn() -> Result<(), String>) -> Result<LocalWebPromptInspection, RuntimeError> {
        self.check_local_web_lease(lease, current)?;
        if original.binding_id != lease.binding_id || original.invalidation_epoch != lease.invalidation_epoch
            || original.engine != lease.original || original.method != Method::POST
            || original.route != format!("/api/session/{}/prompt", lease.session_id())
            || original.headers.iter().any(|(k,v)| k == "content-encoding" && v != "identity")
            || !original.headers.iter().any(|(k,v)| k == "content-type" && v.split(';').next().is_some_and(|m|m.trim() == "application/json"))
        { return Err(local_error()); }
        // Parsing is an inspection only. The original raw bytes (including
        // files/agents/skills/metadata/parts/delivery/resume and whitespace) stay
        // untouched in NativeWebOriginal and its private durable projection.
        let body: Value = serde_json::from_slice(original.body()).map_err(|_| local_error())?;
        let object = body.as_object().ok_or_else(local_error)?;
        let upstream_message_id = object.get("id").map(|v|v.as_str().filter(|s|s.starts_with("msg_") && s.len() <= 160 && s.bytes().all(|b|b.is_ascii_alphanumeric() || b == b'_' || b == b'-')).map(str::to_owned).ok_or_else(local_error)).transpose()?;
        let delivery = object.get("delivery").map(|v|v.as_str().filter(|s|["steer","queue"].contains(s)).map(str::to_owned).ok_or_else(local_error)).transpose()?;
        let resume = object.get("resume").map(|v|v.as_bool().ok_or_else(local_error)).transpose()?;
        let skills = object.get("skills").map(|v|v.as_array().ok_or_else(local_error)).transpose()?;
        let skill_ids = skills.into_iter().flatten().map(|v|v.get("id").and_then(Value::as_str).map(str::to_owned).ok_or_else(local_error)).collect::<Result<Vec<_>,_>>()?;
        if !references::valid_skill_selection(&skill_ids) { return Err(local_error()); }
        let engine = self.lock_engine_for_directory(lease.binding.directory())?;
        let observed = observe(&engine, &lease.binding, lease.session_id(), self.credentials_revision(), current)?;
        if observed != lease.original || lease.revoked() { return Err(local_error()); }
        let session = engine.client()?.session_in_project(lease.session_id(), &SessionQuery {
            directory: lease.binding.directory().into(), ..SessionQuery::default()
        })?;
        let model = session.model.as_ref().ok_or_else(local_error)?;
        let agent = session.agent.as_deref().ok_or_else(local_error)?;
        if session.id != lease.session_id() || session.project_id != observed.project_id
            || session.location.directory != lease.binding.directory()
            || model.id != engine.model.id || model.provider_id != provider_config::PROVIDER_ID
            || task_permissions::managed_profile(agent).is_some()
            || self.presentation_record(lease.session_id())?.archived
        { return Err(local_error()); }
        let agents = engine.client()?.agents(lease.binding.directory())?;
        if !agents.iter().any(|a|a.id == agent && a.mode == "primary" && !a.hidden)
            || object.get("metadata").and_then(|m|m.get("agent")).is_some_and(|v|v.as_str() != Some(agent))
        { return Err(local_error()); }
        if let Some(selected) = object.get("metadata").and_then(|m|m.get("model")) {
            if selected.get("modelID").and_then(Value::as_str) != Some(engine.model.id.as_str())
                || selected.get("providerID").and_then(Value::as_str) != Some(provider_config::PROVIDER_ID)
                || selected.get("variant").is_some_and(|v|v.as_str() != Some(engine.model.variant.as_str()))
            { return Err(local_error()); }
        }
        if let Some(mentions) = object.get("agents") {
            for mention in mentions.as_array().ok_or_else(local_error)? {
                let name = mention.get("name").and_then(Value::as_str).ok_or_else(local_error)?;
                if task_permissions::managed_profile(name).is_some()
                    || !agents.iter().any(|a|a.id == name && !a.hidden) { return Err(local_error()); }
            }
        }
        if !engine.model.vision && object.get("files").and_then(Value::as_array).is_some_and(|files| files.iter().any(|file|file.get("uri").and_then(Value::as_str).is_some_and(|uri|uri.starts_with("data:image/")))) {
            return Err(RuntimeError::Unavailable("The loaded model does not support image input"));
        }
        references::validate_skills(engine.client()?, lease.binding.directory(), &skill_ids)?;
        self.enforce_custom_assistant_session(&engine, &session)?;
        require_local_engine(&engine, &lease.binding, current)?;
        if self.credentials_revision() != lease.original.revision || lease.revoked() { return Err(local_error()); }
        Ok(LocalWebPromptInspection { upstream_message_id, delivery, resume, skill_ids })
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    #[test] fn framed_hash_binds_exact_whitespace_and_boundaries() {
        assert_ne!(input_hash(b"a", b"bc"), input_hash(b"ab", b"c"));
        assert_ne!(input_hash(b"route", br#"{"text":"x"}"#), input_hash(b"route", br#"{ "text": "x" }"#));
        assert_ne!(input_hash(b"first-session", b"x"), input_hash(b"other-session", b"x"));
    }
    #[test] fn full_prompt_bytes_are_not_rewritten_by_route_or_scope_validation() {
        let body = br#"{ "id":"msg_original","text":"hello","files":[{"uri":"data:text/plain;base64,AA==","name":"x","mention":{"start":0,"end":1}}],"skills":[{"id":"skill_x","name":"x"}],"agents":[{"name":"build"}],"metadata":{"model":{"modelID":"actual","providerID":"veyra"},"attachments":[{"unique":"retain"}]},"parts":[{"type":"future","value":"retain"}],"delivery":"queue","resume":false }"#;
        let before = body.to_vec();
        let (_,route,query,_) = request_parts("POST","/api/session/ses_actual/prompt?location%5Bdirectory%5D=%2Fprivate&opaque=a%2Bb",
            &[("Content-Type".into(),"application/json; charset=utf-8".into())],body,"/private").unwrap();
        assert_eq!(body, before.as_slice());
        assert_eq!(route,"/api/session/ses_actual/prompt");
        assert_eq!(query,vec![("location[directory]".into(),"/private".into()),("opaque".into(),"a+b".into())]);
    }
    #[test] fn foreign_duplicate_ambiguous_or_encoded_scope_is_refused() {
        for target in ["//foreign/api", "/a/../api/session", "/api/%2E%2E/session", "/api/%252f/session",
            "/api/%2f/session", "/api/session#fragment", "/api/session?directory=%2Fforeign",
            "/api/session?directory=%2Fprivate&location%5Bdirectory%5D=%2Fprivate",
            "/api/session?location%5Bproject%5D=foreign", "/api/session?opaque=%00"] {
            assert!(request_parts("POST",target,&[],b"{}","/private").is_err(),"{target}");
        }
    }
    #[test] fn only_closed_content_headers_and_supported_methods_are_captured() {
        for header in ["Authorization","Proxy-Authorization","Cookie","Host","Origin","Connection","Upgrade","Sec-WebSocket-Key","Content-Length"] {
            assert!(request_parts("POST","/api/session",&[(header.into(),"x".into())],b"{}","/private").is_err());
        }
        assert!(request_parts("CONNECT","/api/session",&[],b"","/private").is_err());
        assert!(request_parts("GET","/api/session",&[],b"{}","/private").is_err());
        assert!(request_parts("POST","/api/session",&[("Content-Type".into(),"x\r\ny".into())],b"{}","/private").is_err());
    }
}
