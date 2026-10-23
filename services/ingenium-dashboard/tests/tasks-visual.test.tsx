import { afterEach, expect, it, vi } from "vitest";
import { act, cleanup, isInaccessible, render, screen, within } from "@testing-library/react";
import BoardView from "../src/app/tasks/components/BoardView";
import TaskDetail from "../src/app/tasks/components/TaskDetail";

vi.mock("../src/lib/api", () => ({
  api: {
    agents: { list: vi.fn().mockResolvedValue({ data: [] }) },
    tasks: {
      boardConfig: vi.fn().mockResolvedValue({ data: null }),
      activity: vi.fn().mockResolvedValue({ data: [] }),
      comments: vi.fn().mockResolvedValue({ data: [] }),
      links: vi.fn().mockResolvedValue({ data: [] }),
      list: vi.fn().mockResolvedValue({ data: [] }),
      references: { list: vi.fn().mockResolvedValue({ data: [] }) },
    },
  },
}));

const task = {
  id: "time-tracking-task",
  title: "Review release estimates",
  column_id: "todo",
  created_at: "2026-09-11T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

it.each([
  { estimated: 0, spent: 0, fraction: 0, tone: "success" },
  { estimated: 0, spent: 2, fraction: 0, tone: "success" },
  { estimated: 4, spent: undefined, fraction: 0, tone: "success" },
  { estimated: 4, spent: 2, fraction: 0.5, tone: "success" },
  { estimated: 4, spent: 3, fraction: 0.75, tone: "success" },
  { estimated: 4, spent: 3.5, fraction: 0.875, tone: "warning" },
  { estimated: 4, spent: 4, fraction: 1, tone: "error" },
  { estimated: 4, spent: 6, fraction: 1, tone: "error" },
])("board chart: $spent/$estimated hours retains geometry, theme tokens and an accessible equivalent", async ({ estimated, spent, fraction, tone }) => {
  await act(async () => {
    render(<BoardView project="test-project" tasks={[{ ...task, estimated_hours: estimated, spent_hours: spent }]} onTasksChange={vi.fn()} />);
  });

  const chart = screen.getByRole("img", { name: `${spent ?? 0} hours spent, ${estimated} hours estimated` });
  expect(chart).toHaveAttribute("focusable", "false");
  const circles = chart.querySelectorAll("circle");
  expect(circles).toHaveLength(2);
  expect(circles[0]).toHaveAttribute("stroke", "var(--color-border)");
  expect(circles[1]).toHaveAttribute("stroke", `var(--color-${tone}-text)`);
  const circumference = 2 * Math.PI * 18;
  expect(Number(circles[1]!.getAttribute("stroke-dasharray"))).toBeCloseTo(circumference);
  expect(Number(circles[1]!.getAttribute("stroke-dashoffset"))).toBeCloseTo(circumference * (1 - fraction));
  expect(chart.querySelector("text")).toHaveTextContent(String(Math.round(fraction * 100)));
  expect(chart.querySelector("text")).toHaveAttribute("fill", "var(--color-text-secondary)");
});

it.each([
  { spent: 0, remaining: 0, estimate: 0, fraction: null, tone: "warning" },
  { spent: 0, remaining: 60, estimate: 60, fraction: 0, tone: "success" },
  { spent: 30, remaining: 90, estimate: 60, fraction: 0.25, tone: "success" },
  { spent: 60, remaining: 0, estimate: 60, fraction: 1, tone: "warning" },
  { spent: 90, remaining: 30, estimate: 60, fraction: 0.75, tone: "error" },
  { spent: 90, remaining: 0, estimate: 60, fraction: 1, tone: "error" },
  { spent: 30, remaining: 0, estimate: 0, fraction: 1, tone: "warning" },
])("detail chart: $spent spent, $remaining remaining, $estimate estimated minutes retains geometry and decorative SVG", async ({ spent, remaining, estimate, fraction, tone }) => {
  await act(async () => {
    render(<TaskDetail task={{ ...task, spent_minutes: spent, remaining_minutes: remaining, estimate_minutes: estimate }}
      project="test-project" onClose={vi.fn()} onTaskUpdated={vi.fn()} />);
  });

  const timeTracking = screen.getByRole("heading", { name: "Time Tracking (minutes)" }).parentElement!;
  const chart = timeTracking.querySelector("svg")!;
  expect(chart).toHaveAttribute("aria-hidden", "true");
  expect(chart).toHaveAttribute("focusable", "false");
  expect(within(timeTracking).queryByRole("img")).toBeNull();
  const circles = chart.querySelectorAll("circle");
  expect(circles[0]).toHaveAttribute("stroke", "var(--color-border)");
  expect(chart.querySelector("text")).toHaveAttribute("fill", "var(--color-text-secondary)");
  if (fraction === null) {
    expect(circles).toHaveLength(1);
    expect(chart.querySelector("text")).toHaveTextContent("--");
  } else {
    expect(circles).toHaveLength(2);
    expect(circles[1]).toHaveAttribute("stroke", `var(--color-${tone}-text)`);
    const circumference = 2 * Math.PI * 36;
    expect(Number(circles[1]!.getAttribute("stroke-dasharray"))).toBeCloseTo(circumference);
    expect(Number(circles[1]!.getAttribute("stroke-dashoffset"))).toBeCloseTo(circumference * (1 - fraction));
    expect(chart.querySelector("text")).toHaveTextContent(String(Math.round(fraction * 100)));
  }

  const spentText = screen.getByText(`Spent: ${spent}m`);
  expect(spentText).toBeVisible();
  expect(isInaccessible(spentText)).toBe(false);
  expect(spentText.parentElement).toHaveClass("text-[var(--color-text-secondary)]");
  expect(screen.getByText(`Remaining: ${remaining}m`)).toBeVisible();
  if (estimate > 0) {
    const estimateText = screen.getByText(`Est: ${estimate}m`);
    expect(estimateText).toBeVisible();
    expect(isInaccessible(estimateText)).toBe(false);
    if (tone === "error") expect(estimateText).toHaveClass("text-[var(--color-error-text)]", "font-semibold");
  } else {
    expect(screen.queryByText(`Est: ${estimate}m`)).toBeNull();
  }
});
