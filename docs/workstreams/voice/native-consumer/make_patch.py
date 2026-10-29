"""Generate an exact proposal from a read-only native checkout; no native writes."""
import difflib
import hashlib
import json
from pathlib import Path
import sys

HERE = Path(__file__).resolve().parent
native = Path(sys.argv[1]).resolve()
relative = "crates/adapters/src/speech.rs"
original = (native / relative).read_bytes().decode("utf-8")
source = original


def replace(old, new):
    """Refuse drift instead of applying approximate changes to a native owner."""
    global source
    if source.count(old) != 1:
        raise SystemExit(f"Expected exactly one preimage: {old[:100]!r}")
    source = source.replace(old, new, 1)


replace("mod privacy;", "mod privacy;\nmod http_worker;")
replace("    first_stop: OnceLock<Instant>,\n", "    first_stop: OnceLock<Instant>,\n    remote: Result<Option<http_worker::Config>>,\n    remote_uncertain: Arc<AtomicBool>,\n")
replace("pub fn status() -> Value {\n", "fn local_status() -> Value {\n")
replace("impl Speech {\n", """impl Speech {
    pub fn status(&self) -> Value {
        // The same immutable selection drives status and execution. Status never
        // reloads a credential/backend/default from the process environment.
        match &self.remote {
            Ok(Some(config)) => config.status(),
            Ok(None) => local_status(),
            Err(_) => json!({"backend":"unavailable", "available":false,
                "qualified":false,"transcription_configured":false,"synthesis_configured":false}),
        }
    }
""")
replace('"realtime_duplex":"unverified"})', '"realtime_duplex":"unverified", "backend":"local-process",\n        "limits":{"max_recording_ms":60000,"max_text_chars":2000},\n        "configured_default_voice":"af_sarah","voices":[],"voice_catalog_verified":false})')
replace("            first_stop: OnceLock::new(),", "            first_stop: OnceLock::new(),\n            remote: http_worker::Config::load(),\n            remote_uncertain: Arc::new(AtomicBool::new(false)),")
replace('        let voice = voice.unwrap_or_else(|| "af_sarah".into());', '''        let voice = match voice {
            Some(voice) => voice,
            None => match &self.remote {
                Ok(Some(config)) => config.default_voice(),
                Ok(None) => "af_sarah".into(),
                Err(error) => return Err(*error),
            },
        };''')
replace("        if jobs.len() >= 16 {", """        match &self.remote {
            Ok(Some(config)) => config.validate(&input)?,
            Err(error) => return Err(*error),
            Ok(None) => {},
        }
        if jobs.len() >= 16 {""")
# Remote provenance is retained even for an interrupted process whose receipt
# remains 'running'. Restart never clears uncertainty by losing an in-memory flag.
replace('            provenance: json!({"execution":"CPU","qualified":false}),', '            provenance: json!({"execution":"CPU","qualified":false,"remote_cpu":matches!(&self.remote, Ok(Some(_)))}),')
replace("        let worker_digest = digest.clone();", "        let worker_digest = digest.clone();\n        let remote = self.remote.clone();\n        let remote_uncertain = self.remote_uncertain.clone();")
replace("            let result = execute(&directory, &operation_id, input, &worker_cancel);", """            let result = match remote {
                Ok(Some(config)) => config.execute(&operation_id, input, &worker_cancel),
                Ok(None) => execute(&directory, &operation_id, input, &worker_cancel)
                    .map_err(http_worker::Failure::Known),
                Err(error) => Err(http_worker::Failure::Known(error)),
            };
            // Joining an HTTP helper cannot prove remote kernel retirement.
            if matches!(&result, Err(http_worker::Failure::RemoteUncertain)) {
                remote_uncertain.store(true, Ordering::Release);
            }""")
replace("                    Err(_) if worker_cancel.load(Ordering::Acquire) => {", """                    Err(http_worker::Failure::RemoteUncertain) => {
                        view.state = "uncertain".into();
                        view.message = Some("Remote speech outcome is unknown; no replay, new speech effects or retirement until authoritative reconciliation".into());
                    }
                    Err(http_worker::Failure::Known(_)) if worker_cancel.load(Ordering::Acquire) => {""")
replace("                    Err(error) => {\n                        view.state = \"failed\".into();", "                    Err(http_worker::Failure::Known(error)) => {\n                        view.state = \"failed\".into();")
replace('                            "Local speech operation cancelled after its owned helper stopped"', '''                            if view.provenance["remote_cpu"] == true {
                                "Remote speech cancellation settled after the original handler returned"
                            } else {
                                "Local speech operation cancelled after its owned helper stopped"
                            }''')
replace("                    let (mut running, mut failed) = (false, false);", """                    if self.remote_quarantined(&jobs)? { return Err(Error::Unavailable); }
                    let (mut running, mut failed) = (false, false);""")
replace("                    if running {", """                    if self.remote_quarantined(&jobs)? { return Err(Error::Unavailable); }
                    if running {""")
replace("        let mut jobs = self.mutation_gate()?;", "        let mut jobs = self.mutation_gate()?;\n        if self.remote_quarantined(&jobs)? { return Err(Error::Unavailable); }")
replace("    // Every mutating entry holds this guard through its final filesystem effect.", """    fn remote_quarantined(&self, jobs: &BTreeMap<String, Job>) -> Result<bool> {
        if self.remote_uncertain.load(Ordering::Acquire) { return Ok(true); }
        for job in jobs.values() {
            let view = job.view.lock().map_err(|_| Error::Unavailable)?;
            if view.provenance["remote_cpu"] == true && view.state == "uncertain" {
                self.remote_uncertain.store(true, Ordering::Release);
                return Ok(true);
            }
        }
        let entries = match fs::read_dir(&self.directory) {
            Ok(entries) => entries,
            Err(error) if error.kind() == std::io::ErrorKind::NotFound => return Ok(false),
            Err(_) => return Err(Error::Unavailable),
        };
        for entry in entries {
            let entry = entry.map_err(|_| Error::Unavailable)?;
            if entry.path().extension().is_none_or(|ext| ext != "json") { continue; }
            let path = entry.path();
            let id = path.file_stem().and_then(|s| s.to_str()).ok_or(Error::Unavailable)?;
            let receipt = read_receipt(&self.directory, id)?.ok_or(Error::Unavailable)?;
            if http_worker::receipt_blocks(&receipt.operation, jobs.contains_key(id)) {
                self.remote_uncertain.store(true, Ordering::Release);
                return Ok(true);
            }
        }
        Ok(false)
    }
    // Every mutating entry holds this guard through its final filesystem effect.""")

module = (HERE / "http_worker.rs").read_text()
extras = {}


def propose(name, anchors):
    """Only exact status-callsite rewiring; preserve all request/agent authority."""
    before = (native / name).read_bytes().decode("utf-8")
    after = before
    for old, new, count in anchors:
        if after.count(old) != count:
            raise SystemExit(f"Native status-callsite drift: {name}: {old!r}")
        after = after.replace(old, new)
    extras[name] = (before, after)


propose("crates/adapters/src/voice.rs", [
    ("crate::speech::status()", "self.speech.status()", 2)])
fallback = 'json!({"backend":"unavailable","available":false,"qualified":false,"transcription_configured":false,"synthesis_configured":false})'
propose("apps/service/src/routes/speech.rs", [
    ("use veyra_adapters::speech::{self, Error, Operation, Speech};", "use veyra_adapters::speech::{Error, Operation, Speech};", 1),
    ("async fn status() -> Json<Value> {\n    Json(speech::status())\n}",
     "async fn status(State(state): State<Arc<super::ServiceState>>) -> Json<Value> {\n"
     "    let speech = state.speech.clone();\n"
     "    Json(tokio::task::spawn_blocking(move || speech.status()).await\n"
     "        .unwrap_or_else(|_| " + fallback + "))\n}", 1)])
propose("apps/service/src/routes/voice.rs", [
    ("async fn status() -> Json<Value> {\n", "async fn status(State(state): State<Arc<ServiceState>>) -> Json<Value> {\n"
     "    let speech = state.speech.clone();\n"
     "    let speech_status = tokio::task::spawn_blocking(move || speech.status()).await\n"
     "        .unwrap_or_else(|_| " + fallback + ");\n", 1),
    ("veyra_adapters::speech::status()", "speech_status", 1)])
patch = "".join(difflib.unified_diff(original.splitlines(True), source.splitlines(True),
    fromfile="a/" + relative, tofile="b/" + relative))
patch += "".join(difflib.unified_diff([], module.splitlines(True),
    fromfile="/dev/null", tofile="b/crates/adapters/src/speech/http_worker.rs"))
for name, (before, after) in extras.items():
    patch += "".join(difflib.unified_diff(before.splitlines(True), after.splitlines(True),
        fromfile="a/" + name, tofile="b/" + name))
(HERE / "native-cpu-http.patch").write_text(patch, newline="\n")
manifest = {
    "nativeHead": "268962e20bef8c246fce332241c08c00c1fc2317",
    "nativePreimages": {relative: hashlib.sha256(original.encode()).hexdigest()},
    "proposedPostimages": {relative: hashlib.sha256(source.encode()).hexdigest(),
        "crates/adapters/src/speech/http_worker.rs": hashlib.sha256(module.encode()).hexdigest()},
    "patchSha256": hashlib.sha256(patch.encode()).hexdigest(),
    "activation": "not authorized or performed; coordinator composition/build/runtime acceptance required",
}
for name, (before, after) in extras.items():
    manifest["nativePreimages"][name] = hashlib.sha256(before.encode()).hexdigest()
    manifest["proposedPostimages"][name] = hashlib.sha256(after.encode()).hexdigest()
inspected = ["apps/service/src/routes/speech.rs", "apps/service/src/routes/voice.rs",
    "apps/service/src/routes/live_agent/voice.rs", "crates/adapters/src/voice.rs",
    "crates/adapters/src/speech/privacy.rs", "crates/adapters/src/media_worker.rs",
    "apps/web/src/features/workbench/SpeechControls.tsx",
    "apps/web/src/features/workbench/VoiceChat.tsx",
    "apps/web/src/features/workbench/VoiceWorkspace.tsx", "apps/web/src/platform/gateway.ts",
    "crates/adapters/src/windows_acl.rs", "crates/adapters/src/windows_file_metadata.rs",
    "crates/adapters/src/opencode/service_launch_config/loader/native.rs"]
manifest["nativeOwnerSourceHashes"] = {name: hashlib.sha256((native / name).read_bytes()).hexdigest()
    for name in inspected}
worker = HERE.parents[3] / "packages/veyra-voice/speech-worker"
manifest["workerContractHashes"] = {name: hashlib.sha256((worker / name).read_bytes()).hexdigest()
    for name in ["veyra_worker.py", "inference_control.py"]}
(HERE / "provenance.json").write_text(json.dumps(manifest, indent=2) + "\n")
print(json.dumps(manifest, indent=2))
