'use client';

import { useEffect, useMemo, useState } from 'react';
import type { ReactNode } from 'react';
import type { VoiceScope, VoiceMode, VoicePorts } from '../../../../../../packages/veyra-voice/session.mjs';
import { VoiceClient } from './voice-client.mjs';
import { VoiceControls } from './VoiceControls';
import { VoicePanel } from './VoicePanel';
import { voiceWorkAvailability } from './work-availability.mjs';
import type { VoiceWorkReadiness } from './work-availability.mjs';
import { createDeferredDisposal } from './deferred-disposal.mjs';

export interface VoiceWorkMountProps {
  scope: VoiceScope | null;
  readiness: VoiceWorkReadiness;
  ports?: Omit<VoicePorts, 'play' | 'stopPlayback' | 'stopCapture'>;
  mascot: ReactNode;
}

export function VoiceWorkMount(props: VoiceWorkMountProps) {
  const availability = voiceWorkAvailability({ scope: props.scope, readiness: props.readiness, portsPresent: props.ports !== undefined });
  if (availability.state !== 'available' || !props.scope || !props.ports) return <div><VoiceControls disabled onStart={() => undefined} /><p role="status" className="mt-1 text-xs text-neutral-400">{availability.reason}</p></div>;
  const key = JSON.stringify([props.scope.actorId, props.scope.accountId, props.scope.organizationId, props.scope.projectId, props.scope.runtimeId, props.scope.executionBindingId, props.scope.executionRevision, props.scope.conversationId, props.scope.agentId, availability.modes]);
  return <BoundVoiceWorkMount key={key} scope={props.scope} ports={props.ports} modes={availability.modes} mascot={props.mascot} />;
}

function BoundVoiceWorkMount({ scope, ports, modes, mascot }: { scope: VoiceScope; ports: NonNullable<VoiceWorkMountProps['ports']>; modes: VoiceMode[]; mascot: ReactNode }) {
  const [client, setClient] = useState<VoiceClient | null>(null);
  const [error, setError] = useState<string | null>(null);
  const lifetime = useMemo(() => createDeferredDisposal(() => { void client?.end().catch(() => undefined); }), [client]);
  useEffect(() => lifetime.attach(), [lifetime]);
  const start = (mode: VoiceMode) => {
    if (client || !modes.includes(mode)) return;
    // Constructing a client acquires no device; this explicit user action starts it.
    const connection = new VoiceClient({ scope, mode, ports, sessionId: crypto.randomUUID(), onError: setError });
    setClient(connection); setError(null);
    void connection.start().catch(() => setError('The voice connection could not be confirmed.'));
  };
  if (client) return <div>{error && <p role="alert" className="mb-2 text-sm text-red-200">{error}</p>}<VoicePanel client={client} mascot={mascot} onClose={() => setClient(null)} /></div>;
  return <VoiceControls availableModes={modes} onStart={start} />;
}
