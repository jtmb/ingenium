import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

vi.mock("next/navigation", () => ({
  useSearchParams: () => new URLSearchParams("page=opencode"),
  useRouter: () => ({ push: vi.fn() }),
}));

import StandalonePage from "@/app/standalone/page";

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
});
