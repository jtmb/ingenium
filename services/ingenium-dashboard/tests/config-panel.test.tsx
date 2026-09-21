import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import React from "react";

const navigation = vi.hoisted(() => ({
  push: vi.fn(),
  searchParams: new URLSearchParams("settings=config&project=external-worktree"),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: navigation.push }),
  useSearchParams: () => navigation.searchParams,
}));

import ConfigPanel from "../src/app/components/settings/panels/ConfigPanel";

afterEach(() => {
  cleanup();
  navigation.push.mockReset();
});

describe("ConfigPanel", () => {
  it("renders the navigation button immediately and preserves non-settings context", () => {
    render(<ConfigPanel />);

    fireEvent.click(screen.getByRole("button", { name: "Open Config Editor" }));

    expect(navigation.push).toHaveBeenCalledWith("/config?project=external-worktree");
  });
});
