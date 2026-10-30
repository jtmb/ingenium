/** Read-only labels from existing Voice/device observations; owns no readiness,
 * request, playback, device, transcript, tool or session state. */
export function callPresentation({ connected, disabled, busy, monitoring, recording, playing, paused,
  retainedCapture, sessionState, utteranceState }) {
  if (!connected) return { phase: 'offline', label: 'Service disconnected', detail: monitoring ? 'Microphone release pending' : 'Microphone off' };
  if (paused || sessionState === 'uncertain' || utteranceState === 'uncertain')
    return { phase: 'attention', label: 'Check the original voice session', detail: 'Automatic voice activity paused' };
  if (retainedCapture) return { phase: 'attention', label: 'Recording retained', detail: 'Export or discard before resuming' };
  if (sessionState === 'stopping' || sessionState === 'interruption_pending')
    return { phase: 'stopping', label: 'Stopping voice activity', detail: 'Waiting for the original control' };
  if (disabled) return { phase: 'paused', label: 'Voice admission paused', detail: monitoring ? 'Microphone release pending' : 'Microphone off' };
  if (busy) return { phase: 'starting', label: 'Starting voice', detail: 'Checking the existing voice owner' };
  if (recording && monitoring) return { phase: 'listening', label: 'Listening to you', detail: 'Microphone on' };
  if (playing) return { phase: 'speaking', label: 'Speaking', detail: monitoring ? 'Microphone on · speak to interrupt' : 'Microphone off' };
  if (utteranceState === 'transcribing') return { phase: 'transcribing', label: 'Transcribing', detail: monitoring ? 'Microphone on' : 'Microphone off' };
  if (utteranceState === 'admitting' || utteranceState === 'awaiting_reply' || sessionState === 'awaiting_reply')
    return { phase: 'thinking', label: 'Thinking', detail: monitoring ? 'Microphone on · speak to interrupt' : 'Microphone off' };
  if (utteranceState === 'synthesizing') return { phase: 'preparing', label: 'Preparing voice reply', detail: monitoring ? 'Microphone on' : 'Microphone off' };
  if (utteranceState === 'awaiting_playback') return { phase: 'playback-pending', label: 'Playback waiting', detail: 'The original audio has not started playing' };
  if (sessionState === 'processing') return { phase: 'processing', label: 'Processing voice turn', detail: monitoring ? 'Microphone on' : 'Microphone off' };
  if (monitoring) return { phase: 'listening', label: 'Listening', detail: 'Microphone on' };
  if (sessionState === 'stopped') return { phase: 'ended', label: 'Voice ended', detail: 'Microphone off' };
  return { phase: 'idle', label: 'Microphone off', detail: 'Start voice to send spoken turns to this chat' };
}
