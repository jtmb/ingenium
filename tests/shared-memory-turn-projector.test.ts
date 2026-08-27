import { describe, expect, it } from "vitest";
import { projectOpenCodeTurn } from "./shared-memory-turn-projector.js";

describe("shared-memory acceptance turn projector", () => {
  it("aggregates ordered tool parts across assistant messages and excludes private parts", () => {
    const projected = projectOpenCodeTurn([
      { info: { id: "user", role: "user" }, parts: [{ type: "text", text: "private prompt" }] },
      { info: { id: "assistant-1", role: "assistant", finish: "tool-calls" }, parts: [
        { id: "reasoning-1", type: "reasoning", text: "private reasoning" },
        { id: "tool-1", type: "tool", tool: "todowrite", callID: "call-1", state: { status: "completed", input: { secret: "one" }, output: "private output" } },
        { id: "tool-2", type: "tool", tool: "write", callID: "call-2", state: { status: "completed" } },
      ] },
      { info: { id: "assistant-2", role: "assistant", finish: "tool-calls" }, parts: [
        { id: "tool-3", type: "tool", tool: "read", callID: "call-3", state: { status: "completed" } },
        { id: "tool-4", type: "tool", tool: "bash", callID: "call-4", state: { status: "completed" } },
      ] },
      { info: { id: "assistant-3", role: "assistant", finish: "tool-calls" }, parts: [
        { id: "tool-5", type: "tool", tool: "todowrite", callID: "call-5", state: { status: "running" } },
      ] },
      { info: { id: "assistant-3", role: "assistant", finish: "tool-calls" }, parts: [
        { id: "tool-5", type: "tool", tool: "todowrite", callID: "call-5", state: { status: "completed" } },
      ] },
      { info: { id: "assistant-final", role: "assistant", finish: "stop" }, parts: [
        { type: "reasoning", text: "final private reasoning" },
        { type: "text", text: "STATUS=idle NEXT_WORK=none" },
      ] },
    ] as any);

    expect(projected).toEqual({
      info: { id: "assistant-final", role: "assistant", finish: "stop" },
      parts: [{ type: "text", text: "STATUS=idle NEXT_WORK=none" }],
      text: "STATUS=idle NEXT_WORK=none",
      tools: [
        { partId: "tool-1", callId: "call-1", tool: "todowrite", status: "completed" },
        { partId: "tool-2", callId: "call-2", tool: "write", status: "completed" },
        { partId: "tool-3", callId: "call-3", tool: "read", status: "completed" },
        { partId: "tool-4", callId: "call-4", tool: "bash", status: "completed" },
        { partId: "tool-5", callId: "call-5", tool: "todowrite", status: "completed" },
      ],
    });
    expect(JSON.stringify(projected)).not.toMatch(/private|secret|reasoning|output/i);
  });
});
