import { createHash } from 'node:crypto';
import { VoiceError, validateTurn } from '../../../../packages/veyra-voice/session.mjs';
import { validateWav } from '../../../../packages/veyra-voice/audio.mjs';
import { planTextSpeech, sourceDigest, speechChildKey } from '../../../../packages/veyra-voice/segments.mjs';

const fail = code => { throw new VoiceError(code); };
const requestForStt = turn => 'voice-stt:' + createHash('sha256').update(turn.requestId).digest('hex');

/** CPU-only consumer of the actual managed Core producer. No HTTP endpoint,
 * token, v1 worker or durable authority is reconstructed in this adapter. */
export class ManagedCpuSpeech {
  constructor({ supervisor, redactSpeech }) {
    if (['openScope', 'releaseSession', 'status', 'reserveCpu', 'executeCpu', 'cancelPrepared'].some(method => typeof supervisor?.[method] !== 'function') || typeof redactSpeech !== 'function') fail('VOICE_CPU_BINDING_REQUIRED');
    Object.assign(this, { supervisor, redactSpeech, ownedSequence: true });
  }
  openOwned(input) { return this.supervisor.openScope(input); }
  releaseOwned(input) { return this.supervisor.releaseSession(input); }
  health(signal) { signal?.throwIfAborted(); const status = this.supervisor.status(); if (!status.ready) fail('VOICE_WORKER_UNAVAILABLE'); return status; }
  async transcribe({ context, scope, pcm, turn, deadlineAt, signal }) {
    validateTurn(turn); signal?.throwIfAborted();
    const handle = this.supervisor.reserveCpu({ context, scope, turn, deadlineAt, requestId: requestForStt(turn), kind: 'transcribe', pcm });
    const result = await this.supervisor.executeCpu(handle, { signal });
    if (!result.retired || !result.resultAvailable || !(result.bytes instanceof Uint8Array)) fail('VOICE_TRANSCRIPTION_UNKNOWN');
    let body; try { body = JSON.parse(new TextDecoder('utf-8', { fatal: true }).decode(result.bytes)); } catch { fail('VOICE_TRANSCRIPTION_INVALID'); }
    if (typeof body.text !== 'string' || [...body.text].length > 2000 || body.language !== 'en' || body.durationMs !== pcm.length / 32) fail('VOICE_TRANSCRIPTION_INVALID');
    return { text: body.text.trim(), final: true };
  }
  async *synthesizeSequence({ context, scope, turn, text, parentOperationId, deadlineAt, signal }) {
    validateTurn(turn); signal?.throwIfAborted();
    if (typeof text !== 'string' || [...text].length > 32000 || typeof parentOperationId !== 'string') fail('VOICE_SPEECH_PARENT_REQUIRED');
    const safe = this.redactSpeech(text);
    if (typeof safe !== 'string') fail('VOICE_SPEECH_REDACTED');
    if (!safe.length) return;
    const originalDigest = await sourceDigest(new TextEncoder().encode(text));
    const redactedDigest = await sourceDigest(new TextEncoder().encode(safe));
    const plan = await planTextSpeech(safe.replaceAll('\r', '\n'));
    const voice = this.health(signal).configuredDefaultVoice;
    for (const segment of plan.segments) {
      if (segment.kind === 'text-gap') continue;
      signal?.throwIfAborted();
      const requestId = `voice-speech:${await speechChildKey(turn, segment)}`;
      const handle = this.supervisor.reserveCpu({ context, scope, turn, requestId, parentOperationId, deadlineAt, kind: 'synthesize', text: segment.text, voice });
      // execute consumes the original dispatch gate synchronously, including
      // abort-before-HTTP; its producer owns no-start/quarantine and cleanup.
      const result = await this.supervisor.executeCpu(handle, { signal });
      if (!result.retired || !result.resultAvailable || !(result.bytes instanceof Uint8Array)) fail('VOICE_SPEECH_UNKNOWN');
      validateWav(result.bytes);
      signal?.throwIfAborted();
      yield { wav: result.bytes, operation: { accepted: true, operationId: handle.operationId, requestId, parentOperationId,
        parentRequestId: turn.requestId, generation: turn.generation, sourceDigest: segment.sourceDigest, digest: segment.digest,
        sourceStart: segment.sourceStart, sourceEnd: segment.sourceEnd }, segment, originalDigest, redactedDigest };
    }
  }
  async synthesize() { fail('VOICE_CONTINUOUS_SPEECH_REQUIRED'); }
}
