import { VoiceError } from '../../../../packages/veyra-voice/session.mjs';

const fields = {
  open: ['scope', 'mode', 'sessionId'], resume: ['scope', 'mode', 'sessionId'], close: ['scope', 'sessionId'],
  transcribe: ['scope', 'turn'], submit: ['scope', 'turn', 'text', 'delivery'], synthesize: ['scope', 'turn', 'text'],
  approve: ['scope', 'turn', 'approvalId', 'decision'], steer: ['scope', 'turn', 'operationId', 'text', 'delivery'], interrupt: ['scope', 'turn'], complete: ['scope', 'turn'],
};
async function read(request, limit) {
  if (!request.body) throw new VoiceError('VOICE_REQUEST_INVALID');
  const reader = request.body.getReader(), chunks = []; let count = 0;
  try {
    while (true) { const item = await reader.read(); if (item.done) break; count += item.value.length; if (count > limit) { await reader.cancel(); throw new VoiceError('VOICE_REQUEST_LIMIT'); } chunks.push(item.value); }
  } finally { reader.releaseLock(); }
  const bytes = new Uint8Array(count); let offset = 0; for (const chunk of chunks) { bytes.set(chunk, offset); offset += chunk.length; } return bytes;
}
function errorResponse(error) {
  const code = error instanceof VoiceError ? error.code : 'VOICE_SERVICE_FAILED';
  const status = code === 'VOICE_UNAUTHENTICATED' ? 401 : code === 'VOICE_FORBIDDEN' ? 403 : code.includes('LIMIT') ? 413 : code.includes('INVALID') ? 400 : code.includes('CONFLICT') || code.includes('UNKNOWN') || code.includes('DUPLICATE') ? 409 : code.includes('EXPIRED') ? 410 : code.includes('CAPACITY') ? 429 : 503;
  return Response.json({ error: { code, message: 'The voice operation could not be confirmed.' } }, { status, headers: { 'Cache-Control': 'no-store' } });
}

/** Mount behind the existing gateway; authenticate includes its session, CSRF and capability policy. */
export function createVoiceHttp({ service, authenticate, prefix = '/api/voice/v2/' }) {
  return async function handle(request) {
    const action = new URL(request.url).pathname.slice(prefix.length);
    if (!new URL(request.url).pathname.startsWith(prefix) || !Object.hasOwn(fields, action)) return new Response(null, { status: 404 });
    if (request.method !== 'POST') return new Response(null, { status: 405, headers: { Allow: 'POST' } });
    try {
      const context = await authenticate(request);
      if (!context) throw new VoiceError('VOICE_UNAUTHENTICATED');
      let envelope;
      if (action === 'transcribe') {
        const header = request.headers.get('X-Veyra-Voice');
        if (!header || header.length > 8192 || request.headers.get('content-type') !== 'application/octet-stream') throw new VoiceError('VOICE_REQUEST_INVALID');
        envelope = JSON.parse(decodeURIComponent(header));
      } else {
        if (request.headers.get('content-type')?.split(';')[0] !== 'application/json') throw new VoiceError('VOICE_REQUEST_INVALID');
        envelope = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(await read(request, action === 'synthesize' ? 140000 : 20000)));
      }
      if (!envelope || Object.keys(envelope).sort().join() !== [...fields[action]].sort().join()) throw new VoiceError('VOICE_REQUEST_INVALID');
      envelope.signal = request.signal;
      if (action === 'transcribe') envelope.pcm = await read(request, 480000);
      if (action === 'submit') {
        const encoder = new TextEncoder(), controller = new AbortController(); let sent = 0, cancelled = false;
        envelope.signal = AbortSignal.any([request.signal, controller.signal]);
        const stream = new ReadableStream({
          start(output) {
            const send = message => {
              if (cancelled) return;
              const bytes = encoder.encode(JSON.stringify(message) + '\n'); sent += bytes.length;
              if (sent > 524288) { controller.abort(); throw new VoiceError('VOICE_EVENT_LIMIT'); }
              output.enqueue(bytes);
            };
            envelope.onEvent = event => send({ kind: 'event', event });
            void service.submit(context, envelope).then(result => send({ kind: 'result', result })).catch(error => {
              if (!cancelled) output.enqueue(encoder.encode(JSON.stringify({ kind: 'error', code: error instanceof VoiceError ? error.code : 'VOICE_AGENT_OUTCOME_UNKNOWN' }) + '\n'));
            }).finally(() => { if (!cancelled) output.close(); });
          },
          cancel() { cancelled = true; controller.abort(); },
        });
        return new Response(stream, { headers: { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' } });
      }
      let result;
      if (action === 'open') result = await service.open(context, envelope, request.signal);
      else if (action === 'resume') result = await service.resume(context, envelope, request.signal);
      else if (action === 'close') result = await service.close(context, envelope);
      else result = await service[action](context, envelope);
      if (action === 'synthesize') return new Response(result, { headers: { 'Content-Type': 'audio/wav', 'Cache-Control': 'no-store' } });
      return Response.json(result ?? { acknowledged: true }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      return errorResponse(error instanceof SyntaxError || error instanceof URIError ? new VoiceError('VOICE_REQUEST_INVALID') : error);
    }
  };
}
