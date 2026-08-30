import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

const navigation = vi.hoisted(() => ({ searchParams: new URLSearchParams("page=opencode") }));

vi.mock("next/navigation", () => ({
  useSearchParams: () => navigation.searchParams,
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("../src/lib/RuntimeContext", () => ({
  useRuntime: () => ({ workspace: {
    mode: null,
    status: "loading",
    workspaces: [],
    selectedWorkspaceId: null,
    confirmedWorkspaceId: null,
    confirmedRuntimeId: null,
    error: null,
    selectWorkspace: vi.fn(),
    start: vi.fn(),
    retry: vi.fn(),
  } }),
}));

import StandalonePage from "@/app/standalone/page";

beforeEach(() => {
  navigation.searchParams = new URLSearchParams("page=opencode");
});

afterEach(() => {
  vi.restoreAllMocks();
});

describe("standalone OpenCode hydration boundary", () => {
  it("renders the same non-iframe startup surface during SSR", () => {
    const html = renderToStaticMarkup(React.createElement(StandalonePage));

    expect(html).toContain("Loading authorized workspaces");
    expect(html).toContain("OpenCode");
    expect(html).not.toContain("<iframe");
    expect(html).not.toContain("/opencode-web/");
    expect(html).not.toContain("/opencode-cli/");
  });

  it("renders CLI pressed for a safe standalone mode query", () => {
    navigation.searchParams = new URLSearchParams("page=opencode&mode=cli");

    const html = renderToStaticMarkup(React.createElement(StandalonePage));

    expect(html).toMatch(/aria-label="CLI mode" aria-pressed="true"/);
    expect(html).toMatch(/aria-label="Web mode" aria-pressed="false"/);
  });

  it("does not preserve an invalid standalone mode value in navigation state", () => {
    navigation.searchParams = new URLSearchParams("page=opencode&mode=%25");

    const html = renderToStaticMarkup(React.createElement(StandalonePage));

    expect(html).toMatch(/aria-label="Web mode" aria-pressed="true"/);
    expect(html).not.toContain("mode=%25");
  });
});
