import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, renderHook } from "@testing-library/react";
import { useOpenCodeChat } from "../src/lib/use-opencode-chat";

const mocks = vi.hoisted(() => ({ messages: vi.fn(), status: vi.fn(), prompt: vi.fn() }));
const client = {
  sessions: { messages: mocks.messages, status: mocks.status, prompt: mocks.prompt },
  permissions: { list: async () => [] }, questions: { list: async () => [] },
  events: { url: (id: string) => "/fixture-events/" + id },
};
vi.mock("../src/lib/RuntimeContext", () => ({ useOpenCodeClient: () => client }));

const user = { info: { id: "user-1", sessionID: "session-1", role: "user", time: { created: 1 } },
  parts: [{ id: "user-part", sessionID: "session-1", messageID: "user-1", type: "text", text: "Already admitted on Home" }] };
const assistant = { info: { id: "assistant-1", sessionID: "session-1", role: "assistant", finish: "stop", time: { created: 2, completed: 3 } },
  parts: [{ id: "answer-part", sessionID: "session-1", messageID: "assistant-1", type: "text", text: "The real completed answer" }] };
const busy = [{ type: "busy", sessionID: "session-1" }];
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
function event(type: string, properties: unknown) { return new TextEncoder().encode("data: " + JSON.stringify({ type, properties }) + "\n\n"); }
function openedStream() { let controller!: ReadableStreamDefaultController<Uint8Array>; const stream = new ReadableStream<Uint8Array>({ start(value) { controller = value; } }); return { stream, controller }; }

describe("opening an already-admitted conversation", () => {
  let fetchMock: ReturnType<typeof vi.fn>;
  beforeEach(() => {
    mocks.messages.mockReset().mockResolvedValue([user]); mocks.status.mockReset().mockResolvedValue(busy); mocks.prompt.mockReset();
    fetchMock = vi.fn(); vi.stubGlobal("fetch", fetchMock);
  });
  afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

  it("receives the running turn after navigation without submitting another prompt", async () => {
    const live = openedStream(); fetchMock.mockResolvedValue(new Response(live.stream));
    const { result } = renderHook(() => useOpenCodeChat("session-1"));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await vi.waitFor(() => expect(result.current.isStreaming).toBe(true));
    await act(async () => {
      live.controller.enqueue(event("message.updated", { info: { ...assistant.info, finish: undefined, time: { created: 2 } } }));
      live.controller.enqueue(event("message.part.updated", { part: assistant.parts[0] }));
      live.controller.enqueue(event("session.idle", { sessionID: "session-1" }));
    });
    await vi.waitFor(() => expect(result.current.messages.at(-1)?.content).toBe("The real completed answer"));
    await vi.waitFor(() => expect(result.current.isStreaming).toBe(false));
    expect(mocks.prompt).not.toHaveBeenCalled();
  });

  it("reloads the terminal history when the turn completes between the first history and activity reads", async () => {
    mocks.status.mockResolvedValue([]); mocks.messages.mockResolvedValueOnce([user]).mockResolvedValue([user, assistant]);
    const { result } = renderHook(() => useOpenCodeChat("session-1"));
    await vi.waitFor(() => expect(result.current.messages.at(-1)?.content).toBe("The real completed answer"));
    expect(result.current.isStreaming).toBe(false); expect(fetchMock).not.toHaveBeenCalled(); expect(mocks.prompt).not.toHaveBeenCalled();
  });

  it("recovers a completion that precedes the replacement subscription without waiting for another event", async () => {
    const headers = deferred<Response>(); const live = openedStream(); fetchMock.mockReturnValue(headers.promise);
    mocks.status.mockResolvedValueOnce(busy).mockResolvedValue([]);
    mocks.messages.mockResolvedValueOnce([user]).mockResolvedValue([user, assistant]);
    const { result } = renderHook(() => useOpenCodeChat("session-1"));
    await vi.waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    await act(async () => { headers.resolve(new Response(live.stream)); });
    await vi.waitFor(() => expect(result.current.messages.at(-1)?.content).toBe("The real completed answer"));
    expect(result.current.isStreaming).toBe(false); expect(mocks.prompt).not.toHaveBeenCalled();
  });

  it("discards an old activity response after a different session is selected", async () => {
    const activity = deferred<unknown>(); mocks.status.mockReturnValue(activity.promise);
    mocks.messages.mockResolvedValueOnce([user]).mockResolvedValue([]);
    const { result, rerender } = renderHook(({ id }) => useOpenCodeChat(id), { initialProps: { id: "session-1" } });
    await vi.waitFor(() => expect(mocks.status).toHaveBeenCalledTimes(1));
    rerender({ id: "session-2" }); await vi.waitFor(() => expect(result.current.sessionReady).toBe(true));
    await act(async () => { activity.resolve([]); });
    expect(result.current.messages).toEqual([]); expect(result.current.isStreaming).toBe(false); expect(fetchMock).not.toHaveBeenCalled();
    expect(mocks.messages.mock.calls.map(([id]) => id)).toEqual(["session-1", "session-2"]);
  });
  it("does not turn an unavailable activity response into an idle conversation", async () => {
    mocks.status.mockResolvedValue({ unexpected: true });
    const { result } = renderHook(() => useOpenCodeChat("session-1"));
    await vi.waitFor(() => expect(result.current.error).toBe("Conversation activity is unavailable."));
    expect(fetchMock).not.toHaveBeenCalled(); expect(mocks.prompt).not.toHaveBeenCalled();
  });

  it("keeps newer streamed content authoritative while recovery activity is pending", async () => {
    const activity = deferred<unknown>(), live = openedStream(); fetchMock.mockResolvedValue(new Response(live.stream));
    mocks.status.mockResolvedValueOnce(busy).mockReturnValue(activity.promise);
    const { result } = renderHook(() => useOpenCodeChat("session-1"));
    await vi.waitFor(() => expect(mocks.status).toHaveBeenCalledTimes(2));
    await act(async () => {
      live.controller.enqueue(event("message.updated", { info: { ...assistant.info, finish: undefined, time: { created: 2 } } }));
      live.controller.enqueue(event("message.part.updated", { part: { ...assistant.parts[0], text: "Newer streamed answer" } }));
    });
    await vi.waitFor(() => expect(result.current.messages.at(-1)?.content).toBe("Newer streamed answer"));
    await act(async () => { activity.resolve([]); });
    expect(result.current.isStreaming).toBe(true); expect(mocks.messages).toHaveBeenCalledTimes(1);
    expect(result.current.messages.at(-1)?.content).toBe("Newer streamed answer");
    await act(async () => { live.controller.enqueue(event("session.idle", { sessionID: "session-1" })); });
    await vi.waitFor(() => expect(result.current.isStreaming).toBe(false));
  });

  it("discards a late recovery snapshot after selecting another conversation", async () => {
    const activity = deferred<unknown>(), live = openedStream(); fetchMock.mockResolvedValue(new Response(live.stream));
    mocks.status.mockResolvedValueOnce(busy).mockReturnValue(activity.promise);
    mocks.messages.mockResolvedValueOnce([user]).mockResolvedValue([]);
    const { result, rerender } = renderHook(({ id }) => useOpenCodeChat(id), { initialProps: { id: "session-1" } });
    await vi.waitFor(() => expect(mocks.status).toHaveBeenCalledTimes(2));
    rerender({ id: "session-2" }); await vi.waitFor(() => expect(result.current.sessionReady).toBe(true));
    await act(async () => { activity.resolve([]); });
    expect(result.current.messages).toEqual([]); expect(result.current.isStreaming).toBe(false);
    expect(mocks.messages.mock.calls.map(([id]) => id)).toEqual(["session-1", "session-2"]);
    expect(mocks.prompt).not.toHaveBeenCalled();
  });

});
