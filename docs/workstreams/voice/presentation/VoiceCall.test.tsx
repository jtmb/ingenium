// @vitest-environment jsdom
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VoiceChat } from "../workbench/VoiceChat";
import type { SpeechRequest } from "../workbench/VoiceWorkspace";

const sessionId = "21af783b-b665-43b4-8482-c68606c1c166";
const utteranceId = "65f38cd4-647a-4dfc-8366-cd3370e38813";
const cpu = { backend: "owned-http-cpu", available: true, transcription_configured: true, synthesis_configured: true,
  limits: { min_recording_ms: 250, max_recording_ms: 15000, max_text_chars: 600, max_text_utf8_bytes: 2400, max_output_ms: 15000 },
  voices: ["af_sky"], configured_default_voice: "af_sky", qualified: false };
const lease = { claim: vi.fn(() => true), release: vi.fn() };
const common = { projectId: "project", sessionId: "working-chat", connected: true, disabled: false,
  lease, isCurrent: () => true, ownerMatches: () => true };
function gateway(state = "listening", turnState = "") {
  return vi.fn<SpeechRequest>(async (method, path) => {
    if (method === "GET" && path === "/v1/speech/status") return cpu;
    if (method === "GET" && path === "/v1/voice/status") return { segmented_capture: true,
      max_utterance_seconds: 60, playback_protocol: "voice-child-claim-v1" };
    const utterance = { id: utteranceId, state: turnState, transcript: "Explain the actual failing test.",
      reply_text: null, wav_base64: null, children: [] };
    if (method === "GET" && path === `/v1/voice/sessions/${sessionId}/utterances/${utteranceId}`) return utterance;
    if (method === "GET" && path === `/v1/voice/sessions/${sessionId}`) return { id: sessionId,
      project_id: common.projectId, session_id: common.sessionId, state, voice: "af_sky", read_replies: true,
      utterances: turnState ? [utterance] : [], active_utterance_id: turnState ? utteranceId : null };
    throw new Error(`Forbidden presentation test effect ${method} ${path}`);
  });
}
beforeEach(() => { localStorage.clear(); vi.clearAllMocks(); });
afterEach(() => { cleanup(); localStorage.clear(); });
describe("canonical current-agent call presentation", () => {
  it("shows microphone off, consent and actual configured voice without starting a call", async () => {
    const request = gateway(); const view = render(<VoiceChat {...common} request={request}/>);
    await waitFor(() => expect(request).toHaveBeenCalledTimes(2));
    expect(screen.getByText("Microphone off")).toBeTruthy();
    expect(screen.getByText(/Spoken turns are sent automatically/)).toBeTruthy();
    expect(screen.getByRole("checkbox", { name: "Read replies aloud" })).toBeTruthy();
    expect(screen.getByRole("combobox", { name: "Configured speech voice" })).toBeTruthy();
    expect(view.container.querySelector('.wb-call-orb[aria-hidden="true"]')).toBeTruthy();
    expect(screen.queryByText("Listening")).toBeNull();
    expect(request.mock.calls.some(([method]) => method === "POST")).toBe(false);
    expect(lease.claim).not.toHaveBeenCalled();
  });
  it("never presents a disconnected service as listening or permits start", () => {
    const request = gateway(); render(<VoiceChat {...common} request={request} connected={false}/>);
    expect(screen.getByText("Service disconnected")).toBeTruthy();
    expect(screen.getByRole<HTMLButtonElement>("button", { name: "Start voice chat and send spoken turns" }).disabled).toBe(true);
    expect(screen.queryByText("Listening")).toBeNull();
    expect(request).not.toHaveBeenCalled();
  });
  it("shows Thinking only from the retained active original and retains its transcript", async () => {
    localStorage.setItem("veyra.voice-chat.v1:project:working-chat", JSON.stringify({ sessionId, utteranceId }));
    const request = gateway("awaiting_reply", "awaiting_reply"); render(<VoiceChat {...common} request={request}/>);
    expect(await screen.findByText("Thinking")).toBeTruthy();
    expect(screen.getByText("Transcript")).toBeTruthy();
    expect(screen.getByText(/Explain the actual failing test/)).toBeTruthy();
    expect(screen.queryByText("Speaking")).toBeNull();
    expect(request.mock.calls.some(([method]) => method === "POST")).toBe(false);
  });
  it("keeps original recovery/end controls outside the technical disclosure", async () => {
    localStorage.setItem("veyra.voice-chat.v1:project:working-chat", JSON.stringify({ sessionId }));
    const request = gateway("uncertain"); render(<VoiceChat {...common} request={request}/>);
    await screen.findByText("Check the original voice session");
    const stop = screen.getByRole<HTMLButtonElement>("button", { name: "Stop voice chat" });
    const check = screen.getByRole("button", { name: "Check original voice session and controls" });
    expect(stop.disabled).toBe(false); expect(stop.closest("details")).toBeNull(); expect(check.closest("details")).toBeNull();
    expect(screen.getByText("Voice settings and original session").closest("details")!.open).toBe(true);
    expect(JSON.parse(localStorage.getItem("veyra.voice-chat.v1:project:working-chat")!).sessionId).toBe(sessionId);
    expect(request.mock.calls.some(([method]) => method === "POST")).toBe(false);
  });
});
