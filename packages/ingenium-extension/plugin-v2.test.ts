import { describe, expect, it, vi } from "vitest";
import { defineV2Plugin, legacyPluginEvent, toolInputSchema, v2SessionAdapter } from "./plugin-v2.js";

function eventStream(events: unknown[], signal?: AbortSignal) {
  return (async function* () {
    for (const event of events) yield event;
    await new Promise<void>((resolve) => {
      if (signal?.aborted) return resolve();
      signal?.addEventListener("abort", () => resolve(), { once: true });
    });
  })();
}

function fakeContext(record: { events?: unknown[] } = {}) {
  const registered: unknown[] = [];
  const subscribed: AbortSignal[] = [];
  const sessionGet = vi.fn(async ({ sessionID }: { sessionID: string }) => ({
    id: sessionID,
    location: { directory: "/worktree" },
  }));
  const sessionContext = vi.fn(async () => [
    { id: "m1", type: "user", text: "one" },
    { id: "m2", type: "assistant", text: "two" },
    { id: "m3", type: "user", text: "three" },
  ]);
  const context = {
    location: { directory: "/worktree" },
    tool: {
      transform: vi.fn(async (callback: (editor: { add: (tool: unknown) => void }) => void) => {
        callback({ add: (tool: unknown) => registered.push(tool) });
      }),
    },
    event: {
      subscribe: ({ signal }: { signal?: AbortSignal } = {}) => {
        if (signal) subscribed.push(signal);
        return eventStream(record.events ?? [], signal);
      },
    },
    session: { get: sessionGet, context: sessionContext },
  };
  return { context, registered, subscribed, sessionGet, sessionContext };
}

describe("v2 plugin adapter", () => {
  it("exposes both the V2 setup and the retained V1 server factory", () => {
    const legacy = vi.fn(async () => ({}));
    const plugin = defineV2Plugin({ id: "ingenium-test", legacy });
    expect(plugin.id).toBe("ingenium-test");
    expect(plugin.server).toBe(legacy);
    expect(typeof plugin.setup).toBe("function");
  });

  it("registers V1 tools through the V2 tool transform with JSON Schema input", async () => {
    const execute = vi.fn(async () => "done");
    const legacy = vi.fn(async () => ({
      tool: { sample_tool: { description: "A sample tool", args: {}, execute } },
    }));
    const plugin = defineV2Plugin({ id: "ingenium-test", legacy });
    const { context, registered } = fakeContext();

    await plugin.setup(context as never);
    await new Promise((resolve) => setImmediate(resolve));

    expect(registered).toHaveLength(1);
    const tool = registered[0] as {
      name: string;
      description: string;
      input: { type: string; additionalProperties: boolean };
      execute: (args: unknown, ctx: unknown) => Promise<unknown>;
    };
    expect(tool.name).toBe("sample_tool");
    expect(tool.description).toBe("A sample tool");
    expect(tool.input).toMatchObject({ type: "object", additionalProperties: false });
    await expect(tool.execute({}, { sessionID: "s1" })).resolves.toEqual({ content: "done" });
    expect(execute).toHaveBeenCalledWith({}, { directory: "/worktree", worktree: "/worktree", sessionID: "s1" });
  });

  it("forwards adapted V2 events to the retained V1 event hook", async () => {
    const seen: unknown[] = [];
    const legacy = vi.fn(async () => ({
      event: async ({ event }: { event: unknown }) => {
        seen.push(event);
      },
    }));
    const plugin = defineV2Plugin({ id: "ingenium-test", legacy });
    const { context } = fakeContext({
      events: [
        { type: "session.created", data: { sessionID: "ses_1" } },
        { type: "session.idle", data: { sessionID: "ses_2" } },
      ],
    });

    const cleanup = await plugin.setup(context as never);
    await vi.waitFor(() => expect(seen).toHaveLength(2));
    expect(seen[0]).toEqual({ type: "session.created", properties: { sessionID: "ses_1" } });
    expect(seen[1]).toEqual({ type: "session.idle", properties: { sessionID: "ses_2" } });

    expect(typeof cleanup).toBe("function");
    await (cleanup as () => Promise<void>)();
  });

  it("adapts the V2 session API to the pinned V1 SDK response envelope", async () => {
    const { context, sessionGet } = fakeContext();
    const client = v2SessionAdapter(context as never);

    await expect(client.session.get({ sessionID: "ses_1" })).resolves.toEqual({
      data: { data: { id: "ses_1", location: { directory: "/worktree" } } },
    });
    expect(sessionGet).toHaveBeenCalledWith({ sessionID: "ses_1" });

    const first = await client.session.messages({ sessionID: "ses_1", limit: 2, order: "asc" });
    expect(first.data!.data!.map((message: { id: string }) => message.id)).toEqual(["m1", "m2"]);
    expect(first.data!.cursor).toEqual({ next: "2" });

    const second = await client.session.messages({ sessionID: "ses_1", limit: 2, cursor: "2" });
    expect(second.data!.data!.map((message: { id: string }) => message.id)).toEqual(["m3"]);
    expect(second.data!.cursor).toBeUndefined();

    const descending = await client.session.messages({ sessionID: "ses_1", limit: 2, order: "desc" });
    expect(descending.data!.data!.map((message: { id: string }) => message.id)).toEqual(["m3", "m2"]);
    expect(descending.data!.cursor).toEqual({ next: "desc:2" });

    const descendingSecond = await client.session.messages({
      sessionID: "ses_1", limit: 2, cursor: descending.data!.cursor!.next,
    });
    expect(descendingSecond.data!.data!.map((message: { id: string }) => message.id)).toEqual(["m1"]);
    expect(descendingSecond.data!.cursor).toBeUndefined();
  });

  it("normalizes tool argument tuples into a closed object schema", () => {
    expect(toolInputSchema({})).toMatchObject({
      type: "object",
      properties: {},
      additionalProperties: false,
    });
    expect(legacyPluginEvent({ type: "session.idle" })).toEqual({ type: "session.idle", properties: {} });
  });
});
