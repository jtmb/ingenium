import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import type { PersonalityTrait } from "../src/lib/api";

const { listTraits, dismissTrait } = vi.hoisted(() => ({
  listTraits: vi.fn(),
  dismissTrait: vi.fn(),
}));

vi.mock("../src/lib/ProjectContext", () => ({
  useProject: () => "external-project",
}));

vi.mock("../src/lib/api", () => ({
  api: {
    personality: {
      list: listTraits,
      dismiss: dismissTrait,
    },
  },
}));

vi.mock("../src/app/components/Overlay", () => ({
  default: ({ isOpen, title, children }: { isOpen: boolean; title: string; children: React.ReactNode }) =>
    isOpen ? <div role="dialog" aria-label={title}>{children}</div> : null,
}));

const traits: PersonalityTrait[] = [
  {
    id: 1,
    project_id: "external-project",
    trait_type: "communication_style",
    trait_value: "concise",
    display_label: "Prefers concise responses",
    confidence: 0.75,
    source: "synthesis",
    is_active: true,
    created_at: "2026-07-28T10:00:00.000Z",
    updated_at: "2026-07-28T10:00:00.000Z",
  },
  {
    id: 2,
    project_id: "external-project",
    trait_type: "workflow_pattern",
    trait_value: "tests-first",
    display_label: "Tests work before implementation is complete",
    confidence: 0.15,
    source: "synthesis",
    is_active: true,
    created_at: "2026-07-28T11:00:00.000Z",
    updated_at: "2026-07-28T11:00:00.000Z",
  },
  {
    id: 3,
    project_id: "external-project",
    trait_type: "terminology",
    trait_value: "exact-status",
    display_label: "Uses exact status labels",
    confidence: 0.29,
    source: "synthesis",
    is_active: true,
    created_at: "2026-07-28T09:00:00.000Z",
    updated_at: "2026-07-28T09:00:00.000Z",
  },
  {
    id: 4,
    project_id: "external-project",
    trait_type: "priority_signal",
    trait_value: "dismissed",
    display_label: "Dismissed trait",
    confidence: 0.2,
    source: "synthesis",
    is_active: false,
    created_at: "2026-07-28T08:00:00.000Z",
    updated_at: "2026-07-28T08:00:00.000Z",
  },
];

beforeEach(() => {
  listTraits.mockReset().mockResolvedValue({ data: traits, total: traits.length });
  dismissTrait.mockReset().mockResolvedValue({ data: { id: 2 } });
});

afterEach(() => {
  cleanup();
});

describe("PersonalityPage", () => {
  it("shows established and active emerging traits with confidence counts by default", async () => {
    const { default: PersonalityPage } = await import("../src/app/personality/page");
    render(<PersonalityPage />);

    expect(await screen.findByRole("heading", { name: "Emerging traits — awaiting confirmation" })).toBeTruthy();
    expect(screen.getByTestId("emerging-trait-2")).toBeTruthy();
    expect(screen.getByTestId("emerging-trait-3")).toBeTruthy();
    expect(screen.getByText("Emerging · 15% confidence")).toBeTruthy();
    expect(screen.getByText("Emerging · 29% confidence")).toBeTruthy();
    expect(screen.queryByText("Dismissed trait")).toBeNull();

    const counts = screen.getByRole("status", { name: "Personality trait counts" });
    expect(counts.textContent).toContain("Established: 1");
    expect(counts.textContent).toContain("Emerging: 2");
  });

  it("keeps the emerging section visible when switching to newest mode", async () => {
    const { default: PersonalityPage } = await import("../src/app/personality/page");
    render(<PersonalityPage />);
    await screen.findByTestId("emerging-trait-2");

    fireEvent.change(screen.getByLabelText("Sort personality traits"), { target: { value: "newest" } });

    expect(screen.getByTestId("emerging-traits-section")).toBeTruthy();
    expect(screen.getByTestId("emerging-trait-2")).toBeTruthy();
    expect(screen.getByTestId("emerging-trait-3")).toBeTruthy();
  });

  it("removes a dismissed emerging card immediately and sends the external project", async () => {
    const { default: PersonalityPage } = await import("../src/app/personality/page");
    render(<PersonalityPage />);
    const emergingCard = await screen.findByTestId("emerging-trait-2");

    fireEvent.click(within(emergingCard).getByRole("button", { name: "Dismiss trait" }));

    expect(screen.queryByTestId("emerging-trait-2")).toBeNull();
    await waitFor(() => expect(dismissTrait).toHaveBeenCalledWith(2, "external-project"));
    expect(screen.getByRole("status", { name: "Personality trait counts" }).textContent).toContain("Emerging: 1");
  });

  it("renders an API error instead of silently showing an empty profile", async () => {
    listTraits.mockRejectedValueOnce(new Error("unavailable"));
    const { default: PersonalityPage } = await import("../src/app/personality/page");
    render(<PersonalityPage />);

    expect(await screen.findByText("Failed to load personality traits — API may be unreachable")).toBeTruthy();
  });
});
