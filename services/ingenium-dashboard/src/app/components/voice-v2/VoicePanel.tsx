'use client';

import { useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import type { ReactNode } from 'react';
import type { VoiceClient } from './voice-client.mjs';
import { createDeferredDisposal } from './deferred-disposal.mjs';

export function VoicePanel({ client, mascot, onClose }: { client: VoiceClient; mascot: ReactNode; onClose(): void }) {
  const state = useSyncExternalStore(client.session.subscribe, client.session.getSnapshot, client.session.getSnapshot);
  const [text, setText] = useState('');
  const [delivery, setDelivery] = useState<'prompt' | 'steer' | 'queue'>('steer');
  const [error, setError] = useState<string | null>(null);
  const [devices, setDevices] = useState<{ id: string; kind: string; label: string }[]>([]);
  const [showTranscript, setShowTranscript] = useState(false);
  const run = (operation: () => Promise<unknown>) => { setError(null); void operation().catch(() => setError('The voice action could not be confirmed. Check the connection before trying again.')); };
  const lifetime = useMemo(() => createDeferredDisposal(() => { void client.end().catch(() => undefined); }), [client]);
  useEffect(() => lifetime.attach(), [lifetime]);
  const ended = state.phase === 'ended';
  return <section aria-label={client.session.mode === 'agent-call' ? 'Call with current working agent' : 'Veyra voice'} className="flex min-h-[min(36rem,80dvh)] w-full flex-col rounded-3xl bg-[#0e0e0e] p-4 text-neutral-100 sm:p-6" data-testid="veyra-voice-panel">
    <header className="flex flex-wrap items-center justify-between gap-2 text-xs text-neutral-400">
      <span>{client.session.mode === 'dictation' ? 'Dictation · inserts into your draft' : client.session.mode === 'agent-call' ? 'Current working agent' : 'Live conversation'}</span>
      <button type="button" onClick={() => setShowTranscript(value => !value)} aria-expanded={showTranscript} className="rounded px-2 py-1 hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-blue-400">{showTranscript ? 'Hide transcript' : 'Show transcript'}</button>
    </header>
    <div className="flex flex-1 flex-col items-center justify-end gap-4 pb-7 pt-12">
      <div aria-hidden="true" className={`flex size-24 items-center justify-center rounded-full bg-gradient-to-b from-blue-600 via-blue-500 to-blue-100 shadow-lg shadow-blue-500/10 ${state.phase === 'speaking' ? 'motion-safe:animate-pulse' : ''}`}>{mascot}</div>
      <p role="status" aria-live="polite" className="text-sm text-neutral-400">{state.muted && !ended ? 'Microphone off' : state.phase === 'ready' ? 'Listening' : state.phase === 'speaking' ? 'Speaking' : state.phase}</p>
    </div>
    {(error || state.error) && <p role="alert" className="mb-3 rounded-lg bg-red-950/30 p-3 text-sm text-red-200">{error || state.error}</p>}
    {client.hasRetainedCapture() && <div role="alert" className="mb-3 text-sm"><p>The complete unsubmitted capture is retained in this view. Export or discard it before resuming. Closing this view loses this copy.</p><button type="button" onClick={() => {
      const pcm = client.getRetainedCapture(); if (!pcm) return;
      const header = JSON.stringify({ format: 'veyra-pcm16le-v1', sampleRate: 16000, channels: 1, bytes: pcm.length }) + '\n';
      const url = URL.createObjectURL(new Blob([header, new Uint8Array(pcm)], { type: 'application/octet-stream' }));
      const link = document.createElement('a'); link.href = url; link.download = 'veyra-unsubmitted-capture.pcm'; link.click(); window.setTimeout(() => URL.revokeObjectURL(url), 1000);
    }}>Export complete capture</button><button type="button" onClick={() => client.discardRetainedCapture()}>Discard unsubmitted capture</button></div>}
    {showTranscript && <div className="mb-4 max-h-48 overflow-y-auto rounded-xl bg-white/5 p-3 text-sm" aria-label="Voice transcript"><p>{state.transcript || 'Your words will appear here.'}</p>{state.reply && <p className="mt-3 text-neutral-300">{state.reply}</p>}</div>}
    {state.tools.length > 0 && <ul className="mb-3 max-h-24 overflow-y-auto text-xs text-neutral-400" aria-label="Agent tool activity">{state.tools.map(tool => <li key={tool.callId}>{tool.label} · {tool.status}</li>)}</ul>}
    {state.approval && <div role="group" aria-label="Agent permission request" className="mb-3 rounded-xl border border-amber-700 p-3 text-sm"><p>{state.approval.label}</p><div className="mt-2 flex gap-3"><button type="button" onClick={() => run(() => client.session.decideApproval('allow-once'))} className="rounded-lg bg-blue-600 px-3 py-2 focus-visible:outline-2 focus-visible:outline-blue-300">Allow once</button><button type="button" onClick={() => run(() => client.session.decideApproval('deny'))} className="rounded-lg bg-white/10 px-3 py-2 focus-visible:outline-2 focus-visible:outline-blue-300">Deny</button></div></div>}
    <form onSubmit={event => { event.preventDefault(); const value = text; run(async () => { await client.session.sendText(value, state.phase === 'ready' ? 'prompt' : delivery); if (!client.session.getSnapshot().error) setText(current => current === value ? '' : current); }); }} className="flex flex-wrap items-center gap-2 rounded-3xl border border-white/5 bg-[#222222] p-2">
      <button type="button" title="Audio devices" aria-label="Choose audio devices" onClick={() => run(async () => setDevices(await client.media.devices()))} className="size-9 shrink-0 rounded-full text-xl hover:bg-white/10 focus-visible:outline-2 focus-visible:outline-blue-400">+</button>
      <label className="min-w-24 flex-1"><span className="sr-only">Type to the current agent</span><input value={text} disabled={ended} onChange={event => setText(event.target.value)} placeholder="Type" maxLength={2000} className="w-full bg-transparent px-1 py-2 text-sm outline-none focus-visible:ring-1 focus-visible:ring-blue-400" /></label>
      {client.session.mode !== 'dictation' && <select aria-label="While the agent works" value={delivery} onChange={event => setDelivery(event.target.value as 'steer' | 'queue')} className="max-w-24 rounded bg-neutral-800 py-1 text-xs text-neutral-300"><option value="steer">Steer</option><option value="queue">Queue</option></select>}
      {text.trim() && <button type="submit" disabled={ended} className="rounded-full bg-blue-600 px-3 py-2 text-xs focus-visible:outline-2 focus-visible:outline-blue-300">Send</button>}
      <button type="button" disabled={ended} onClick={() => run(() => client.mute(!state.muted))} aria-label={state.muted ? 'Unmute microphone' : 'Mute microphone'} aria-pressed={state.muted} className="size-9 shrink-0 rounded-full bg-white/5 text-sm focus-visible:outline-2 focus-visible:outline-blue-400 disabled:opacity-40">{state.muted ? '◉' : 'Ⅱ'}</button>
      {!['ready', 'ended', 'disconnected', 'connecting'].includes(state.phase) && <button type="button" onClick={() => run(() => client.session.interrupt())} className="rounded-full px-3 py-2 text-xs focus-visible:outline-2 focus-visible:outline-blue-400">Stop</button>}
      <button type="button" aria-label="End voice" onClick={() => run(async () => { await client.end(); onClose(); })} className="size-9 shrink-0 rounded-full bg-blue-600 text-xl hover:bg-blue-500 focus-visible:outline-2 focus-visible:outline-blue-300">×</button>
    </form>
    {devices.length > 0 && <div className="mt-3 flex flex-wrap gap-3 text-xs"><label>Microphone <select aria-label="Microphone" value={client.inputDeviceId} onChange={event => run(() => client.selectDevices(event.target.value, client.outputDeviceId))} className="max-w-52 rounded bg-neutral-800 p-2"><option value="">System default</option>{devices.filter(device => device.kind === 'audioinput').map(device => <option key={device.id} value={device.id}>{device.label}</option>)}</select></label><label>Speaker <select aria-label="Speaker" value={client.outputDeviceId} onChange={event => run(() => client.selectDevices(client.inputDeviceId, event.target.value))} className="max-w-52 rounded bg-neutral-800 p-2"><option value="">System default</option>{devices.filter(device => device.kind === 'audiooutput').map(device => <option key={device.id} value={device.id}>{device.label}</option>)}</select></label></div>}
    {state.phase === 'disconnected' && <button type="button" onClick={() => run(() => client.start())} className="mx-auto mt-4 rounded-full bg-blue-600 px-4 py-2 text-sm focus-visible:outline-2 focus-visible:outline-blue-300">Start voice</button>}
    {state.error && !ended && <button type="button" onClick={() => run(() => client.reconnect())} className="mx-auto mt-3 rounded px-3 py-2 text-sm text-blue-300 focus-visible:outline-2 focus-visible:outline-blue-400">Reconnect</button>}
    <p className="mt-3 text-center text-xs text-neutral-500">Audio is processed only while connected and unmuted. Agent tools retain their existing permissions.</p>
  </section>;
}
