import { describe, expect, it, vi } from "vitest";
import { FreshConversationStart } from "../src/lib/fresh-conversation-start";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>(done => { resolve = done; });
  return { promise, resolve };
}

describe("Home conversation start", () => {
  it("never sends through the old binding and waits for the newly created conversation", async () => {
    const starter = new FreshConversationStart<string>();
    starter.activate();
    const oldSend = vi.fn();
    const newSend = vi.fn().mockResolvedValue(true);
    const creation = deferred<string>();
    const create = vi.fn(() => creation.promise);
    starter.publish({ sessionId: "old", ready: true, error: null, send: oldSend });
    const result = starter.start(create, "first Home prompt", ["old"]);
    expect(await starter.start(create, "double click", ["old"])).toEqual({ kind: "busy" });
    creation.resolve("new");
    await Promise.resolve();
    expect(oldSend).not.toHaveBeenCalled();
    expect(newSend).not.toHaveBeenCalled();
    starter.publish({ sessionId: "old", ready: true, error: null, send: oldSend });
    starter.publish({ sessionId: "new", ready: false, error: null, send: newSend });
    expect(newSend).not.toHaveBeenCalled();
    starter.publish({ sessionId: "new", ready: true, error: null, send: newSend });
    expect(await result).toEqual({ kind: "accepted", sessionId: "new" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(oldSend).not.toHaveBeenCalled();
    expect(newSend).toHaveBeenCalledExactlyOnceWith("first Home prompt", expect.any(Function));
    starter.publish({ sessionId: "new", ready: true, error: null, send: newSend });
    expect(newSend).toHaveBeenCalledTimes(1);
  });

  it("refuses a create result that names an existing conversation", async () => {
    const starter = new FreshConversationStart<string>();
    starter.activate();
    const send = vi.fn();
    starter.publish({ sessionId: "old", ready: true, error: null, send });
    expect(await starter.start(async () => "old", "prompt", ["old"])).toEqual({ kind: "review", sessionId: "old" });
    expect(send).not.toHaveBeenCalled();
  });

  it("does not send a late create result after its project/runtime owner unmounts", async () => {
    const starter = new FreshConversationStart<string>();
    const deactivate = starter.activate();
    const creation = deferred<string>();
    const send = vi.fn();
    const result = starter.start(() => creation.promise, "old project prompt");
    deactivate();
    starter.activate();
    starter.publish({ sessionId: "new", ready: true, error: null, send });
    creation.resolve("new");
    expect(await result).toEqual({ kind: "cancelled" });
    expect(send).not.toHaveBeenCalled();
  });

  it("retires the send guard while asynchronous context preparation is pending", async () => {
    const starter = new FreshConversationStart<string>();
    const deactivate = starter.activate();
    const preparation = deferred<void>();
    const prompt = vi.fn();
    const preparing = deferred<void>();
    starter.publish({ sessionId: "new", ready: true, error: null, send: async (_input, current) => {
      preparing.resolve();
      await preparation.promise;
      if (!current()) return false;
      prompt();
      return true;
    } });
    const result = starter.start(async () => "new", "prompt");
    await preparing.promise;
    deactivate();
    preparation.resolve();
    await result;
    expect(prompt).not.toHaveBeenCalled();
  });

  it("keeps an uncertain send attached to its original conversation instead of creating or sending again", async () => {
    const starter = new FreshConversationStart<string>();
    starter.activate();
    const create = vi.fn().mockResolvedValue("new");
    const send = vi.fn().mockRejectedValue(new Error("admission response lost"));
    starter.publish({ sessionId: "new", ready: true, error: null, send });
    expect(await starter.start(create, "original prompt")).toEqual({ kind: "review", sessionId: "new" });
    expect(await starter.start(create, "retry prompt")).toEqual({ kind: "review", sessionId: "new" });
    expect(create).toHaveBeenCalledTimes(1);
    expect(send).toHaveBeenCalledTimes(1);
  });

  it("does not send after a preparation timeout or an unreadable new history", async () => {
    vi.useFakeTimers();
    try {
      const starter = new FreshConversationStart<string>(100);
      starter.activate();
      const send = vi.fn();
      const result = starter.start(async () => "new", "prompt");
      await vi.advanceTimersByTimeAsync(100);
      expect(await result).toEqual({ kind: "review", sessionId: "new" });
      starter.publish({ sessionId: "new", ready: true, error: null, send });
      expect(send).not.toHaveBeenCalled();
      const other = new FreshConversationStart<string>();
      other.activate();
      other.publish({ sessionId: "unreadable", ready: true, error: "History unavailable", send });
      expect(await other.start(async () => "unreadable", "prompt")).toEqual({ kind: "review", sessionId: "unreadable" });
      expect(send).not.toHaveBeenCalled();
    } finally { vi.useRealTimers(); }
  });
});
