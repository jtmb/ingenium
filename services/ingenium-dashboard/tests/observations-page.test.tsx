import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const { list, stats } = vi.hoisted(() => ({ list: vi.fn(), stats: vi.fn() }));

vi.mock("next/navigation", () => ({ useRouter: () => ({ push: vi.fn() }) }));
vi.mock("../src/lib/ProjectContext", () => ({ useProject: () => "active-project" }));
vi.mock("../src/lib/api", () => ({ api: { observations: { list, stats } } }));

import ObservationsPage from "../src/app/observations/page";

beforeEach(() => {
  list.mockReset();
  stats.mockReset();
});

afterEach(cleanup);

describe("ObservationsPage independent collection states", () => {
  it("keeps observations usable when stats fail to load", async () => {
    list.mockResolvedValue({
      data: [{
        id: 5,
        observation_type: "preference",
        status: "pending",
        content: "Prefer focused tests",
        importance: 8,
        source: "agent",
        created_at: "2026-08-09T00:00:00.000Z",
      }],
    });
    stats.mockRejectedValue(new Error("Stats service unavailable"));

    render(<ObservationsPage />);

    const observation = await screen.findByRole("button", { name: "View observation 5" });
    expect((await screen.findByRole("alert")).textContent).toContain("Stats unavailable: Stats service unavailable");

    fireEvent.click(observation);
    expect(screen.getByRole("dialog", { name: "Observation #5" })).not.toBeNull();
  });

  it("shows the empty state only after a successful observation response", async () => {
    list.mockResolvedValue({ data: [] });
    stats.mockResolvedValue({ data: { total: 0, pending: 0 } });

    render(<ObservationsPage />);

    expect(await screen.findByText("No observations yet. The agent will record observations automatically during interactions.")).not.toBeNull();
    expect(screen.getByText("Total:").textContent).toContain("0");
  });
});
