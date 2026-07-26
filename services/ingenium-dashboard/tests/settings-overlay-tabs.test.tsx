import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen } from "@testing-library/react";
import React from "react";

const navigationMock = vi.hoisted(() => ({
  searchParams: new URLSearchParams(),
  replace: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  usePathname: () => "/status",
  useRouter: () => ({ replace: navigationMock.replace }),
  useSearchParams: () => navigationMock.searchParams,
}));

vi.mock("../src/app/components/settings/panels", () => ({
  GeneralPanel: () => <div>General panel</div>,
  MailPanel: () => <div>Mail panel</div>,
  PipelinePanel: () => <div>Providers panel</div>,
  ConfigPanel: () => <div>Config panel</div>,
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
  });

  afterEach(() => {
    cleanup();
    document.body.innerHTML = "";
    document.body.style.overflow = "";
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
});
