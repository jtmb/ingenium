import { afterEach, describe, expect, it, vi } from "vitest";

import { GET } from "../src/app/api/v1/opencode/sessions/[id]/events/route";

const encoder = new TextEncoder();

function realOpenCodeEnvelopeStream(): {
  stream: ReadableStream<Uint8Array>;
  controller: ReadableStreamDefaultController<Uint8Array>;
} {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const stream = new ReadableStream<Uint8Array>({
    start(nextController) {
      controller = nextController;
    },
  });
  return { stream, controller };
}

describe("OpenCode session event route", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.unstubAllGlobals();
  });

  it("streams the real OpenCode envelope on the persistent session event path", async () => {
    const { stream, controller } = realOpenCodeEnvelopeStream();
    const fetchMock = vi.fn().mockResolvedValue(
      new Response(stream, {
        status: 200,
        headers: { "content-type": "text/event-stream" },
      }),
    );
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request(
        "http://dashboard.test/api/v1/opencode/sessions/ses_live/events?directory=%2Fworkspace",
        { headers: { Cookie: "__Host-ingenium_session=fixture", "Last-Event-ID": "evt_42" } },
      ),
      { params: Promise.resolve({ id: "ses_live" }) },
    );
    const reader = response.body?.getReader();
    expect(reader).toBeDefined();

    // This is the shape emitted by deployed OpenCode 1.18.9: `properties`
    // carries sessionID, and semantic part type arrives before text deltas.
    // Intentionally leave the stream open after session.idle: real /event
    // connections are persistent rather than response-per-turn streams.
    controller.enqueue(
      encoder.encode(
        `data: ${JSON.stringify({
          id: "evt_43",
          type: "message.part.updated",
          properties: {
            sessionID: "ses_live",
            part: {
              id: "part_reasoning",
              sessionID: "ses_live",
              messageID: "msg_live",
              type: "reasoning",
            },
          },
        })}\n\n` +
          `data: ${JSON.stringify({
            id: "evt_44",
            type: "message.part.delta",
            properties: {
              sessionID: "ses_live",
              messageID: "msg_live",
              partID: "part_reasoning",
              field: "text",
              delta: "provider emitted reasoning",
            },
          })}\n\n` +
          `data: ${JSON.stringify({
            id: "evt_45",
            type: "session.idle",
            properties: { sessionID: "ses_live" },
          })}\n\n`,
      ),
    );

    const firstChunk = await reader!.read();
    expect(firstChunk.done).toBe(false);
    const body = new TextDecoder().decode(firstChunk.value);
    expect(body).toContain('"type":"message.part.updated"');
    expect(body).toContain('"type":"message.part.delta"');
    expect(body).toContain('"type":"session.idle"');
    expect(response.headers.get("content-type")).toContain("text/event-stream");
    expect(response.headers.get("cache-control")).toBe("no-cache, no-transform");
    expect(response.headers.get("x-accel-buffering")).toBe("no");

    expect(fetchMock).toHaveBeenCalledOnce();
    const [, init] = fetchMock.mock.calls[0] as [string, RequestInit];
    expect(String(fetchMock.mock.calls[0]?.[0])).toBe(
      "http://127.0.0.1:4097/api/v1/opencode/sessions/ses_live/events?directory=%2Fworkspace",
    );
    expect(init.cache).toBe("no-store");
    const upstreamHeaders = init.headers as Headers;
    expect(upstreamHeaders.get("cookie")).toBe("__Host-ingenium_session=fixture");
    expect(upstreamHeaders.get("authorization")).toBeNull();
    expect(upstreamHeaders.get("last-event-id")).toBe("evt_42");

    controller.close();
    await reader!.cancel();
  });

  it("does not make an upstream request without a browser session", async () => {
    const fetchMock = vi.fn();
    vi.stubGlobal("fetch", fetchMock);

    const response = await GET(
      new Request("http://dashboard.test/api/v1/opencode/sessions/ses_live/events"),
      { params: Promise.resolve({ id: "ses_live" }) },
    );

    expect(response.status).toBe(401);
    expect(fetchMock).not.toHaveBeenCalled();
  });
});
