"""Compose only a bounded local-capture delta against frozen presentation outputs."""
import difflib
import hashlib
import importlib.util
import json
from pathlib import Path

HERE = Path(__file__).resolve().parent
spec = importlib.util.spec_from_file_location('frozen_presentation', HERE.parent / 'presentation/generate_presentation.py')
presentation = importlib.util.module_from_spec(spec)
spec.loader.exec_module(presentation)
originals, outputs = {}, {}

def read(path):
    source = presentation.outputs[path]
    originals[path] = source
    return source

def replace(source, before, after, count=1):
    if source.count(before) != count:
        raise ValueError('Closed preimage anchor mismatch: ' + before[:100])
    return source.replace(before, after)

CHAT = presentation.CHAT
s = read(CHAT)
s = 'import { LocalCapture, retainUnsubmitted } from "../voice-ui/local-capture.mjs";\n' + s
s = replace(s, 'import { Mic, Square, Volume2, X }', 'import { Mic, MicOff, Square, Volume2, X }')
s = replace(s, '  const [voiceProtocol, setVoiceProtocol]', '''  const [micPending, setMicPending] = useState(false), [micIssue, setMicIssue] = useState(""), [micReleaseUnknown, setMicReleaseUnknown] = useState(false);
  const captureDevice = useRef(new LocalCapture()), retainedSource = useRef<Samples | null>(null);
  const [voiceProtocol, setVoiceProtocol]''')
s = replace(s, 'const presentationNeeded = monitoring || recording || playing || busy || paused ||', 'const presentationNeeded = monitoring || recording || playing || busy || paused || micPending || !!micIssue ||')
s = replace(s, '  const devices = useRef<{ stream: MediaStream; context: AudioContext; source: MediaStreamAudioSourceNode; processor: ScriptProcessorNode; gain: GainNode } | null>(null);\n', '')
s = replace(s, 'tracked.current = tracking; observed.current = session;', 'tracked.current = tracking; observed.current = session; retainedSource.current = retainedCapture;')
start = s.index('  const releaseMic = () => {')
end = s.index('  const uncertain =',start)
s = s[:start] + '''  const releaseCapture = () => {
    const pending = retainUnsubmitted(queued.current, capture.current, captureDevice.current.resource);
    if (live.current && pending) {
      retainedSource.current ||= pending;
      setRetainedCapture(previous => previous || pending);
    }
    queued.current = null; capture.current = null;
    const result = captureDevice.current.stop();
    if (!watching.current && !player.current && !starting.current) lease.release(micToken.current);
    if (live.current) {
      setMicPending(false); setMonitoring(false); setRecording(false); setSeconds(0);
      setMicReleaseUnknown(!result.released);
      if (!result.released) setMicIssue("Microphone release is unconfirmed. Capture is blocked; check the original device without ending or replaying this call.");
    }
  };
  const releaseMic = () => {
    generation.current++; watching.current = false; releaseCapture();
  };
  const muteMic = (reason = "Microphone muted. The original call and reply playback continue.") => {
    releaseCapture();
    if (viewCurrent()) setNotice(reason);
  };
''' + s[end:]
s = s.replace('devices.current', 'captureDevice.current.resource')
s = replace(s, '    if (!viewCurrent() || admissionBlocked.current) { queued.current = null; capture.current = null; return; }', '    if (!viewCurrent() || admissionBlocked.current || !captureDevice.current.intent || !captureDevice.current.resource) return;', count=2)
start = s.index('  const acquireMic = async () => {')
end = s.index('  const start = async () => {', start)
s = s[:start] + '''  const acquireMic = async (ticket: number, callStamp: number) => {
    if (!navigator.mediaDevices?.getUserMedia) throw new Error("Microphone capture is unavailable in this browser.");
    const opened = await captureDevice.current.open(ticket, {
      media: navigator.mediaDevices, createContext: () => new AudioContext(),
      isCurrent: () => viewCurrent() && generation.current === callStamp && !admissionBlocked.current && !retainedSource.current
        && !!admittedOwner.current && ownerMatches(admittedOwner.current),
      claim: () => lease.claim(micToken.current),
      release: () => { if (!watching.current && !player.current && !starting.current) lease.release(micToken.current); },
      onPcm: (frame, rate) => frameHandler.current(frame, rate),
      onEnded: () => muteMic("Microphone access ended. The original call remains; recover any retained capture and unmute explicitly."),
      onProblem: message => { if (viewCurrent()) { setMicIssue(message); setMicReleaseUnknown(true); } },
    });
    if (opened && viewCurrent()) { setMonitoring(true); setMicPending(false); setMicReleaseUnknown(false); setMicIssue(""); }
    return opened;
  };
  const unmuteMic = async () => {
    const original = tracked.current;
    if (!viewCurrent() || admissionBlocked.current || starting.current || captureDevice.current.intent) return;
    if (!original || original.issue || original.stopRequested || original.stopId || original.bargeId || pausedRef.current
      || (original.playback && !player.current) || retainedSource.current) {
      setMicIssue("Check the original voice request and export or discard any unsubmitted capture before unmuting."); return;
    }
    let ticket: number;
    try { ticket = captureDevice.current.begin(); } catch (cause) { setMicIssue(cause instanceof Error ? cause.message : "Microphone cleanup needs attention."); return; }
    const stamp = generation.current;
    starting.current = true; setMicPending(true); setMicIssue("");
    const current = () => viewCurrent() && generation.current === stamp && captureDevice.current.current(ticket)
      && !admissionBlocked.current && !pausedRef.current && !retainedSource.current
      && tracked.current?.sessionId === original.sessionId && !tracked.current.stopRequested && !tracked.current.stopId && !tracked.current.bargeId;
    try {
      const owner = await request("GET", `/v1/voice/owner?session_id=${encodeURIComponent(sessionId)}`) as VoiceSessionOwner;
      if (!current()) return;
      const originalView = obj(await request("GET", `/v1/voice/sessions/${original.sessionId}`));
      if (!current()) return;
      const status = obj(await request("GET", "/v1/speech/status"));
      if (!current()) return;
      const protocol = obj(await request("GET", "/v1/voice/status"));
      if (!current()) return;
      const caps = speechCapabilities(status);
      if (originalView.id !== original.sessionId || originalView.project_id !== projectId || originalView.session_id !== sessionId
        || !["listening", "processing", "awaiting_reply", "speaking"].includes(text(originalView.state))
        || !ownerMatches(owner) || JSON.stringify(originalView.owner) !== JSON.stringify(owner)
        || JSON.stringify(observed.current?.owner) !== JSON.stringify(owner)
        || originalView.voice !== observed.current?.voice || originalView.read_replies !== observed.current?.read_replies
        || originalView.send_transcripts !== true
        || (admittedOwner.current && JSON.stringify(admittedOwner.current) !== JSON.stringify(owner)))
        throw new Error("The original call owner or current configuration changed. Check that original before unmuting.");
      if (caps.backend !== capabilities.backend || !caps.transcription || (originalView.read_replies === true && !caps.synthesis)
        || caps.maxRecordingMs !== capabilities.maxRecordingMs || caps.minRecordingMs !== capabilities.minRecordingMs
        || caps.maxTextChars !== capabilities.maxTextChars || caps.maxTextBytes !== capabilities.maxTextBytes
        || (caps.backend === "owned-http-cpu" && originalView.read_replies === true
          && (!text(originalView.voice) || !caps.voices.includes(text(originalView.voice)))))
        throw new Error("The original voice and fresh speech capabilities are incompatible. They were not replaced.");
      const freshSegmented = protocol.segmented_capture === true && protocol.playback_protocol === "voice-child-claim-v1" && protocol.max_utterance_seconds === 60;
      if (freshSegmented !== segmented) throw new Error("The original capture protocol changed. Check the original call before unmuting.");
      if (!current()) return;
      admittedOwner.current = owner; setSpeech(status); setVoiceProtocol(protocol);
      if (!await acquireMic(ticket, stamp) || !current()) return;
      watching.current = true; setNotice("Microphone on. The same original call continues; no earlier recording was submitted again.");
    } catch (cause) {
      // A local permission/configuration refusal is not an unknown agent outcome.
      releaseCapture();
      if (viewCurrent()) setMicIssue(cause instanceof Error ? cause.message : "Microphone could not be unmuted. The original call is unchanged.");
    } finally {
      if (captureDevice.current.current(ticket) && !captureDevice.current.resource) releaseCapture();
      starting.current = false;
      if (!watching.current && !captureDevice.current.resource && !player.current) lease.release(micToken.current);
      if (viewCurrent()) setMicPending(false);
    }
  };
''' + s[end:]
s = replace(s, '    starting.current = true; setBusy(true); setError(""); setNotice("");', '''    let captureTicket: number;
    try { captureTicket = captureDevice.current.begin(); } catch (cause) { setMicIssue(cause instanceof Error ? cause.message : "Microphone cleanup needs attention."); return; }
    starting.current = true; setBusy(true); setMicPending(true); setMicIssue(""); setError(""); setNotice("");''')
s = replace(s, 'if (!await acquireMic()) return;', 'if (!await acquireMic(captureTicket, stamp)) return;')
s = replace(s, 'if (!captureDevice.current.resource || observed.current?.state !== "listening")', 'if (observed.current?.state !== "listening")')
s = replace(s, 'watching.current = true; setMonitoring(true); setNotice("Microphone listening.', 'watching.current = true; setMonitoring(!!captureDevice.current.resource); setMicPending(false); setNotice(captureDevice.current.intent ? "Microphone listening.')
s = replace(s, 'Stop voice chat releases the microphone and stops its owned work.");', 'Stop voice chat releases the microphone and stops its owned work." : "Microphone muted. The original call remains active.");')
s = replace(s, 'finally { starting.current = false; if (!captureDevice.current.resource && !player.current) lease.release(micToken.current); if (viewCurrent()) setBusy(false); }', 'finally { if (captureDevice.current.current(captureTicket) && !captureDevice.current.resource) releaseCapture(); starting.current = false; if (!watching.current && !captureDevice.current.resource && !player.current) lease.release(micToken.current); if (viewCurrent()) { setBusy(false); setMicPending(false); } }')
s = replace(s, 'retainedCapture: !!retainedCapture, sessionState:', 'captureBlocked: micReleaseUnknown, retainedCapture: !!retainedCapture, sessionState:')
s = replace(s, '<span>{callState.detail}{recording ?', '<span>{micPending ? "Microphone request pending" : callState.detail}{recording ?')
old_start = '<button type="button" className="wb-call-mic" aria-label={monitoring ? "Microphone on" : retained ? "Resume microphone" : "Start voice chat and send spoken turns"} disabled={!connected || disabled || busy || monitoring || !!retainedCapture || !sessionId || !capabilities.transcription || (wantsReplies && !capabilities.synthesis) || !plannedVoice.ok || !!retainedVoiceIssue || (retained && (paused || !session || session.state !== "listening" || !!tracking?.utteranceId || !!tracking?.bargeId || !!tracking?.stopId))} onClick={() => void start()}><Mic size={16}/>{monitoring ? "Mic on" : retained ? "Resume mic" : "Start voice"}</button>'
new_start = '<button type="button" className="wb-call-mic" aria-pressed={monitoring} aria-label={monitoring ? "Mute microphone" : micPending ? "Cancel microphone request" : retained ? "Unmute microphone" : "Start voice chat and send spoken turns"} disabled={micReleaseUnknown || (!monitoring && !micPending && (!connected || disabled || busy || !!retainedCapture || !sessionId || !capabilities.transcription || (wantsReplies && !capabilities.synthesis) || !plannedVoice.ok || !!retainedVoiceIssue || (retained && (paused || !session || !!tracking?.bargeId || !!tracking?.stopId || !!tracking?.stopRequested || (!!tracking?.playback && !playing)))))} onClick={() => { if (monitoring || micPending) muteMic(); else if (retained) void unmuteMic(); else void start(); }}>{monitoring ? <Mic size={16}/> : <MicOff size={16}/>}{monitoring ? "Mic on" : micPending ? "Cancel mic" : retained ? "Mic off" : "Start voice"}</button>'
new_start = replace(new_start, 'aria-pressed={monitoring}', 'aria-pressed={micReleaseUnknown ? undefined : monitoring}')
new_start = replace(new_start, 'aria-label={monitoring ?', 'aria-label={micReleaseUnknown ? "Microphone release unconfirmed" : monitoring ?')
new_start = replace(new_start, '{monitoring ? "Mic on"', '{micReleaseUnknown ? "Mic unknown" : monitoring ? "Mic on"')
s = replace(s, old_start, new_start)
s = replace(s, '    <div className="wb-call-blockers">', '    <div className="wb-call-blockers">\n    {micIssue && <p role="alert">{micIssue}</p>}')
outputs[CHAT] = s

path = 'apps/web/src/features/voice-ui/call-presentation.mjs'
s = read(path)
s = replace(s, 'retainedCapture, sessionState, utteranceState }) {', '''retainedCapture, sessionState, utteranceState, captureBlocked = false }) {
  if (captureBlocked) return { phase: 'attention', label: 'Microphone needs attention', detail: 'Release is unconfirmed; check the original device' };''')
outputs[path] = s
path = 'apps/web/src/features/voice-ui/call-presentation.d.mts'
outputs[path] = replace(read(path), '  sessionState: string;', '  captureBlocked?: boolean; sessionState: string;')
for filename in ('local-capture.mjs', 'local-capture.d.mts', 'LocalMute.test.tsx'):
    outputs['apps/web/src/features/voice-ui/' + filename] = (HERE / filename).read_text(encoding='utf-8')
path = 'apps/web/src/features/voice-ui/VoiceWorkspace.test.tsx'
s = read(path)
if '"Resume microphone"' not in s:
    raise ValueError('Expected retained-session action tests missing')
outputs[path] = s.replace('"Resume microphone"', '"Unmute microphone"')

def write():
    patch, entries = '', []
    for path, after in outputs.items():
        before = originals.get(path, '')
        patch += ''.join(difflib.unified_diff(before.splitlines(True),after.splitlines(True),
            fromfile='a/' + path if path in originals else '/dev/null',tofile='b/' + path))
        entries.append({'path':path, 'beforeSha256':hashlib.sha256(before.encode()).hexdigest() if path in originals else None,
            'afterSha256':hashlib.sha256(after.encode()).hexdigest()})
    (HERE / 'native-local-mute.patch').write_text(patch,encoding='utf-8',newline='\n')
    (HERE / 'native-provenance.json').write_text(json.dumps({'baseTree':presentation.BASE,
        'precondition':'presentation patch4b29dacb1a5edcde8b3a4175d0983f54b5c5a477e02ad2329344e35e3777475f applied',
        'files':entries,'patchSha256':hashlib.sha256(patch.encode()).hexdigest()},indent=2)+'\n',encoding='utf-8',newline='\n')
    print(json.dumps({'targets':len(outputs),'patchBytes':len(patch.encode()),'sharedWrites':0}))

if __name__ == '__main__':
    write()
