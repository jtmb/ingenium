import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import type { AnchorHTMLAttributes } from "react";
import Home from "../src/app/page";
import HealthStrip from "../src/app/components/HealthStrip";
import { api, type DashboardSummary, type HealthData } from "../src/lib/api";

vi.mock("../src/lib/ProjectContext", () => ({ useProject: () => "ingenium" }));
vi.mock("next/link", () => ({
  default: ({ children, ...props }: AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props}>{children}</a>,
}));

const healthyHealth: HealthData = {
  api: { status: "ok", uptime: 1 },
  dashboard: { status: "ok" },
  opencode: { status: "ok" },
  docker: { status: "healthy" },
  services: [
    { name: "Gateway", status: "running" },
    { name: "Email Client", status: "healthy", required: true },
  ],
};

const summary: DashboardSummary = {
  learning: null,
  tasks: null,
  jobs: null,
  mail: null,
  attention: { items: [], count: 0 },
  resume: null,
  activity: [],
  health: healthyHealth,
  generatedAt: "2026-09-11T00:00:00.000Z",
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("HealthStrip accessible service statuses", () => {
  it("exposes healthy service text and makes every redundant dot decorative", () => {
    const { container } = render(<HealthStrip data={healthyHealth} />);

    expect(screen.getByText("All systems operational")).toBeVisible();
    for (const name of ["API", "Dashboard", "OpenCode"]) {
      expect(within(screen.getByText(name).parentElement!).getByText("OK")).toBeVisible();
    }
    for (const label of ["Gateway: running", "Email Client: healthy"]) {
      const status = screen.getByText(label);
      expect(status).toBeVisible();
      expect(status.closest('[aria-hidden="true"]')).toBeNull();
    }
    const dots = container.querySelectorAll(".rounded-full");
    expect(dots).toHaveLength(6);
    for (const dot of dots) expect(dot).toHaveAttribute("aria-hidden", "true");
  });

  it.each(["degraded", "stopped", "starting", "error", "unknown"])(
    "preserves a required service's %s status instead of relying on color",
    (status) => {
      render(<HealthStrip data={{ ...healthyHealth, services: [{ name: "Gateway", status }] }} />);

      expect(screen.getByText(`Gateway: ${status}`)).toBeVisible();
      expect(screen.getByText("1 service degraded")).toBeVisible();
      expect(screen.queryByText("All systems operational")).toBeNull();
    },
  );

  it.each(["idle", "disabled", "stopped", "degraded"])(
    "labels an optional service as %s without converting it to healthy or degrading the aggregate",
    (status) => {
      render(<HealthStrip data={{
        ...healthyHealth,
        services: [{ name: "Email Client", status, required: false }],
      }} />);

      expect(screen.getByText(`Email Client: ${status} (optional)`)).toBeVisible();
      expect(screen.getByText("All systems operational")).toBeVisible();
      expect(screen.queryByText("1 service degraded")).toBeNull();
    },
  );

  it("counts only the required failure when optional services are stopped", () => {
    render(<HealthStrip data={{
      ...healthyHealth,
      services: [
        { name: "Gateway", status: "stopped", required: true },
        { name: "Restore Maintenance", status: "stopped", required: false },
      ],
    }} />);

    expect(screen.getByText("Gateway: stopped")).toBeVisible();
    expect(screen.getByText("Restore Maintenance: stopped (optional)")).toBeVisible();
    expect(screen.getByText("1 service degraded")).toBeVisible();
  });

  it("reports missing status text as unknown rather than implying health", () => {
    render(<HealthStrip data={{ ...healthyHealth, services: [{ name: "Gateway", status: "" }] }} />);

    expect(screen.getByText("Gateway: unknown")).toBeVisible();
    expect(screen.getByText("1 service degraded")).toBeVisible();
  });
});

describe("Home initial announcements", () => {
  it("announces only a concise polite loading status, then removes it when content arrives", async () => {
    let resolveSummary!: (response: Awaited<ReturnType<typeof api.home.summary>>) => void;
    vi.spyOn(api.home, "summary").mockReturnValue(new Promise((resolve) => { resolveSummary = resolve; }));

    render(<Home />);

    const status = screen.getByRole("status");
    expect(status.textContent).toBe("Loading dashboard…");
    expect(status).toHaveAttribute("aria-live", "polite");
    expect(status.closest('[aria-hidden="true"], [aria-busy="true"]')).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
    const skeletons = screen.getAllByTestId("dashboard-skeleton-card");
    expect(skeletons).toHaveLength(4);
    for (const skeleton of skeletons) expect(skeleton.closest('[aria-hidden="true"]')).not.toBeNull();

    await act(async () => resolveSummary({ data: summary, unavailable: [] }));

    expect(screen.getByText("All systems operational")).toBeVisible();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByTestId("dashboard-skeleton-card")).toBeNull();
  });

  it("announces an initial failure as an alert and restores loading semantics during retry", async () => {
    let resolveRetry!: (response: Awaited<ReturnType<typeof api.home.summary>>) => void;
    const fetchSummary = vi.spyOn(api.home, "summary")
      .mockRejectedValueOnce(new Error("Dashboard endpoint unavailable"))
      .mockReturnValueOnce(new Promise((resolve) => { resolveRetry = resolve; }));

    render(<Home />);

    const alert = await screen.findByRole("alert");
    expect(within(alert).getByRole("heading", { name: "Unable to load dashboard" })).toBeVisible();
    expect(within(alert).getByText("Dashboard endpoint unavailable")).toBeVisible();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByTestId("dashboard-skeleton-card")).toBeNull();

    fireEvent.click(within(alert).getByRole("button", { name: "Retry" }));

    expect(screen.getByRole("status").textContent).toBe("Loading dashboard…");
    expect(screen.queryByRole("alert")).toBeNull();
    expect(fetchSummary).toHaveBeenCalledTimes(2);
    expect(fetchSummary).toHaveBeenNthCalledWith(2, "ingenium");

    await act(async () => resolveRetry({ data: summary, unavailable: [] }));

    expect(screen.getByText("All systems operational")).toBeVisible();
    expect(screen.queryByRole("status")).toBeNull();
    expect(screen.queryByRole("alert")).toBeNull();
  });
});
