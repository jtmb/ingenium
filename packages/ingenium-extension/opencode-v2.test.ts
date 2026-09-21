import { describe, expect, it, vi } from "vitest";
import {
  eventSessionId,
  getV2SessionInfo,
  legacySessionMessage,
  readV2Messages,
  type OpenCodeV2Client,
} from "./opencode-v2.js";

describe("OpenCode v2 adapter", () => {
  it("accepts the native lifecycle session property and rejects unsafe identifiers", () => {
    expect(eventSessionId({ type: "session.idle", properties: { sessionID: "ses-valid" } })).toBe("ses-valid");
    expect(eventSessionId({ type: "session.created", properties: { info: { id: "ses-info" } } })).toBe("ses-info");
    expect(eventSessionId({ type: "session.idle", properties: { sessionID: "../../private" } })).toBeUndefined();
  });

  it("maps v2 projected messages into the redaction codec envelope", () => {
    const user = legacySessionMessage({
      id: "user-1",
      type: "user",
      time: { created: 1 },
      metadata: { hidden: true },
      text: "prompt",
    }, "ses-1");
    expect(user).toMatchObject({ info: { id: "user-1", sessionID: "ses-1", role: "user", hidden: true } });

    const assistant = legacySessionMessage({
      id: "assistant-1",
      type: "assistant",
      agent: "engineer",
      model: { id: "model", providerID: "provider" },
      time: { created: 1, completed: 2 },
      content: [{ type: "text", id: "part-1", text: "answer" }],
    }, "ses-1");
    expect(assistant).toMatchObject({
      info: { role: "assistant", sessionID: "ses-1", modelID: "model", providerID: "provider" },
      parts: [{ type: "text", text: "answer" }],
    });
  });

  it("unwraps the v2 session detail response envelope", async () => {
    const session = {
      id: "ses-1",
      projectID: "project-1",
      location: { directory: "/workspace" },
    };
    const get = vi.fn().mockResolvedValue({ data: { data: session } });
    const client = { session: { get } } as unknown as OpenCodeV2Client;

    await expect(getV2SessionInfo(client, "ses-1")).resolves.toEqual(session);
  });

  it("follows v2 cursors and fails closed when the server repeats one", async () => {
    const messages = vi.fn()
      .mockResolvedValueOnce({ data: { data: [{ id: "m1", type: "user", time: { created: 1 }, text: "one" }], cursor: { next: "next" } } })
      .mockResolvedValueOnce({ data: { data: [{ id: "m2", type: "user", time: { created: 2 }, text: "two" }], cursor: { next: null } } });
    const client = { session: { messages } } as unknown as OpenCodeV2Client;
    const result = await readV2Messages(client, "ses-1");
    expect(result.map((message) => message.id)).toEqual(["m1", "m2"]);
    expect(messages).toHaveBeenNthCalledWith(1, { sessionID: "ses-1", limit: 100, order: "asc" });
    expect(messages).toHaveBeenNthCalledWith(2, { sessionID: "ses-1", limit: 100, cursor: "next" });

    messages.mockReset().mockResolvedValue({
      data: { data: [{ id: "m1", type: "user", time: { created: 1 }, text: "one" }], cursor: { next: "same" } },
    });
    await expect(readV2Messages(client, "ses-1")).rejects.toThrow("OPENCODE_V2_CURSOR_FAILED");
  });
});
