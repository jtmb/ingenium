export interface CallObservations {
  connected: boolean; disabled: boolean; busy: boolean; monitoring: boolean;
  recording: boolean; playing: boolean; paused: boolean; retainedCapture: boolean;
  sessionState: string; utteranceState: string;
}
export function callPresentation(observations: CallObservations): { phase: string; label: string; detail: string };
