import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

const mocks = vi.hoisted(() => ({
  listSpaces: vi.fn(),
  replace: vi.fn(),
  push: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ replace: mocks.replace, push: mocks.push }),
  useSearchParams: () => new URLSearchParams(),
}));

vi.mock("../src/lib/api", () => ({
  dashboardFetch: vi.fn(),
  getApiBase: () => "/api/v1",
  api: {
    docs: {
      spaces: { list: mocks.listSpaces },
      pages: {
        get: vi.fn(),
      },
    },
  },
}));

vi.mock("../src/app/docs/components/DocsShell", () => ({
  default: ({ main }: { main: React.ReactNode }) => <>{main}</>,
}));

import DocsPage from "../src/app/docs/page";

describe("DocsPage empty workspace heading", () => {
  beforeEach(() => {
    mocks.listSpaces.mockReset().mockResolvedValue({ data: [] });
    mocks.replace.mockReset();
    mocks.push.mockReset();
  });

  afterEach(cleanup);

  it("uses one page-level h1 for the empty workspace state", async () => {
    render(<DocsPage />);

    expect(await screen.findByRole("heading", { level: 1, name: "Welcome to Docs" })).toBeTruthy();
    expect(screen.getAllByRole("heading", { level: 1 })).toHaveLength(1);
    expect(screen.queryByRole("heading", { level: 2 })).toBeNull();
  });
});
