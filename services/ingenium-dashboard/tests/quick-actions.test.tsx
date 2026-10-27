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
    expect((await screen.findByRole("status")).textContent).toContain("Synthesis started. Check Pipeline for results.");
    expect(screen.queryByText("Synthesis completed")).toBeNull();
  });

  it("does not report success for a non-OK response", async () => {
    dashboardFetch.mockResolvedValue({ ok: false });
    render(<QuickActions project="active-project" />);

    fireEvent.click(screen.getByRole("button", { name: "Run Synthesis" }));

    expect((await screen.findByRole("status")).textContent).toContain("Synthesis failed");
    expect(screen.queryByText("Synthesis completed")).toBeNull();
  });

  it("sends an explicitly chosen connected model once, without changing defaults", async () => {
    dashboardFetch.mockResolvedValueOnce({ ok: true, json: async () => ({ data: { providers: [{
      providerId: "openai", label: "OpenAI", models: [{ id: "gpt-6-luna", label: "Luna" }],
    }] } }) }).mockResolvedValue({ ok: true });
    render(<QuickActions project="ingenium" />);
    fireEvent.click(screen.getByRole("button", { name: "Choose synthesis model" }));
    const option = await screen.findByRole("option", { name: "OpenAI: Luna" });
    fireEvent.change(screen.getByRole("combobox"), { target: { value: (option as HTMLOptionElement).value } });
    fireEvent.click(screen.getByRole("button", { name: "Run Synthesis" }));
    await screen.findByRole("status");
    expect(dashboardFetch).toHaveBeenNthCalledWith(2, "/api/v1/synthesis/run?project=ingenium", {
      method: "POST", headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ model: { providerId: "openai", modelId: "gpt-6-luna" } }),
    });
    expect(screen.queryByRole("combobox")).toBeNull();
    fireEvent.click(screen.getByRole("button", { name: "Run Synthesis" }));
    await waitFor(() => expect(dashboardFetch).toHaveBeenNthCalledWith(3, "/api/v1/synthesis/run?project=ingenium", { method: "POST" }));
    expect(dashboardFetch.mock.calls.every(([url]) => !String(url).includes("settings") && !String(url).includes("chat-selection"))).toBe(true);
  });

  it("discards an old project's catalog response and its one-run choice after switching projects", async () => {
    let resolveCatalog!: (value: unknown) => void;
    dashboardFetch.mockReturnValue(new Promise((resolve) => { resolveCatalog = resolve; }));
    const { rerender } = render(<QuickActions project="first-project" />);
    fireEvent.click(screen.getByRole("button", { name: "Choose synthesis model" }));
    rerender(<QuickActions project="second-project" />);
    resolveCatalog({ ok: true, json: async () => ({ data: { providers: [{
      providerId: "openai", label: "Old project model", models: [{ id: "gpt-6-luna", label: "Luna" }],
    }] } }) });
    await waitFor(() => expect(screen.queryByRole("combobox")).toBeNull());
    expect(screen.queryByText("Old project model: Luna")).toBeNull();
    dashboardFetch.mockResolvedValue({ ok: true });
    fireEvent.click(screen.getByRole("button", { name: "Run Synthesis" }));
    await waitFor(() => expect(dashboardFetch).toHaveBeenLastCalledWith("/api/v1/synthesis/run?project=second-project", { method: "POST" }));
  });
});
