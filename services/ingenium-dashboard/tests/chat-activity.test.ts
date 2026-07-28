import { describe, expect, it } from "vitest";
import { buildActivityTimeline } from "../src/app/chat/components/chat-activity";
import type { OpenCodePart } from "../src/lib/opencode";

function part(partial: Record<string, unknown>): OpenCodePart {
  return {
    id: String(partial.id),
    sessionID: "session-1",
    messageID: "assistant-1",
    type: partial.type as OpenCodePart["type"],
    ...partial,
  } as OpenCodePart;
}

describe("buildActivityTimeline", () => {
  it("keeps provider part order and exposes only actual activity data", () => {
    const timeline = buildActivityTimeline({
      role: "assistant",
      parts: [
        part({ id: "reasoning-1", type: "reasoning", text: "Provider reasoning" }),
        part({
          id: "search-1",
          type: "tool",
          tool: "websearch",
          state: {
            status: "completed",
            input: { query: "transparent chat streaming" },
            output: {
              results: [{ url: "https://results.example.test/chat-streaming" }],
              visited: [{ url: "https://visited.example.test/stream-lifecycle" }],
              title: "Do not render this title",
            },
          },
        }),
        part({ id: "text-1", type: "text", text: "Provider answer" }),
      ],
    });

    expect(timeline.map((event) => event.id)).toEqual([
      "reasoning-1",
      "search-1",
      "text-1",
    ]);
    expect(timeline[0]).toMatchObject({ kind: "reasoning", text: "Provider reasoning" });
    expect(timeline[1]).toMatchObject({
      kind: "tool",
      query: "transparent chat streaming",
      state: { status: "completed" },
      sites: [
        { label: "Results", url: "https://results.example.test/chat-streaming" },
        { label: "Visited", url: "https://visited.example.test/stream-lifecycle" },
      ],
    });
    expect(JSON.stringify(timeline)).not.toContain("Do not render this title");
  });

  it("does not invent reasoning, sites, or timestamps", () => {
    const timeline = buildActivityTimeline({
      role: "assistant",
      parts: [
        part({
          id: "search-1",
          type: "tool",
          tool: "web_search",
          state: {
            status: "running",
            input: { query: "https://query-only.example.test/not-a-site" },
            output: { query: "https://query-only.example.test/not-a-site" },
          },
        }),
      ],
    });

    expect(timeline).toHaveLength(1);
    expect(timeline[0]).toMatchObject({ kind: "tool", state: { status: "running" }, sites: [] });
    expect(timeline[0]).toHaveProperty("query", "https://query-only.example.test/not-a-site");
    expect(timeline[0]).not.toHaveProperty("time");
  });

  it("passes the search query through while preserving ordered text URLs", () => {
    const timeline = buildActivityTimeline({
      role: "assistant",
      parts: [
        part({
          id: "search-1",
          type: "tool",
          tool: "web_search",
          state: {
            status: "completed",
            input: { query: "https://query.example.test/echo" },
            output:
              "[First](https://first.example.test/result) "
              + "<https://second.example.test/result> "
              + "https://query.example.test/echo",
          },
        }),
      ],
    });

    expect(timeline[0]).toMatchObject({
      kind: "tool",
      sites: [
        { label: "Sites", url: "https://first.example.test/result" },
        { label: "Sites", url: "https://second.example.test/result" },
      ],
    });
  });

  it("ignores messages that are not assistant messages", () => {
    expect(buildActivityTimeline({ role: "user", parts: [] })).toEqual([]);
    expect(buildActivityTimeline(undefined)).toEqual([]);
  });
});
