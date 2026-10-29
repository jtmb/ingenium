'use client';

import type { VoiceMode } from '../../../../../../packages/veyra-voice/session.mjs';

function VoiceIcon({ microphone = false }: { microphone?: boolean }) {
  return microphone ? <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7"><rect x="9" y="3" width="6" height="12" rx="3" /><path d="M5 10v2a7 7 0 0 0 14 0v-2M12 19v3" /></svg>
    : <svg aria-hidden="true" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round"><path d="M4 10v4M8 6v12M12 3v18M16 7v10M20 10v4" /></svg>;
}

export function VoiceControls({ disabled = false, availableModes, onStart }: { disabled?: boolean; availableModes?: VoiceMode[]; onStart(mode: VoiceMode): void }) {
  return <div className="flex items-center gap-1" aria-label="Voice controls">
    <button type="button" disabled={disabled || (availableModes !== undefined && !availableModes.includes('dictation'))} onClick={() => onStart('dictation')} aria-label="Dictate into composer" title="Dictate" className="flex size-9 items-center justify-center rounded-full text-neutral-200 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-40"><VoiceIcon microphone /></button>
    <button type="button" disabled={disabled || (availableModes !== undefined && !availableModes.includes('agent-call'))} onClick={() => onStart('agent-call')} title="Call current working agent" className="rounded-full px-3 py-2 text-xs text-neutral-300 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-40">Call agent</button>
    <button type="button" disabled={disabled || (availableModes !== undefined && !availableModes.includes('conversation'))} onClick={() => onStart('conversation')} aria-label="Start voice" title="Start voice" className="flex size-9 items-center justify-center rounded-full bg-blue-600 text-white hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-blue-400 disabled:opacity-40"><VoiceIcon /></button>
  </div>;
}
