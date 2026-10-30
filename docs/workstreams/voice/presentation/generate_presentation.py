"""Emit a presentation-only native delta from closed Git blob preimages."""
import difflib
import hashlib
import json
from pathlib import Path
import subprocess

BASE = '4e8e29436cfe42c81cc6401599cf8d224357a928'
HERE = Path(__file__).resolve().parent
NATIVE = HERE.parents[5] / 'windows-source'
GIT = ['git', '--no-optional-locks', '-c', 'safe.directory=' + str(NATIVE).replace('\\', '/'), '-C', str(NATIVE)]
originals = {}
outputs = {}

def read(path):
    value = subprocess.check_output(GIT + ['show', BASE + ':' + path]).decode('utf-8')
    originals[path] = value
    return value

def replace(source, before, after, count=1):
    if source.count(before) != count:
        raise ValueError('Preimage anchor mismatch: ' + before[:100])
    return source.replace(before, after)

def between(source, start, end):
    return source[source.index(start):source.index(end, source.index(start))]

CHAT = 'apps/web/src/features/workbench/VoiceChat.tsx'
source = read(CHAT)
boundary = '  return <AttentionDetails className="wb-voice-chat"'
prefix, tail = source.split(boundary, 1)
prefix = replace(prefix, 'import { Mic, Square, Volume2 }', 'import { Mic, Square, Volume2, X }')
prefix = 'import { callPresentation } from "../voice-ui/call-presentation.mjs";\nimport "./VoiceCall.css";\n' + prefix
recovery = between(tail, '    {retainedCapture &&', '    <label className="wb-voice-check">')
recovery = replace(recovery, '<div role="alert">', '<div role="alert" className="wb-call-recovery">')
preferences = between(tail, '    <label className="wb-voice-check">', '    <div className="wb-voice-actions">')
actions = between(tail, '    <div className="wb-voice-actions">', '    {(!capabilities.transcription')
actions = replace(actions, '<button type="button" disabled={!connected || disabled || busy || monitoring', '<button type="button" className="wb-call-mic" aria-label={monitoring ? "Microphone on" : retained ? "Resume microphone" : "Start voice chat and send spoken turns"} disabled={!connected || disabled || busy || monitoring')
actions = replace(actions, '><Mic size={13}/>{retained ? "Resume microphone" : "Start voice chat and send spoken turns"}', '><Mic size={16}/>{monitoring ? "Mic on" : retained ? "Resume mic" : "Start voice"}')
actions = replace(actions, '<button type="button" disabled={!monitoring && !retained', '<button type="button" className="wb-call-end" aria-label="Stop voice chat" disabled={!monitoring && !retained')
actions = replace(actions, '><Square size={13}/>Stop voice chat', '><X size={16}/>End')
actions = replace(actions, '<button type="button" disabled={!connected || !monitoring', '<button type="button" aria-label="Interrupt voice turn for spoken steering" disabled={!connected || !monitoring')
actions = replace(actions, '>Interrupt voice turn for spoken steering</button>', '><Square size={14}/>Interrupt</button>')
actions = replace(actions, '<button type="button" disabled={!connected} onClick={() => void checkRef.current()}>Check original voice session and controls</button>', '<button type="button" aria-label="Check original voice session and controls" disabled={!connected} onClick={() => void checkRef.current()}>Check original</button>')
blockers = between(tail, '    {(!capabilities.transcription', '    <p role="status">{monitoring ?')
original = between(tail, '    {tracking && <p className="wb-voice-note">Original voice session:', '    {notice &&')
messages = between(tail, '    {notice &&', '    {utterances.length > 0 &&')
messages = replace(messages, '{notice && <p role="status">{notice}</p>}', '{notice && noticeNeedsAttention && <p role="status">{notice}</p>}')
transcript = between(tail, '    {utterances.length > 0 && <ol', '    <p className="wb-voice-note">Speaking during')
transcript = replace(transcript, '{utterances.length > 0 && <ol', '{utterances.length > 0 && <AttentionDetails className="wb-call-transcript" needed={false} summary="Transcript"><ol')
transcript = replace(transcript, '</li>)}</ol>}', '</li>)}</ol></AttentionDetails>}')
note = between(tail, '    <p className="wb-voice-note">Speaking during', '  </div></AttentionDetails>;')
presentation = '''  const activeUtterance = rows(session?.utterances).find(item => item.id === session?.active_utterance_id);
  const callState = callPresentation({ connected, disabled, busy, monitoring, recording, playing, paused,
    retainedCapture: !!retainedCapture, sessionState: text(session?.state), utteranceState: text(activeUtterance?.state) });
  const noticeNeedsAttention = !monitoring || paused || disabled || !connected;
  return <section className="wb-voice-chat wb-call" aria-label="Call current working agent" data-phase={callState.phase}>
    <header className="wb-call-header"><strong>Current agent</strong><span>Live conversation · this chat</span></header>
    <div className="wb-call-stage">
      <div className="wb-call-orb" aria-hidden="true"/>
      <div className="wb-call-status" role="status" aria-live="polite"><strong>{callState.label}</strong><span>{callState.detail}{recording ? ` · ${seconds}/${maxSeconds}s` : ""}</span></div>
    </div>
    <p className="wb-call-consent">Spoken turns are sent automatically to this chat after you start voice.</p>
''' + actions + '    <div className="wb-call-preferences">\n' + preferences + '    </div>\n' + '''    <div className="wb-call-blockers">
    {!sessionId && <p>Create or select a chat first.</p>}
''' + blockers + messages + '    </div>\n' + recovery + transcript + '''    <AttentionDetails className="wb-call-details" needed={paused || !!tracking?.issue || session?.state === "uncertain"} summary="Voice settings and original session">
''' + original + '''    <p>Service: {text(session?.state) || "No voice session"}. Microphone {monitoring ? "on" : "off"}. {paused ? "Automatic checks paused for original-request recovery." : ""}</p>
    {notice && !noticeNeedsAttention && <p>{notice}</p>}
    <p>Speech detection uses a 150 ms onset and 700 ms silence boundary, with at most {maxSeconds} seconds per turn. Local speech detection has not been qualified.</p>
''' + note + '    </AttentionDetails>\n  </section>;\n}\n'
outputs[CHAT] = prefix + presentation

WORKSPACE = 'apps/web/src/features/workbench/VoiceWorkspace.tsx'
s = read(WORKSPACE)
s = 'import { AudioLines } from "lucide-react";\n' + s
s = replace(s, '<section aria-label="Voice controls"', '<section className="wb-voice-workspace" aria-label="Voice controls"')
s = replace(s, '{compact && <button type="button" aria-controls=', '{compact && <button type="button" className="wb-call-launch" title="Voice options" aria-controls=')
s = replace(s, '>Voice options{needed ? " · Activity or recovery needs attention" : ""}</button>', '><AudioLines size={16}/><span className="wb-call-sr">Voice options{needed ? " · Activity or recovery needs attention" : ""}</span></button>')
outputs[WORKSPACE] = s

for filename, target in [('call-presentation.mjs', 'apps/web/src/features/voice-ui/call-presentation.mjs'),
    ('call-presentation.d.mts', 'apps/web/src/features/voice-ui/call-presentation.d.mts'),
    ('VoiceCall.css', 'apps/web/src/features/workbench/VoiceCall.css')]:
    outputs[target] = (HERE / filename).read_text(encoding='utf-8')

TEST = 'apps/web/src/features/voice-ui/VoiceWorkspace.test.tsx'
s = read(TEST)
s = replace(s, 'if (method === "GET" && path === "/v1/speech/status") return cpu;', '''if (method === "GET" && path === "/v1/speech/status") return cpu;
    if (method === "GET" && path === "/v1/voice/status") return { speech: cpu, segmented_capture: true,
      max_utterance_seconds: 60, playback_protocol: "voice-child-claim-v1" };''')
s = replace(s, 'toHaveBeenCalledTimes(2)', 'toHaveBeenCalledTimes(3)', count=s.count('toHaveBeenCalledTimes(2)'))
outputs[TEST] = s
outputs['apps/web/src/features/voice-ui/VoiceCall.test.tsx'] = (HERE / 'VoiceCall.test.tsx').read_text(encoding='utf-8')

def write():
    patch = ''
    entries = []
    for path, after in outputs.items():
        before = originals.get(path, '')
        patch += ''.join(difflib.unified_diff(before.splitlines(True), after.splitlines(True),
            fromfile='a/' + path if path in originals else '/dev/null', tofile='b/' + path))
        entries.append({'path': path, 'beforeSha256': hashlib.sha256(before.encode()).hexdigest() if path in originals else None,
            'afterSha256': hashlib.sha256(after.encode()).hexdigest()})
    (HERE / 'native-presentation.patch').write_text(patch, encoding='utf-8', newline='\n')
    (HERE / 'native-provenance.json').write_text(json.dumps({'baseTree': BASE, 'files': entries,
        'patchSha256': hashlib.sha256(patch.encode()).hexdigest()}, indent=2) + '\n', encoding='utf-8', newline='\n')
    print(json.dumps({'base': BASE, 'paths': len(outputs), 'patchBytes': len(patch.encode()), 'sharedWrites': 0}))

if __name__ == '__main__':
    write()
