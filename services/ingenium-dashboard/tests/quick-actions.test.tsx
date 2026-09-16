import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";

const { dashboardFetch } = vi.hoisted(() => ({ dashboardFetch: vi.fn() }));

vi.mock("../src/lib/api", () => ({
  dashboardFetch,
  getApiBase: () => "/api/v1",
}));

vi.mock("next/link", () => ({
  default: ({ children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));

import QuickActions from "../src/app/components/QuickActions";

beforeEach(() => dashboardFetch.mockReset());
afterEach(cleanup);

describe("QuickActions synthesis", () => {
  it("uses the selected project in the encoded query and no request body", async () => {
    dashboardFetch.mockResolvedValue({ ok: true });
    render(<QuickActions project="team / project" />);

    fireEvent.click(screen.getByRole("button", { name: "Run Synthesis" }));

    await waitFor(() => expect(dashboardFetch).toHaveBeenCalledWith(
      "/api/v1/synthesis/run?project=team%20%2F%20project",
      { method: "POST" },
    ));
    expect((await screen.findByRole("status")).textContent).toContain("Synthesis completed");
  });

  it("does not report success for a non-OK response", async () => {
    dashboardFetch.mockResolvedValue({ ok: false });
    render(<QuickActions project="active-project" />);

    fireEvent.click(screen.getByRole("button", { name: "Run Synthesis" }));

    expect((await screen.findByRole("status")).textContent).toContain("Synthesis failed");
    expect(screen.queryByText("Synthesis completed")).toBeNull();
  });
});
