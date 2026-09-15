import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const create = vi.fn();
  const list = vi.fn();
  const messages = vi.fn();
  const prompt = vi.fn();
  const contextLink = vi.fn();
  const persistTurn = vi.fn();
  return {
    create,
    list,
    messages,
    prompt,
    contextLink,
    persistTurn,
    client: {
      sessions: { create, list, messages, prompt, abort: vi.fn(), revert: vi.fn() },
      permissions: { list: vi.fn().mockResolvedValue([]) },
      questions: { list: vi.fn().mockResolvedValue([]) },
      events: { url: (sessionId: string) => `/sessions/${sessionId}/events` },
    },
  };
});

vi.mock("../src/lib/RuntimeContext", () => ({
  useOpenCodeClient: () => mocks.client,
}));

vi.mock("../src/lib/api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return {
    ...actual,
    api: {
      ...actual.api,
      context: {
        ...actual.api.context,
        chat: { link: mocks.contextLink, persistTurn: mocks.persistTurn },
      },
    },
  };
});

import { useOpenCodeSessions } from "../src/lib/use-opencode-sessions";
import { useOpenCodeChat } from "../src/lib/use-opencode-chat";

const oldSession = {
  id: "session-old",
  title: "Old conversation",
  time: { created: 1, updated: 1 },
};
const newSession = {
  id: "session-new",
  title: "New conversation",
  time: { created: 2, updated: 2 },
};

describe("useOpenCodeSessions", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;

  beforeEach(() => {
    localStorage.clear();
    mocks.create.mockReset();
    mocks.list.mockReset();
    mocks.messages.mockReset().mockResolvedValue([]);
    mocks.prompt.mockReset().mockResolvedValue({ info: {}, parts: [] });
    mocks.contextLink.mockReset().mockResolvedValue({ data: { id: "11111111-1111-4111-8111-111111111112", revision: 0 } });
    mocks.persistTurn.mockReset().mockResolvedValue({ data: { revision: 1 } });
    fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("Aborted", "AbortError"));
  });

  afterEach(() => {
    fetchSpy.mockRestore();
    cleanup();
  });

  it("keeps a new session selected when an older refresh resolves and checkpoints its turn once", async () => {
    let resolveOlderRefresh!: (sessions: typeof oldSession[]) => void;
    let resolveCreate!: (session: typeof newSession) => void;
    const olderRefresh = new Promise<typeof oldSession[]>((resolve) => { resolveOlderRefresh = resolve; });
    const creating = new Promise<typeof newSession>((resolve) => { resolveCreate = resolve; });
    mocks.list
      .mockImplementationOnce(() => olderRefresh)
      .mockResolvedValueOnce([newSession]);
    mocks.create.mockImplementationOnce(() => creating);
    let completed = false;
    const completedTurn = [
      { info: { id: "new-user", sessionID: newSession.id, role: "user", time: { created: 1 } }, parts: [{ type: "text", text: "New question" }] },
      { info: { id: "new-assistant", sessionID: newSession.id, role: "assistant", time: { created: 2, completed: 3 }, finish: "stop" }, parts: [{ type: "text", text: "New answer" }] },
    ];
    mocks.messages.mockImplementation(async (sessionId: string) => {
      expect(sessionId).toBe(newSession.id);
      return completed ? completedTurn : [];
    });
    let streamController!: ReadableStreamDefaultController<Uint8Array>;
    fetchSpy.mockResolvedValue(new Response(new ReadableStream<Uint8Array>({
      start(controller) { streamController = controller; },
    })));
    const { result } = renderHook(() => {
      const sessions = useOpenCodeSessions();
      const chat = useOpenCodeChat(sessions.activeId, sessions.activeId ? {
        project: "session-race-project",
        runtimeId: "11111111-1111-4111-8111-111111111111",
        title: "New conversation",
      } : undefined);
      return { sessions, chat };
    });

    let creation!: Promise<string | null>;
    act(() => { creation = result.current.sessions.create("New conversation"); });
    await vi.waitFor(() => expect(result.current.sessions.isCreating).toBe(true));
    await expect(result.current.sessions.create("Duplicate conversation")).resolves.toBeNull();
    expect(mocks.create).toHaveBeenCalledTimes(1);
    await act(async () => {
      resolveCreate(newSession);
      await creation;
    });
    expect(result.current.sessions.activeId).toBe(newSession.id);
    expect(result.current.sessions.isCreating).toBe(false);
    expect(localStorage.getItem("opencode-chat-active-session")).toBe(newSession.id);

    await act(async () => { resolveOlderRefresh([oldSession]); });
    expect(result.current.sessions.activeId).toBe(newSession.id);
    await vi.waitFor(() => expect(result.current.chat.isLoading).toBe(false));

    completed = true;
    await act(async () => {
      expect(await result.current.chat.send([{ type: "text", text: "New question" }])).toBe(true);
    });
    expect(mocks.prompt).toHaveBeenCalledWith(newSession.id, expect.any(Object));
    const encoder = new TextEncoder();
    await act(async () => {
      streamController.enqueue(encoder.encode(
        `id: idle-one\ndata: ${JSON.stringify({ type: "session.idle", properties: { sessionID: newSession.id } })}\n\n`
        + `id: idle-two\ndata: ${JSON.stringify({ type: "session.idle", properties: { sessionID: newSession.id } })}\n\n`,
      ));
    });
    await vi.waitFor(() => expect(mocks.persistTurn).toHaveBeenCalledTimes(1));
    expect(mocks.persistTurn).toHaveBeenCalledWith(
      "11111111-1111-4111-8111-111111111112",
      expect.objectContaining({ sessionId: newSession.id, userMessageId: "new-user", assistantMessageId: "new-assistant" }),
      "session-race-project",
    );
  });

  it("keeps the current selection and releases the creation guard after failure", async () => {
    mocks.list.mockResolvedValue([oldSession]);
    mocks.create.mockRejectedValueOnce(new Error("create failed"));
    const { result } = renderHook(() => useOpenCodeSessions());
    await vi.waitFor(() => expect(result.current.activeId).toBe(oldSession.id));

    await act(async () => {
      expect(await result.current.create("New conversation")).toBeNull();
    });

    expect(result.current.activeId).toBe(oldSession.id);
    expect(result.current.error).toBe("create failed");
    expect(result.current.isCreating).toBe(false);
  });

  it("keeps an explicit selection when an older refresh resolves", async () => {
    let resolveOlderRefresh!: (sessions: typeof oldSession[]) => void;
    mocks.list.mockImplementationOnce(() => new Promise((resolve) => { resolveOlderRefresh = resolve; }));
    const { result } = renderHook(() => useOpenCodeSessions());

    act(() => result.current.select(newSession.id));
    await act(async () => { resolveOlderRefresh([oldSession]); });

    expect(result.current.activeId).toBe(newSession.id);
    expect(localStorage.getItem("opencode-chat-active-session")).toBe(newSession.id);
  });

  it("does not select a session whose creation resolves after unmount", async () => {
    let resolveCreate!: (session: typeof newSession) => void;
    mocks.list.mockResolvedValue([oldSession]);
    mocks.create.mockImplementationOnce(() => new Promise((resolve) => { resolveCreate = resolve; }));
    const { result, unmount } = renderHook(() => useOpenCodeSessions());
    await vi.waitFor(() => expect(result.current.activeId).toBe(oldSession.id));
    let creation!: Promise<string | null>;
    act(() => { creation = result.current.create("New conversation"); });

    unmount();
    resolveCreate(newSession);
    await expect(creation).resolves.toBeNull();
    expect(localStorage.getItem("opencode-chat-active-session")).not.toBe(newSession.id);
  });
});
