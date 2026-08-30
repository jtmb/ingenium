import { describe, expect, it } from "vitest";
import { buildContextUrl } from "../src/app/context/context-navigation";

describe("context workspace navigation", () => {
  it("keeps active-project and unrelated route state while selecting a conversation", () => {
    expect(buildContextUrl(
      new URLSearchParams("project=external-worktree&settings=providers"),
      "conversation-123",
    )).toBe("/context?project=external-worktree&settings=providers&conversation=conversation-123");
  });

  it("removes only the selected conversation when clearing context detail state", () => {
    expect(buildContextUrl(
      new URLSearchParams("project=external-worktree&conversation=conversation-123"),
      null,
    )).toBe("/context?project=external-worktree");
  });
});
