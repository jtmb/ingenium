import { describe, expect, it } from "vitest";
import { buildProjectNavigationHref } from "../src/lib/project-navigation";

describe("project navigation", () => {
  it("replaces the project while preserving destination query state and hash", () => {
    expect(buildProjectNavigationHref(
      "/docs",
      "external-worktree",
      "?project=global-default&space=5&page=9&view=split",
      "#editor",
    )).toBe("/docs?project=external-worktree&space=5&page=9&view=split#editor");
  });

  it("adds the selected project to routes without existing query state", () => {
    expect(buildProjectNavigationHref("/observations/42", "external-worktree"))
      .toBe("/observations/42?project=external-worktree");
  });
});
