import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const navigationMock = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  replace: vi.fn(),
}));

const panelMockState = vi.hoisted(() => ({ throwGeneral: false }));

vi.mock("next/navigation", () => ({
  usePathname: () => "/status",
  useRouter: () => ({ replace: navigationMock.replace }),
  useSearchParams: () => navigationMock.searchParams,
}));

vi.mock("../src/app/components/settings/panels/GeneralPanel", () => ({
  default: () => {
    if (panelMockState.throwGeneral) throw new Error("test panel failure");
    return <div>General panel</div>;
  },
}));
vi.mock("../src/app/components/settings/panels/MailPanel", () => ({
  default: () => <div>Mail panel</div>,
}));
vi.mock("../src/app/components/settings/panels/PipelinePanel", () => ({
  default: () => <div>Providers panel</div>,
}));
vi.mock("../src/app/components/settings/panels/ConfigPanel", () => ({
  default: () => <div>Config panel</div>,
}));

import SettingsOverlay from "../src/app/components/settings/SettingsOverlay";

const ROUTE_LINKS: Record<string, string> = {
  projects: "/projects",
  skills: "/skills",
  tasks: "/tasks",
  jobs: "/jobs",
  plugins: "/plugins",
  agents: "/agents",
  "mcp-servers": "/mcp-servers",
  observations: "/observations",
  personality: "/personality",
  logs: "/logs",
};

const SETTINGS_TABS = [
  ["general", "General"],
  ["projects", "Projects"],
  ["skills", "Skills"],
  ["tasks", "Tasks"],
  ["jobs", "Jobs"],
  ["plugins", "Plugins"],
  ["mail", "Mail"],
  ["agents", "Agents"],
  ["mcp-servers", "MCP"],
  ["config", "Config"],
  ["observations", "Observations"],
  ["personality", "Personality"],
  ["providers", "Providers"],
  ["logs", "Logs"],
] as const;

describe("SettingsOverlay deep links", () => {
  beforeEach(() => {
    navigationMock.searchParams = new URLSearchParams();
    navigationMock.replace.mockReset();
    panelMockState.throwGeneral = false;
    window.history.replaceState({}, "", "/status");
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
    document.body.style.overflow = "";
    window.history.replaceState({}, "", "/");
  });

  it.each(SETTINGS_TABS)("activates the %s panel for its documented deep link", async (id, label) => {
    navigationMock.searchParams = new URLSearchParams(`settings=${id}`);

    render(<SettingsOverlay />);

    const panel = await screen.findByTestId(`settings-panel-${id}`);
    expect(panel.closest("[hidden]")).toBeNull();
    expect(screen.getByRole("tab", { name: label }).getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByText(/No settings for|No settings available/i)).toBeNull();

    const destination = ROUTE_LINKS[id];
    if (destination) {
      expect(screen.getByTestId(`settings-route-panel-${id}`).closest("[hidden]")).toBeNull();
      expect(screen.getByTestId(`settings-route-link-${id}`).getAttribute("href")).toBe(destination);
    }
  });

  it("contains a panel render failure without taking down the overlay", async () => {
    panelMockState.throwGeneral = true;
    navigationMock.searchParams = new URLSearchParams("settings=general");

    render(<SettingsOverlay />);

    expect(await screen.findByTestId("settings-panel-error-general")).toBeTruthy();
    expect(screen.getByRole("alert").textContent).toContain("This settings panel couldn't load.");
    expect(screen.getByRole("button", { name: "Retry panel" })).toBeTruthy();
  });

  it("preserves project and hash context when closing the overlay", async () => {
    navigationMock.searchParams = new URLSearchParams("settings=mail&project=external-worktree");
    window.history.replaceState({}, "", "/status?settings=mail&project=external-worktree#oauth");

    render(<SettingsOverlay />);
    await screen.findByTestId("settings-panel-mail");
    fireEvent.click(screen.getByRole("button", { name: "Close settings" }));

    expect(navigationMock.replace).toHaveBeenCalledWith(
      "/status?project=external-worktree#oauth",
      { scroll: false },
    );
  });

  it("keeps the Mail panel in a shrinkable scroll region", async () => {
    navigationMock.searchParams = new URLSearchParams("settings=mail");

    render(<SettingsOverlay />);

    await screen.findByTestId("settings-panel-mail");
    const scrollRegion = screen.getByTestId("settings-panel-scroll");
    expect(scrollRegion.className).toContain("min-h-0");
    expect(scrollRegion.className).toContain("overflow-y-auto");
    expect(scrollRegion.className).toContain("overscroll-contain");
  });
});
