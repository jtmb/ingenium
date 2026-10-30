import { VoiceError } from '../../../../packages/veyra-voice/session.mjs';

/** Pinned HTTP transport capability, established from the actual protocol,
 * server handler and execution coordinator. Never infer this from event labels,
 * an injected function, a completed message, a timestamp or a fixture promise.
 * This is deliberately not a generic "proof" factory. */
export const hostedOpenCodeLifecycle = Object.freeze({
  protocol: 'opencode-v2.0.11',
  sourceCommit: '9eb6902aaf3c35ce985b67c605a775992249066b',
  originalRetirementAvailable: false,
  originalInterruptAvailable: false,
  reason: 'VOICE_HOSTED_ORIGINAL_SETTLEMENT_NOT_EXPOSED',
});

/** Call from the actual hosted factory before scope/resource/model admission.
 * A future in-process original constructor needs its own reviewed adapter;
 * it cannot turn this public HTTP transport into a different capability. */
export function requireHostedOriginalRetirement() {
  throw new VoiceError(hostedOpenCodeLifecycle.reason);
}
