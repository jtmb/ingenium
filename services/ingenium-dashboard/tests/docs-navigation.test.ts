import { describe, expect, it } from "vitest";
import {
  buildDocsUrl,
  buildDocsWorkspacePopoutState,
  buildStandaloneDocsHandoffUrl,
} from "../src/app/docs/docs-navigation";

describe("Docs URL navigation", () => {
  it("preserves project and other Docs query state while changing space/page", () => {
    const url = buildDocsUrl(
      new URLSearchParams("project=external-worktree&space=1&page=2&view=split"),
      5,
      9,
    );

    expect(url).toBe("/docs?project=external-worktree&space=5&page=9&view=split");
  });

  it("removes only the cleared Docs location parameter", () => {
    const url = buildDocsUrl(new URLSearchParams("project=external-worktree&space=5&page=9"), 5, null);
    expect(url).toBe("/docs?project=external-worktree&space=5");
  });

  it("preserves the selected page and project when only the Docs space changes", () => {
    const url = buildDocsUrl(
      new URLSearchParams("project=external-worktree&space=5&page=9&settings=providers"),
      7,
      9,
    );

    expect(url).toBe("/docs?project=external-worktree&space=7&page=9&settings=providers");
  });

  it("encodes the Docs page without colliding with standalone's page selector", () => {
    expect(buildDocsWorkspacePopoutState(
      new URLSearchParams("project=external-worktree&space=5&page=9&view=split"),
    )).toEqual({
      project: "external-worktree",
      space: "5",
      docsPage: "9",
      view: "split",
    });
  });

  it("hands standalone Docs back with project, selected space, page, and other state", () => {
    const url = buildStandaloneDocsHandoffUrl(
      new URLSearchParams("page=docs&standalone=1&project=external-worktree&space=5&docsPage=9&view=split"),
      7,
    );
    const destination = new URL(url, "http://localhost");

    expect(destination.pathname).toBe("/docs");
    expect(destination.searchParams.get("project")).toBe("external-worktree");
    expect(destination.searchParams.get("space")).toBe("7");
    expect(destination.searchParams.get("page")).toBe("9");
    expect(destination.searchParams.get("view")).toBe("split");
    expect(destination.searchParams.has("standalone")).toBe(false);
    expect(destination.searchParams.has("docsPage")).toBe(false);
  });
});
