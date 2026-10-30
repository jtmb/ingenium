"""Generate a review-only delta from exact Git blobs; never edit native source."""
import difflib
import hashlib
import json
import pathlib
import re
import subprocess

BASE = 'a04ab38bd0e0c7b96f40689733cad3f2332b9a0b'
HERE = pathlib.Path(__file__).resolve().parent
NATIVE = HERE.parents[5] / 'windows-source'
GIT = ['git', '--no-optional-locks', '-c', 'safe.directory=' + str(NATIVE).replace('\\', '/'), '-C', str(NATIVE)]
originals, outputs = {}, {}
def read(path):
    value = subprocess.check_output(GIT + ['show', BASE + ':' + path]).decode('utf-8')
    originals[path] = value
    return value
def replace(value, before, after, count=1):
    if value.count(before) != count:
        raise ValueError('Exact anchor count mismatch: ' + before[:100] + ': ' + str(value.count(before)))
    return value.replace(before, after)

path = 'crates/adapters/src/voice.rs'
s = read(path)
s = replace(s, 'mod privacy;', 'mod privacy;\n#[path = "voice/segments.rs"]\nmod segments;')
s = replace(s, 'pub struct UtteranceView {', 'pub struct UtteranceView {\n    #[serde(default)]\n    pub children: Vec<segments::SpeechChild>,')
s = replace(s, 'struct Utterance {', 'struct Utterance {\n    #[serde(default)]\n    original_audio: Option<String>,')
s = replace(s, '// Exactly the canonical speech format, bounded to a 20-second VAD turn.', '// One retained logical capture; neural ASR calls remain bounded to 15 seconds.')
s = replace(s, 'wav_base64.len() > 860000', 'wav_base64.len() > 2_560_064')
s = replace(s, 'wav.len() < 46', 'wav.len() < 8044')
s = replace(s, 'wav.len() > 44 + 16000 * 2 * 20', 'wav.len() > 44 + segments::MAX_CAPTURE_BYTES')
s = replace(s, '        let mut workers = self.worker_gate()?;\n        self.reap_workers(&mut workers)?;\n        self.admit_worker(&workers, id)?;\n        let initial = UtteranceView {', '''        // Reserve private receipt headroom before any speech/admission effect.
        // No eviction of original captures to make room for the next turn.
        if serde_json::to_vec(&*record).map_err(|_| Error::Unavailable)?.len()
            + wav_base64.len() + 512 * 1024 > segments::MAX_RECORD_BYTES {
            return Err(Error::Conflict);
        }
        let children = segments::pcm_children(&wav[44..])?;
        let mut workers = self.worker_gate()?;
        self.reap_workers(&mut workers)?;
        self.admit_worker(&workers, id)?;
        let initial = UtteranceView {
            children: children.clone(),''')
s = replace(s, 'view: initial.clone(), digest: digest.clone(),\n                        asr_id: uuid::Uuid::new_v4().to_string(), tts_id: None,', 'view: initial.clone(), digest: digest.clone(), original_audio: Some(wav_base64.clone()),\n                        asr_id: children[0].request_id.clone(), tts_id: None,')
s = replace(s, 'None if record.state == "stopped" => UtteranceView {', 'None if record.state == "stopped" => UtteranceView {\n                children: Vec::new(),')
s = replace(s, 'if result.state == "completed" {\n            result.wav_base64', 'if result.state == "awaiting_playback" || (result.state == "completed" && result.children.is_empty()) {\n            result.wav_base64')
s = replace(s, '                .get(id)\n                .cloned();\n        }\n        Ok(result)', '                .get(result.speech_operation_id.as_deref().unwrap_or(id))\n                .cloned();\n        }\n        Ok(result)')
s = replace(s, '    pub fn control(\n', '''    /// Claim and acknowledge one exact current playback under its original Voice
    /// record. A read/reconnect never claims, starts or acknowledges playback.
    pub fn playback(&self, session: &str, id: &str, child: &str, claim: &str,
        generation: u64, played: bool) -> Result<UtteranceView> {
        uuid(id)?; uuid(child)?; uuid(claim)?;
        let slot = self.slot(session)?;
        let _dispatch = slot.dispatch.lock().map_err(|_| Error::Unavailable)?;
        let mut record = slot.record.lock().map_err(|_| Error::Unavailable)?;
        if record.active.as_deref() != Some(id) || record.state != "speaking"
            || self.stopping.load(Ordering::Acquire) { return Err(Error::Conflict); }
        let utterance = find_mut(&mut record, id)?;
        if utterance.view.state != "awaiting_playback"
            || utterance.view.speech_operation_id.as_deref() != Some(child) { return Err(Error::Conflict); }
        let part = utterance.view.children.iter_mut().find(|part| part.request_id == child)
            .ok_or(Error::NotFound)?;
        if part.generation != generation || part.kind != "tts" || part.state != "completed" {
            return Err(Error::Conflict);
        }
        let previous = part.clone();
        match part.playback_id.as_deref() {
            None if !played && part.playback_state.as_deref() == Some("ready") => {
                part.playback_id = Some(claim.into()); part.playback_state = Some("claimed".into());
            }
            Some(original) if original == claim => {
                if played && part.playback_state.as_deref() == Some("claimed") {
                    part.playback_state = Some("played".into());
                } else if played && part.playback_state.as_deref() != Some("played") { return Err(Error::Conflict); }
            }
            _ => return Err(Error::Conflict),
        }
        // Retain acknowledgement BEFORE releasing the only cached child WAV.
        if let Err(error) = self.persist(&record) {
            // A failed durable acknowledgement cannot advance the worker from an
            // optimistic in-memory value. Preserve the cache and prior receipt.
            *find_mut(&mut record,id)?.view.children.iter_mut().find(|part| part.request_id == child)
                .ok_or(Error::Unavailable)? = previous;
            return Err(error);
        }
        if played { self.release_audio(child)?; }
        Ok(find(&record, id)?.view.clone())
    }
    pub fn control(
''')
s = replace(s, '''let local_done = std::iter::once(Some(utterance.asr_id.as_str()))
                            .chain(std::iter::once(utterance.tts_id.as_deref()))
                            .flatten()''', '''let local_done = utterance.view.children.iter().map(|part| part.request_id.as_str())
                            .chain(std::iter::once(utterance.asr_id.as_str()))
                            .chain(utterance.tts_id.as_deref())''')
s = replace(s, 'local_done && (utterance.turn_terminal || !utterance.admission_started)', '''local_done && !utterance.view.children.iter().any(|part|
                            matches!(part.playback_state.as_deref(), Some("ready" | "claimed")))
                            && (utterance.turn_terminal || !utterance.admission_started)''')
start = s.index('        let asr = {', s.index('    fn process_utterance('))
end = s.index('        let _dispatch = slot.dispatch.lock()', s.index('        let transcript = transcription', start))
s = s[:start] + '''        use base64::Engine as _;
        let original = base64::engine::general_purpose::STANDARD.decode(&audio).map_err(|_| Error::Invalid)?;
        let children = {
            let record = slot.record.lock().map_err(|_| Error::Unavailable)?;
            let utterance = find(&record, id)?;
            if utterance.original_audio.as_deref() != Some(audio.as_str()) { return Err(Error::Conflict); }
            utterance.view.children.clone()
        };
        let mut transcripts = Vec::new();
        for child in children.iter().filter(|child| child.kind == "asr") {
            let wav = base64::engine::general_purpose::STANDARD.encode(segments::child_wav(&original, child)?);
            {
                let _dispatch = slot.dispatch.lock().map_err(|_| Error::Unavailable)?;
                if self.cancelling(cancel) { return Ok(()); }
                self.child_state(&slot, id, &child.request_id, "dispatching")?;
                self.submit_speech(cancel, || self.speech.transcribe(&child.request_id, &wav))?;
            }
            let result = self.wait_speech(&child.request_id, cancel, Instant::now()+Duration::from_secs(185))?;
            let text = result.text.filter(|text| text.chars().count() <= 2000).ok_or(Error::Invalid)?;
            self.child_state(&slot, id, &child.request_id, "completed")?;
            transcripts.push(text);
        }
        // Exact ordered child transcripts, no overlap heuristic or deduplication.
        // This is one prompt admission and the existing transcript writer.
        let transcript = transcripts.join("\\n");
        if transcript.trim().is_empty() { return Err(Error::Invalid); }
''' + s[end:]
s = replace(s, '        let shortened = full_reply.chars().count() > 2000;\n        let spoken: String = full_reply.chars().take(2000).collect();', '')
s = replace(s, '''utterance.view.reply_text = Some(spoken.clone());
            if shortened {
                utterance.view.message = Some("Speech reads the first 2,000 characters; the complete reply remains in the chat.".into());
            }''', '''utterance.view.reply_text = Some(full_reply.clone());
            // The complete reply is retained before planning can refuse it.''')
start = s.index('        if read && !spoken.trim().is_empty() {')
end = s.index('        if self.cancelling(cancel) {', s.index('self.cache_audio(id, wav)?;', start))
s = s[:start] + '''        let plan = if read { segments::text_children(&full_reply)? } else { Vec::new() };
        {
            let mut record = slot.record.lock().map_err(|_| Error::Unavailable)?;
            if self.cancelling(cancel) || record.active.as_deref() != Some(id) { return Ok(()); }
            find_mut(&mut record,id)?.view.children.extend(plan.clone()); self.persist(&record)?;
        }
        if read {
            for child in &plan {
                let spoken = full_reply[child.source_start..child.source_end].replace('\\r', "\\n");
                if segments::digest(spoken.as_bytes()) != child.speech_digest { return Err(Error::Conflict); }
                let dispatch = slot.dispatch.lock().map_err(|_| Error::Unavailable)?;
                if self.cancelling(cancel) { return Ok(()); }
                {
                    let mut record = slot.record.lock().map_err(|_| Error::Unavailable)?;
                    let utterance = find_mut(&mut record, id)?;
                    utterance.tts_id = Some(child.request_id.clone());
                    utterance.view.speech_operation_id = Some(child.request_id.clone());
                    utterance.view.state = "synthesizing".into();
                    utterance.view.children.iter_mut().find(|part| part.request_id == child.request_id)
                        .ok_or(Error::Unavailable)?.state = "dispatching".into();
                    record.state = "processing".into(); self.persist(&record)?;
                }
                self.submit_speech(cancel, || self.speech.synthesize(&child.request_id, spoken, voice.clone()))?;
                drop(dispatch);
                let synthesized = self.wait_speech(&child.request_id, cancel, Instant::now()+Duration::from_secs(185))?;
                let wav = synthesized.wav_base64.ok_or(Error::Unavailable)?;
                let wav_digest = segments::digest(&base64::engine::general_purpose::STANDARD.decode(&wav).map_err(|_| Error::Invalid)?);
                // Publication is serialized with original cancellation, so a
                // late result cannot repopulate audio after control cleaned it.
                let publication = slot.dispatch.lock().map_err(|_| Error::Unavailable)?;
                if self.cancelling(cancel) { return Ok(()); }
                self.cache_audio(&child.request_id, wav)?;
                {
                    let mut record = slot.record.lock().map_err(|_| Error::Unavailable)?;
                    if self.cancelling(cancel) || record.active.as_deref() != Some(id) { return Ok(()); }
                    let utterance = find_mut(&mut record, id)?;
                    let part = utterance.view.children.iter_mut().find(|part| part.request_id == child.request_id).ok_or(Error::Unavailable)?;
                    part.state = "completed".into(); part.wav_digest = Some(wav_digest);
                    part.playback_state = Some("ready".into());
                    utterance.view.state = "awaiting_playback".into(); record.state = "speaking".into();
                    self.persist(&record)?;
                }
                drop(publication);
                // One child at a time: next inference requires exact browser ended
                // acknowledgement. Timeout/reconnect cannot manufacture it.
                let deadline = Instant::now()+Duration::from_secs(120);
                loop {
                    if self.cancelling(cancel) { return Ok(()); }
                    let record = slot.record.lock().map_err(|_| Error::Unavailable)?;
                    let part = find(&record,id)?.view.children.iter().find(|part| part.request_id == child.request_id).ok_or(Error::Unavailable)?;
                    if part.playback_state.as_deref() == Some("played") { break; }
                    drop(record);
                    if Instant::now() >= deadline { return Err(Error::Unavailable); }
                    thread::sleep(Duration::from_millis(50));
                }
            }
        }
''' + s[end:]
s = replace(s, '''for speech in std::iter::once(Some(utterance.asr_id.clone()))
            .chain(std::iter::once(utterance.tts_id.clone()))
            .flatten()''', '''for speech in utterance.view.children.iter().map(|part| part.request_id.clone())
            .chain(std::iter::once(utterance.asr_id.clone())).chain(utterance.tts_id.clone())
            .collect::<std::collections::BTreeSet<_>>()''')
# Invalidate stale playback acknowledgements only after the exact speech cancellation
# loop has reconciled all child operations; original engine interrupt logic follows.
s = replace(s, '        if utterance.admission_started && !utterance.turn_terminal {', '''        {
            let mut record = slot.record.lock().map_err(|_| Error::Unavailable)?;
            let original = find_mut(&mut record, &utterance.view.id)?;
            for child in &mut original.view.children {
                child.generation += 1;
                if child.playback_state.as_deref() != Some("played") { child.playback_state = Some("cancelled".into()); }
                self.release_audio(&child.request_id)?;
            }
            self.persist(&record)?;
        }
        if utterance.admission_started && !utterance.turn_terminal {''')
start=s.index('        while audio.bytes + wav.len() > 32 * 1024 * 1024 {')
end=s.index('        audio.bytes += wav.len();',start)
s=s[:start]+'''        // Never evict a current, unacknowledged child. Capacity is a refusal.
        if audio.entries.contains_key(id) || audio.bytes + wav.len() > 32 * 1024 * 1024 {
            return Err(Error::Unavailable);
        }
'''+s[end:]
s = replace(s, '    fn cache_audio(&self, id: &str, wav: String) -> Result<()> {', '''    fn child_state(&self, slot: &Slot, id: &str, child: &str, state: &str) -> Result<()> {
        let mut record = slot.record.lock().map_err(|_| Error::Unavailable)?;
        find_mut(&mut record,id)?.view.children.iter_mut().find(|part| part.request_id == child)
            .ok_or(Error::NotFound)?.state = state.into();
        self.persist(&record)
    }
    fn release_audio(&self, id: &str) -> Result<()> {
        let mut audio = self.audio.lock().map_err(|_| Error::Unavailable)?;
        if let Some(wav) = audio.entries.remove(id) { audio.bytes -= wav.len(); }
        audio.order.retain(|key| key != id); Ok(())
    }
    fn cache_audio(&self, id: &str, wav: String) -> Result<()> {''')
s=re.sub(r'(?<!\d)2 \* 1024 \* 1024','segments::MAX_RECORD_BYTES',s)
s=s.replace('metadata.len() > segments::MAX_RECORD_BYTES', 'metadata.len() > segments::MAX_RECORD_BYTES as u64')
s=s.replace('file.take(segments::MAX_RECORD_BYTES + 1)', 'file.take((segments::MAX_RECORD_BYTES + 1) as u64)')
outputs[path]=s
outputs[path]+='\n#[cfg(test)]\n#[path = "voice/continuous_tests.rs"]\nmod continuous_tests;\n'
outputs['crates/adapters/src/voice/continuous_tests.rs']=(HERE/'native_playback_tests.rs').read_text(encoding='utf-8')
path='crates/adapters/src/voice/privacy.rs'
s=read(path).replace('2 * 1024 * 1024','segments::MAX_RECORD_BYTES')
s=s.replace('metadata.len() > segments::MAX_RECORD_BYTES', 'metadata.len() > segments::MAX_RECORD_BYTES as u64')
s=s.replace('file.take(segments::MAX_RECORD_BYTES + 1)', 'file.take((segments::MAX_RECORD_BYTES + 1) as u64)')
# privacy module imports super::* (checked by generator precondition below).
assert 'use super::*;' in s
s=replace(s,'        speech.insert(utterance.asr_id.clone());','''        speech.insert(utterance.asr_id.clone());
        for child in &utterance.view.children {
            uuid(&child.request_id)?;
            speech.insert(child.request_id.clone());
            utterances.insert(child.request_id.clone()); // child-keyed current WAV cache
        }''')
outputs[path]=s
outputs['crates/adapters/src/voice/segments.rs']=(HERE/'native_segments.rs').read_text(encoding='utf-8')

path='apps/service/src/routes/voice.rs'
s=read(path)
s=replace(s,'.layer(DefaultBodyLimit::max(1024 * 1024))','.route("/sessions/{id}/utterances/{utterance}/playback", post(playback))\n        .layer(DefaultBodyLimit::max(3 * 1024 * 1024))')
s=replace(s,'at most 20 seconds','at most 60 seconds (15-second speech children)')
s=replace(s,'''    let max_utterance_seconds = speech_status["limits"]["max_recording_ms"]
        .as_u64().map(|ms| ms.min(20_000) as f64 / 1000.0).unwrap_or(20.0);''','''    let max_utterance_seconds = 60;
    // Aggregate capture capability is separate from the unchanged worker limit.''')
s=replace(s,'"max_unacknowledged_utterances":1','"segmented_capture":true,"playback_protocol":"voice-child-claim-v1","max_unacknowledged_utterances":1')
s+='''
#[derive(Deserialize)]
#[serde(deny_unknown_fields)]
struct Playback {
    child_request_id: String,
    claim_id: String,
    generation: u64,
    played: bool,
}
async fn playback(State(state): State<Arc<ServiceState>>, Path((id, utterance)): Path<(String,String)>,
    payload: Result<Json<Playback>, axum::extract::rejection::JsonRejection>) -> Result<Json<Value>,ApiError> {
    ready(&state)?;
    let payload = body(payload)?; let owner = owner(&state)?;
    let result = tokio::task::spawn_blocking(move || owner.playback(&id,&utterance,
        &payload.child_request_id,&payload.claim_id,payload.generation,payload.played)).await
        .map_err(|_| ApiError(Error::Unavailable))?.map_err(ApiError)?;
    Ok(Json(serde_json::to_value(result).map_err(|_| ApiError(Error::Unavailable))?))
}
'''
outputs[path]=s

# Browser proposal appended below: the native owner delta is intentionally generated
# together with its consumer, so review cannot silently wire only half a protocol.

path='apps/web/src/features/workbench/VoiceChat.tsx'
s=read(path)
s=replace(s,'type Tracking = { sessionId: string;', 'type Playback = { childId: string; claimId: string; generation: number };\ntype Tracking = { playback?: Playback; sessionId: string;')
s=replace(s,'"stopRequested"].includes(field)', '"stopRequested", "playback"].includes(field)')
s=replace(s,'    return value as Tracking;', '''    if (value.playback !== undefined) {
      const playback = obj(value.playback);
      if (Object.keys(playback).sort().join() !== "childId,claimId,generation" || !uuid.test(text(playback.childId))
        || !uuid.test(text(playback.claimId)) || typeof playback.generation !== "number" || !Number.isSafeInteger(playback.generation) || playback.generation < 1)
        throw new Error("Invalid original playback receipt");
    }
    return value as Tracking;''')
s=replace(s,'const count = capabilities.backend === "owned-http-cpu" ? boundedCount : Math.min(320000, Math.floor(length * 16000 / samples.rate));','const count = boundedCount;')
s=replace(s,'  const capabilities = speechCapabilities(speech);','''  const [voiceProtocol, setVoiceProtocol] = useState<Obj>({});
  const [retainedCapture, setRetainedCapture] = useState<Samples | null>(null);
  const capabilities = speechCapabilities(speech);
  const segmented = voiceProtocol.segmented_capture === true && voiceProtocol.playback_protocol === "voice-child-claim-v1"
    && voiceProtocol.max_utterance_seconds === 60;
  const captureCapabilities = segmented ? { ...capabilities, maxTurnMs: 60000 } : capabilities;''')
s=replace(s,'const presentationNeeded = monitoring || recording || playing || busy || paused || !!tracking', 'const presentationNeeded = monitoring || recording || playing || busy || paused || !!retainedCapture || !!tracking')
s=replace(s,'  const refuseUnsubmittedAudio = (message: string) => {\n    releaseMic(); stopPlayback();','''  const refuseUnsubmittedAudio = (message: string) => {
    const source = capture.current;
    if (source && devices.current) setRetainedCapture({ frames: source.frames, rate: devices.current.context.sampleRate });
    else if (queued.current) setRetainedCapture(queued.current);
    releaseMic(); stopPlayback();''')
s=replace(s,'  const releaseMic = () => {\n    generation.current++;', '''  const releaseMic = () => {
    const pending = queued.current || (capture.current?.confirmed && devices.current
      ? { frames: capture.current.frames, rate: devices.current.context.sampleRate } : null);
    if (live.current && pending) setRetainedCapture(previous => previous || pending);
    generation.current++;''')
s=replace(s,'No utterance was submitted. Existing session and control receipts remain unchanged; stop or resume explicitly when compatible.','No utterance was submitted. The full unsubmitted recording is retained in this view for export or explicit discard. Keep this view open until recovered.')
s=replace(s,'const playReply = (utterance: Obj) => {','const playReply = (utterance: Obj, ended?: () => void) => {')
s=replace(s,'audio.onended = () => { if (player.current === audio) stopPlayback(); };','audio.onended = () => { if (player.current === audio) { stopPlayback(); ended?.(); } };')
s=replace(s,'  const acceptUtterance = async (utterance: Obj, automatic: boolean) => {','''  const acceptUtterance = async (utterance: Obj, automatic: boolean) => {
    if (rows(utterance.children).length) {
      if (terminal(utterance.state)) return;
      const current = tracked.current;
      if (!current || utterance.id !== current.utteranceId) return;
      const child = rows(utterance.children).find(part => part.request_id === utterance.speech_operation_id);
      if (current.playback) {
        const original = rows(utterance.children).find(part => part.request_id === current.playback?.childId);
        if (original?.playback_id === current.playback.claimId && original.playback_state === "played") {
          const saved = { ...tracked.current! }; delete saved.playback; save(saved);
        } else if (!player.current && !tracked.current?.stopRequested && !tracked.current?.bargeId) {
          uncertain("The original segment playback is unconfirmed. It will not replay after reconnect. Check or stop the original voice session.");
        }
        return;
      }
      if (!automatic || !watching.current || utterance.state !== "awaiting_playback" || !child
        || child.kind !== "tts" || child.playback_state !== "ready" || child.state !== "completed"
        || !uuid.test(text(child.request_id)) || child.generation !== 1 || played.current.has(text(child.request_id))) return;
      const stamp = generation.current;
      await verifyPlaybackOwner();
      const encoded = text(utterance.wav_base64);
      if (!encoded || encoded.length > 12 * 1024 * 1024 || !/^[a-f0-9]{64}$/.test(text(child.wav_digest)))
        throw new Error("The current bounded waveform or its digest is unavailable.");
      const bytes = Uint8Array.from(atob(encoded), character => character.charCodeAt(0));
      const digest = [...new Uint8Array(await crypto.subtle.digest("SHA-256", bytes))]
        .map(value => value.toString(16).padStart(2,"0")).join("");
      if (digest !== child.wav_digest) throw new Error("The current child waveform does not match its original speech receipt.");
      if (!viewCurrent() || generation.current !== stamp || tracked.current?.stopRequested || tracked.current?.bargeId) return;
      const playback: Playback = { childId: text(child.request_id), claimId: crypto.randomUUID(), generation: 1 };
      // Persist local identity before the claim mutation, never infer playback
      // from a claim acknowledgement or a hydrated server snapshot.
      save({ ...tracked.current!, playback });
      const route = `/v1/voice/sessions/${current.sessionId}/utterances/${current.utteranceId}/playback`;
      const body = { child_request_id: playback.childId, claim_id: playback.claimId, generation: playback.generation };
      const claimed = obj(await request("POST", route, { ...body, played: false }));
      const accepted = rows(claimed.children).find(part => part.request_id === playback.childId);
      if (!viewCurrent() || generation.current !== stamp || tracked.current?.stopRequested || tracked.current?.bargeId) return;
      if (claimed.id !== current.utteranceId || accepted?.playback_id !== playback.claimId || accepted.playback_state !== "claimed")
        throw new Error("The exact child playback claim could not be confirmed.");
      played.current.add(playback.childId);
      playReply(utterance, () => {
        if (!viewCurrent() || generation.current !== stamp || tracked.current?.playback?.claimId !== playback.claimId
          || tracked.current?.stopRequested || tracked.current?.bargeId) return;
        void request("POST", route, { ...body, played: true }).then(() => {
          if (viewCurrent() && tracked.current?.playback?.claimId === playback.claimId) {
            const saved = { ...tracked.current! }; delete saved.playback; save(saved);
          }
        }).catch(() => uncertain("The segment ended, but its exact played acknowledgement is unknown. Check the original; no audio is replayed."));
      });
      return;
    }''')
s=replace(s,'delete saved.utteranceId; save(saved);','delete saved.utteranceId; delete saved.playback; save(saved);')
s=replace(s,'await acceptUtterance(result, !tracked.current?.stopRequested && !tracked.current?.bargeId);', '''await acceptUtterance(result, !tracked.current?.stopRequested && !tracked.current?.bargeId);
        if (!terminal(result.state) && tracked.current?.playback && !player.current) return;''')
# Session terminal projection also clears old child-local identity only when
# original parent is terminal, never when the child merely finishes inference.
s=replace(s,'delete next.utteranceId; save(next);','delete next.utteranceId; delete next.playback; save(next);')
s=replace(s,'    if (connected) { void request("GET", "/v1/speech/status")','''    if (connected) { void request("GET", "/v1/voice/status").then(value => { if (viewCurrent()) setVoiceProtocol(obj(value)); }).catch(() => {}); void request("GET", "/v1/speech/status")''')
s=replace(s,'try { data = wav(samples, capabilities); }','try { data = wav(samples, captureCapabilities); }')
s=replace(s,'catch (cause) { if (viewCurrent()) refuseUnsubmittedAudio(cause instanceof Error ? cause.message : "The complete recording could not be prepared. No audio was submitted."); return; }','catch (cause) { queued.current = samples; if (viewCurrent()) refuseUnsubmittedAudio(cause instanceof Error ? cause.message : "The complete recording could not be prepared. No audio was submitted."); return; }')
s=replace(s,'} catch (cause) { if (viewCurrent()) uncertain(`${cause instanceof Error ? cause.message : "The voice utterance outcome is unknown."} Its original request must be checked before another turn.`); }', '''} catch (cause) { if (viewCurrent()) {
      setRetainedCapture(previous => previous || samples);
      uncertain(`${cause instanceof Error ? cause.message : "The voice utterance outcome is unknown."} Its original request must be checked before another turn. The original local capture is retained for export; never resubmit it automatically.`);
    } }''')
s=replace(s,'    const maximum = capabilities.maxTurnMs / 1000;\n    const allowed = captureFrame(active.count, frame.length, rate, capabilities);\n    if (!allowed.ok) { refuseUnsubmittedAudio(allowed.message); return; }\n    const part = allowed.length === frame.length ? frame : frame.subarray(0, allowed.length);\n    if (part.length) { active.frames.push(new Float32Array(part)); active.count += part.length; }','''    const maximum = captureCapabilities.maxTurnMs / 1000;
    // Retain the complete incoming frame BEFORE any bound refusal; no clipping.
    active.frames.push(new Float32Array(frame)); active.count += frame.length;
    if (active.count > rate * maximum) {
      refuseUnsubmittedAudio(`The complete spoken turn exceeded ${maximum} seconds before its silence boundary. Recover the retained recording.`); return;
    }''')
s=replace(s,'if (capabilities.backend === "owned-http-cpu" && active.count >= rate * maximum && active.quiet < .7)', 'if (active.count >= rate * maximum && active.quiet < .7)')
s=replace(s,'The complete turn was discarded, not split or submitted.','The complete unsubmitted turn remains retained for recovery.')
s=replace(s,'if (!viewCurrent() || !connected || disabled || busy || starting.current || watching.current || !sessionId', 'if (!viewCurrent() || !connected || disabled || busy || starting.current || watching.current || retainedCapture || !sessionId')
s=replace(s,'maxSeconds = capabilities.maxTurnMs / 1000;', 'maxSeconds = captureCapabilities.maxTurnMs / 1000;')
s=replace(s,'disabled={!connected || disabled || busy || monitoring || !sessionId', 'disabled={!connected || disabled || busy || monitoring || !!retainedCapture || !sessionId')
s=replace(s,'    {!sessionId && <p>Create or select a chat first.</p>}', '''    {!sessionId && <p>Create or select a chat first.</p>}
    {retainedCapture && <div role="alert"><p>The complete unsubmitted capture is retained in this view. Export or discard it before resuming. Closing this view loses this unsubmitted copy.</p>
      <button type="button" onClick={() => {
        const source = retainedCapture;
        const header = JSON.stringify({ format: "veyra-float32-frames-v1", sampleRate: source.rate, frameLengths: source.frames.map(frame => frame.length) }) + "\\n";
        const url = URL.createObjectURL(new Blob([header, ...source.frames.map(frame => new Float32Array(frame).buffer)], { type: "application/octet-stream" }));
        const link = document.createElement("a"); link.href = url; link.download = "veyra-unsubmitted-capture.f32"; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
      }}>Export complete unsubmitted capture</button>
      <button type="button" onClick={() => { setRetainedCapture(null); setError(""); }}>Discard unsubmitted capture</button></div>}''')
s=replace(s,'replyAudio?.id === item.id ?', '!rows(item.children).length && replyAudio?.id === item.id ?')
s=replace(s,': item.state === "completed" && text(item.speech_operation_id)', ': !rows(item.children).length && item.state === "completed" && text(item.speech_operation_id)')
# Remove obsolete unused import from the now-whole-frame capture path.
s=replace(s,'{ captureFrame, recordingFrames,','{ recordingFrames,')
outputs[path]=s

def write():
    patch=''
    receipts=[]
    for path,after in outputs.items():
        before=originals.get(path,'')
        patch+=''.join(difflib.unified_diff(before.splitlines(True),after.splitlines(True),
            fromfile='a/'+path if path in originals else '/dev/null',tofile='b/'+path))
        receipts.append({'path':path,'beforeSha256':hashlib.sha256(before.encode()).hexdigest() if path in originals else None,
            'afterSha256':hashlib.sha256(after.encode()).hexdigest()})
    (HERE/'native-continuous.patch').write_text(patch,encoding='utf-8',newline='\n')
    (HERE/'native-provenance.json').write_text(json.dumps({'baseTree':BASE,'files':receipts,
        'patchSha256':hashlib.sha256(patch.encode()).hexdigest()},indent=2)+'\n',encoding='utf-8',newline='\n')
    print(json.dumps({'base':BASE,'paths':len(outputs),'patchBytes':len(patch.encode()),'sharedWrites':0}))

if __name__=='__main__': write()
