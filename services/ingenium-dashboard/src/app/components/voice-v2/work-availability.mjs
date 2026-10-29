import { validateScope } from '../../../../../../packages/veyra-voice/session.mjs';

/** Server readiness is supplied by the existing gateway; this function never probes or acquires audio. */
export function voiceWorkAvailability({ scope, readiness, portsPresent }) {
  try { validateScope(scope); } catch { return { state: 'unavailable', reason: 'Select an authorized conversation and execution binding.', modes: [], duplex: 'half-duplex' }; }
  if (portsPresent !== true || readiness?.gateway !== true) return { state: 'unavailable', reason: 'The authenticated voice service is unavailable.', modes: [], duplex: 'half-duplex' };
  if (readiness?.speech !== true) return { state: 'unavailable', reason: 'The qualified speech service is unavailable.', modes: [], duplex: 'half-duplex' };
  const modes = readiness.draft === true ? ['dictation'] : [];
  if (readiness.agent === true) modes.push('agent-call', 'conversation');
  return { state: modes.length ? 'available' : 'unavailable', reason: modes.length ? null : 'The current agent and composer are unavailable.', modes, duplex: 'half-duplex' };
}
