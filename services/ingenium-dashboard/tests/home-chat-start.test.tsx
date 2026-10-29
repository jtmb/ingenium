import React from "react";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => {
  const create = vi.fn(), list = vi.fn(), messages = vi.fn(), prompt = vi.fn();
  const memorySave = vi.fn(), memoryStatus = vi.fn(), contextSearch = vi.fn();
  return { create, list, messages, prompt, memorySave, memoryStatus, contextSearch,
    client: {
      sessions: { create, list, messages, prompt, update: vi.fn().mockResolvedValue({}), abort: vi.fn(), revert: vi.fn() },
      permissions: { list: vi.fn().mockResolvedValue([]) }, questions: { list: vi.fn().mockResolvedValue([]) },
      events: { url: (id: string) => "/fixture-events/" + id },
      chat: { config: vi.fn(), saveSelection: vi.fn().mockResolvedValue({}) },
      mcp: { status: vi.fn().mockResolvedValue({}), connect: vi.fn(), disconnect: vi.fn() },
    },
  };
});

vi.mock("../src/lib/RuntimeContext", () => ({
  useOpenCodeClient: () => mocks.client,
  useRuntime: () => ({ projectName: "home-project", runtimeId: "home-runtime", workspace: {
    mode: "isolated", confirmedProjectName: "home-project", confirmedWorkspaceId: "home-workspace",
  } }),
}));
vi.mock("../src/lib/ProjectContext", () => ({ useProject: () => "home-project" }));
vi.mock("../src/app/components/ProjectDropdown", () => ({ default: () => <button type="button">home-project</button> }));
vi.mock("../src/lib/api", async importOriginal => {
  const actual = await importOriginal<typeof import("../src/lib/api")>();
  return { ...actual, api: { ...actual.api,
    context: { ...actual.api.context,
      rag: { ...actual.api.context.rag, search: mocks.contextSearch },
      chat: { link: vi.fn().mockResolvedValue({ data: { id: "11111111-1111-4111-8111-111111111112", revision: 0 } }), persistTurn: vi.fn() },
    },
    memory: { ...actual.api.memory, list: vi.fn().mockResolvedValue({ data: { items: [], total: 0, nextOffset: null,
      budget: { maxItems: 16, maxTokens: 2048, usedItems: 0, usedTokens: 0, truncated: false } } }),
      save: mocks.memorySave, operationStatus: mocks.memoryStatus },
    mcpTools: { ...actual.api.mcpTools, list: vi.fn().mockResolvedValue({ project: "home-project", data: [{ category: "Memory",
      tools: ["ingenium_memory_list", "ingenium_memory_save", "ingenium_memory_operation_status"].map(tool_name => ({ tool_name, enabled: true })) }] }) },
  } };
});

import ChatShell from "../src/app/chat/components/ChatShell";

const oldSession = { id: "home-old", title: "Previous conversation", time: { created: 1, updated: 1 } };
const newSession = { id: "home-new", title: "New conversation", time: { created: 2, updated: 2 } };
function deferred<T>() { let resolve!: (value: T) => void; const promise = new Promise<T>(done => { resolve = done; }); return { promise, resolve }; }
async function ready(onStarted = vi.fn()) {
  const view = render(<ChatShell presentation="home" onConversationStarted={onStarted}/>);
  await waitFor(() => expect(screen.getByRole("combobox", { name: "Home chat model" })).toHaveValue(JSON.stringify(["provider", "model"])));
  await waitFor(() => expect(screen.getByTestId("chat-composer")).toBeEnabled());
  return { ...view, onStarted };
}
function send(text = "First Home prompt") {
  fireEvent.change(screen.getByTestId("chat-composer"), { target: { value: text } });
  fireEvent.click(screen.getByRole("button", { name: "Send message", exact: true }));
}
function controlledFileReads() {
  const created: Reader[] = [];
  class Reader {
    result: string | null = null;
    onload: (() => void) | null = null;
    onerror: (() => void) | null = null;
    aborted = false;
    constructor() { created.push(this); }
    readAsDataURL(_file: Blob) {}
    abort() { this.aborted = true; }
    finish(value: string) { this.result = value; this.onload?.(); }
  }
  vi.stubGlobal("FileReader", Reader);
  return created;
}

describe("rendered Home composer with the real session and chat hooks", () => {
  let fetchSpy: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    localStorage.clear(); localStorage.setItem("opencode-chat-active-session", oldSession.id);
    Object.defineProperty(window, "matchMedia", { configurable: true, value: vi.fn().mockReturnValue({ matches: false, addEventListener: vi.fn(), removeEventListener: vi.fn() }) });
    mocks.create.mockReset().mockResolvedValue(newSession);
    mocks.list.mockReset().mockResolvedValue([oldSession]);
    mocks.messages.mockReset().mockResolvedValue([]);
    mocks.prompt.mockReset().mockResolvedValue({ messageID: "new-prompt" });
    mocks.contextSearch.mockReset().mockResolvedValue({ data: [] });
    mocks.memorySave.mockReset(); mocks.memoryStatus.mockReset();
    mocks.client.chat.config.mockResolvedValue({ project: "home-project", configured: true,
      primary: { providerId: "provider", modelId: "model", label: "Provider", isCustom: false }, backup: null,
      agents: [{ name: "ingenium-chat", label: "Chat" }],
      providers: [{ providerId: "provider", label: "Provider", models: [{ id: "model", label: "Model" }], defaultModel: "model", source: "managed" }],
      defaultSelection: { providerId: "provider", modelId: "model" },
    });
    fetchSpy = vi.spyOn(globalThis, "fetch").mockRejectedValue(new DOMException("Aborted", "AbortError"));
  });
  afterEach(() => { cleanup(); fetchSpy.mockRestore(); vi.unstubAllGlobals(); vi.clearAllMocks(); });

  it("does not load or mutate the persisted chat when Home opens", async () => {
    await ready();
    expect(mocks.create).not.toHaveBeenCalled(); expect(mocks.messages).not.toHaveBeenCalled();
    expect(mocks.prompt).not.toHaveBeenCalled();
    expect(localStorage.getItem("opencode-chat-active-session")).toBe(oldSession.id);
  });

  it("keeps ordinary Chat input unavailable until the exact initial session and history are ready", async () => {
    const catalog = deferred<typeof oldSession[]>(), history = deferred<[]>();
    mocks.list.mockReturnValue(catalog.promise);
    mocks.messages.mockReturnValue(history.promise);
    render(<ChatShell />);
    await waitFor(() => expect(mocks.client.chat.config).toHaveBeenCalled());
    expect(screen.queryByTestId("chat-composer")).toBeNull();
    await act(async () => catalog.resolve([oldSession]));
    await waitFor(() => expect(mocks.messages).toHaveBeenCalledWith(oldSession.id));
    expect(screen.queryByTestId("chat-composer")).toBeNull();
    expect(mocks.prompt).not.toHaveBeenCalled();
    await act(async () => history.resolve([]));
    const composer = await screen.findByTestId("chat-composer");
    expect(composer).toBeEnabled();
    fireEvent.change(composer, { target: { value: "First cold-start draft" } });
    fireEvent.click(screen.getByRole("button", { name: "Send message", exact: true }));
    await waitFor(() => expect(mocks.prompt).toHaveBeenCalledExactlyOnceWith(oldSession.id, expect.objectContaining({ parts: [{ type: "text", text: "First cold-start draft" }] })));
  });

  it("waits for the new history, sends once to that session, then opens its exact identity", async () => {
    const creation = deferred<typeof newSession>(), history = deferred<[]>();
    mocks.create.mockReturnValue(creation.promise); mocks.messages.mockReturnValue(history.promise);
    const view = await ready();
    send(); send("Second click");
    expect(mocks.create).toHaveBeenCalledTimes(1); expect(mocks.prompt).not.toHaveBeenCalled();
    await act(async () => { creation.resolve(newSession); });
    await waitFor(() => expect(mocks.messages).toHaveBeenCalledWith(newSession.id));
    expect(mocks.prompt).not.toHaveBeenCalled();
    await act(async () => { history.resolve([]); });
    await waitFor(() => expect(view.onStarted).toHaveBeenCalledExactlyOnceWith(newSession.id));
    expect(mocks.prompt).toHaveBeenCalledExactlyOnceWith(newSession.id, expect.objectContaining({
      parts: [{ type: "text", text: "First Home prompt" }], model: { providerID: "provider", modelID: "model" },
    }));
    expect(mocks.messages.mock.calls.every(([id]) => id === newSession.id)).toBe(true);
  });

  it("does not submit a late create response after Home unmounts", async () => {
    const creation = deferred<typeof newSession>(); mocks.create.mockReturnValue(creation.promise);
    const view = await ready(); send(); view.unmount();
    await act(async () => { creation.resolve(newSession); });
    expect(mocks.prompt).not.toHaveBeenCalled(); expect(view.onStarted).not.toHaveBeenCalled();
    expect(localStorage.getItem("opencode-chat-active-session")).toBe(oldSession.id);
  });

  it("waits for concurrent file reads and sends both actual payloads in selection order", async () => {
    const reads = controlledFileReads();
    const view = await ready();
    const fileInput = view.container.querySelector<HTMLInputElement>('input[type="file"]')!;
    const first = new File(["first file"], "first.txt", { type: "text/plain" });
    const second = new File(["second file"], "second.txt", { type: "text/plain" });
    fireEvent.change(fileInput, { target: { files: [first, second] } });
    fireEvent.change(screen.getByTestId("chat-composer"), { target: { value: "Read these two files" } });
    expect(screen.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
    act(() => reads[1]!.finish("data:text/plain;base64,c2Vjb25kIGZpbGU="));
    expect(screen.getByRole("button", { name: "Send message", exact: true })).toBeDisabled();
    act(() => reads[0]!.finish("data:text/plain;base64,Zmlyc3QgZmlsZQ=="));
    fireEvent.click(screen.getByRole("button", { name: "Send message", exact: true }));
    await waitFor(() => expect(view.onStarted).toHaveBeenCalledWith(newSession.id));
    expect(mocks.prompt).toHaveBeenCalledExactlyOnceWith(newSession.id, expect.objectContaining({ parts: [
      { type: "text", text: "Read these two files" },
      { type: "file", filename: "first.txt", mime: "text/plain", url: "data:text/plain;base64,Zmlyc3QgZmlsZQ==" },
      { type: "file", filename: "second.txt", mime: "text/plain", url: "data:text/plain;base64,c2Vjb25kIGZpbGU=" },
    ] }));
  });

  it("discards a removed file's late read instead of adding it to a later prompt", async () => {
    const reads = controlledFileReads(); const view = await ready();
    fireEvent.change(view.container.querySelector<HTMLInputElement>('input[type="file"]')!, {
      target: { files: [new File(["removed"], "removed.txt", { type: "text/plain" })] },
    });
    fireEvent.click(screen.getByRole("button", { name: "Remove removed.txt" }));
    expect(reads[0]!.aborted).toBe(true);
    act(() => reads[0]!.finish("data:text/plain;base64,cmVtb3ZlZA=="));
    expect(screen.queryByText("removed.txt")).toBeNull();
    send("Text without the removed file");
    await waitFor(() => expect(view.onStarted).toHaveBeenCalledWith(newSession.id));
    expect(mocks.prompt).toHaveBeenCalledExactlyOnceWith(newSession.id, expect.objectContaining({
      parts: [{ type: "text", text: "Text without the removed file" }],
    }));
  });

  it("rechecks the Home owner after asynchronous project-context preparation", async () => {
    const context = deferred<{ data: [] }>(); mocks.contextSearch.mockReturnValue(context.promise);
    const view = await ready();
    fireEvent.click(screen.getByText("Search", { exact: true }));
    fireEvent.click(screen.getByRole("checkbox", { name: "Search project context" }));
    send();
    await waitFor(() => expect(mocks.contextSearch).toHaveBeenCalledWith("First Home prompt", "home-project", expect.any(Number)));
    view.unmount(); await act(async () => { context.resolve({ data: [] }); });
    expect(mocks.prompt).not.toHaveBeenCalled(); expect(view.onStarted).not.toHaveBeenCalled();
  });

  it("retains a failed admission for review without creating or prompting again", async () => {
    mocks.prompt.mockRejectedValue(new Error("Admission response unavailable"));
    const view = await ready(); send();
    await screen.findByRole("button", { name: "Review conversation" });
    expect(screen.getByTestId("chat-composer")).toHaveValue("First Home prompt");
    expect(screen.getByTestId("chat-composer")).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Send message", exact: true }));
    expect(mocks.prompt).toHaveBeenCalledTimes(1); expect(mocks.create).toHaveBeenCalledTimes(1);
    expect(view.onStarted).not.toHaveBeenCalled();
    fireEvent.click(screen.getByRole("button", { name: "Review conversation" }));
    expect(view.onStarted).toHaveBeenCalledExactlyOnceWith(newSession.id);
  });

  it("keeps a pending memory-save original on Home until its status is resolved", async () => {
    mocks.memorySave.mockResolvedValue({ data: { status: "queued" } });
    mocks.memoryStatus.mockResolvedValue({ data: { status: "committed", receipt: { version: 2, receiptId: "home-memory-receipt" } } });
    const view = await ready();
    fireEvent.change(screen.getByTestId("chat-composer"), { target: { value: "Synthetic Home memory receipt" } });
    fireEvent.click(screen.getByLabelText("Send options"));
    await waitFor(() => expect(screen.getByRole("button", { name: "Send and save to memory" })).toBeEnabled());
    fireEvent.click(screen.getByRole("button", { name: "Send and save to memory" }));
    await screen.findByRole("button", { name: "Check memory save" });
    expect(view.onStarted).not.toHaveBeenCalled(); expect(screen.getByRole("button", { name: "Open conversation" })).toBeDisabled();
    const original = mocks.memorySave.mock.calls[0]![1];
    fireEvent.click(screen.getByRole("button", { name: "Check memory save" }));
    await waitFor(() => expect(screen.getByRole("button", { name: "Open conversation" })).toBeEnabled());
    expect(mocks.memoryStatus).toHaveBeenCalledExactlyOnceWith("home-project", "home-workspace", original.operationId);
    fireEvent.click(screen.getByRole("button", { name: "Open conversation" }));
    expect(view.onStarted).toHaveBeenCalledExactlyOnceWith(newSession.id);
    expect(mocks.memorySave).toHaveBeenCalledTimes(1); expect(mocks.prompt).toHaveBeenCalledTimes(1); expect(mocks.create).toHaveBeenCalledTimes(1);
  });
});
