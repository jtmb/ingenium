import { VoiceError } from '../../../../../../packages/veyra-voice/session.mjs';
import { validateWav } from '../../../../../../packages/veyra-voice/audio.mjs';

async function boundedBody(response, max) {
  if (!response.body) throw new VoiceError('VOICE_RESPONSE_EMPTY');
  const reader = response.body.getReader(), chunks = []; let length = 0;
  try {
    while (true) { const item = await reader.read(); if (item.done) break; length += item.value.length; if (length > max) { await reader.cancel(); throw new VoiceError('VOICE_RESPONSE_LIMIT'); } chunks.push(item.value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(length); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes;
}

export function createHttpVoicePorts({ request = globalThis.fetch, basePath = '/api/voice/v2/', dictation }) {
  if (!basePath.startsWith('/') || basePath.startsWith('//') || typeof dictation !== 'function') throw new VoiceError('VOICE_TRANSPORT_CONFIG_INVALID');
  let connected = false, openingUnknown = false;
  async function call(action, input) {
    const { signal, pcm, onEvent, ...envelope } = input;
    const response = await request(basePath + action, { method: 'POST', credentials: 'same-origin', cache: 'no-store', signal, headers: pcm ? { 'Content-Type': 'application/octet-stream', 'X-Veyra-Voice': encodeURIComponent(JSON.stringify(envelope)) } : { 'Content-Type': 'application/json' }, body: pcm ?? JSON.stringify(envelope) });
    if (!response.ok) {
      const body = JSON.parse(new TextDecoder().decode(await boundedBody(response, 8192)));
      throw new VoiceError(typeof body.error?.code === 'string' ? body.error.code : 'VOICE_TRANSPORT_FAILED');
    }
    if (action === 'submit') {
      if (response.headers.get('content-type')?.split(';')[0] !== 'application/x-ndjson' || !response.body) throw new VoiceError('VOICE_STREAM_INVALID');
      const reader = response.body.getReader(), decoder = new TextDecoder('utf-8', { fatal: true }); let pending = '', bytes = 0, result;
      try {
        while (true) {
          const part = await reader.read(); if (part.done) break;
          bytes += part.value.length; if (bytes > 524288) throw new VoiceError('VOICE_RESPONSE_LIMIT');
          pending += decoder.decode(part.value, { stream: true });
          let line;
          while ((line = pending.indexOf('\n')) !== -1) {
            const message = JSON.parse(pending.slice(0, line)); pending = pending.slice(line + 1);
            if (result) throw new VoiceError('VOICE_STREAM_INVALID');
            if (message.kind === 'event') onEvent?.(message.event);
            else if (message.kind === 'result') result = message.result;
            else throw new VoiceError(message.code || 'VOICE_AGENT_OUTCOME_UNKNOWN');
          }
        }
        pending += decoder.decode(); if (pending.length || !result) throw new VoiceError('VOICE_AGENT_OUTCOME_UNKNOWN');
        return result;
      } finally { await reader.cancel(); reader.releaseLock(); }
    }
    if (action === 'synthesize') { const wav = await boundedBody(response, 2880128); validateWav(wav); return wav; }
    return JSON.parse(new TextDecoder().decode(await boundedBody(response, 20000)));
  }
  return {
    connect: async input => {
      if (openingUnknown) throw new VoiceError('VOICE_OPEN_OUTCOME_UNKNOWN');
      if (connected) return call('resume', input);
      openingUnknown = true;
      const grant = await call('open', input); connected = true; openingUnknown = false; return grant;
    },
    transcribe: input => call('transcribe', input), dictation,
    submit: input => call('submit', input), synthesize: input => call('synthesize', input),
    complete: input => call('complete', input), approve: input => call('approve', input), steer: input => call('steer', input), interrupt: input => call('interrupt', input),
    disconnect: async input => { await call('close', input); connected = false; openingUnknown = false; },
  };
}
