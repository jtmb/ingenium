import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";

const LONG_TOKEN = "responsive-route-regression-".repeat(24);
const ISO = "2026-07-28T12:00:00.000Z";

const mocks = vi.hoisted(() => ({
  personalityList: vi.fn(),
  personalityDismiss: vi.fn(),
  observationsList: vi.fn(),
  observationsStats: vi.fn(),
  logsList: vi.fn(),
  projectsList: vi.fn(),
  projectsArchived: vi.fn(),
  projectsDetail: vi.fn(),
  agentsList: vi.fn(),
  pluginsList: vi.fn(),
  backupsList: vi.fn(),
  backupScheduleGet: vi.fn(),
  backupScheduleSet: vi.fn(),
}));

vi.mock("next/navigation", () => ({
  useRouter: () => ({ push: vi.fn() }),
}));

vi.mock("../src/lib/ProjectContext", () => ({
  useProject: () => "responsive-fixture",
  persistProject: vi.fn(),
}));

vi.mock("../src/lib/project-navigation", () => ({
  buildProjectNavigationHref: (path: string) => path,
}));

vi.mock("../src/lib/api", () => ({
  api: {
    personality: {
      list: mocks.personalityList,
      dismiss: mocks.personalityDismiss,
    },
    observations: {
      list: mocks.observationsList,
      stats: mocks.observationsStats,
    },
    logs: { list: mocks.logsList },
    projects: {
      list: mocks.projectsList,
      listArchived: mocks.projectsArchived,
      detail: mocks.projectsDetail,
      create: vi.fn(),
      archive: vi.fn(),
      restore: vi.fn(),
      update: vi.fn(),
      purgeOne: vi.fn(),
    },
    agents: {
      list: mocks.agentsList,
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      enable: vi.fn(),
      disable: vi.fn(),
    },
    plugins: {
      list: mocks.pluginsList,
      create: vi.fn(),
      update: vi.fn(),
      delete: vi.fn(),
      enable: vi.fn(),
      disable: vi.fn(),
      getSource: vi.fn(),
    },
    backups: {
      list: mocks.backupsList,
      create: vi.fn(),
      delete: vi.fn(),
      download: vi.fn(() => "/api/v1/backups/backup/download"),
      schedule: {
        get: mocks.backupScheduleGet,
        set: mocks.backupScheduleSet,
      },
    },
  },
}));

vi.mock("../src/app/components/Overlay", () => ({
  default: ({ isOpen, title, children }: { isOpen: boolean; title: string; children: React.ReactNode }) =>
    isOpen ? <div role="dialog" aria-label={title}>{children}</div> : null,
}));

vi.mock("../src/app/components/MarkdownViewer", () => ({
  default: ({ content }: { content: string }) => <pre>{content}</pre>,
}));

import PersonalityPage from "../src/app/personality/page";
import ObservationsPage from "../src/app/observations/page";
import LogsPage from "../src/app/logs/page";
import ProjectsPage from "../src/app/projects/page";
import AgentsPage from "../src/app/agents/page";
import PluginsPage from "../src/app/plugins/page";
import BackupsPage from "../src/app/backups/page";

beforeEach(() => {
  mocks.personalityList.mockReset().mockResolvedValue({
    data: [{
      id: 1,
      project_id: "responsive-fixture",
      trait_type: "communication_style",
      trait_value: LONG_TOKEN,
      display_label: LONG_TOKEN,
      confidence: 0.8,
      source: "fixture",
      is_active: true,
      created_at: ISO,
      updated_at: ISO,
    }],
  });
  mocks.personalityDismiss.mockReset().mockResolvedValue({ data: { id: 1 } });
  mocks.observationsList.mockReset().mockResolvedValue({
    data: [{
      id: 1,
      project_id: "responsive-fixture",
      observation_type: "pattern",
      content: LONG_TOKEN,
      context: LONG_TOKEN,
      importance: 10,
      status: "pending",
      created_at: ISO,
      updated_at: ISO,
    }],
  });
  mocks.observationsStats.mockReset().mockResolvedValue({ data: { total: 1, pending: 1 } });
  mocks.logsList.mockReset().mockResolvedValue({
    data: {
      entries: [{ timestamp: ISO, source: "scheduler", level: "info", message: LONG_TOKEN, data: null }],
      sources: ["scheduler"],
      total: 1,
    },
  });
  mocks.projectsList.mockReset().mockResolvedValue({
    data: [{ id: "project-1", name: LONG_TOKEN, path: LONG_TOKEN, created_at: ISO, updated_at: ISO, is_global: false }],
  });
  mocks.projectsArchived.mockReset().mockResolvedValue({ data: [] });
  mocks.projectsDetail.mockReset().mockResolvedValue({
    data: {
      skills_count: 1,
      observation_stats: { total: 1, pending: 0, recent: [] },
      pipeline: [],
    },
  });
  mocks.agentsList.mockReset().mockResolvedValue({
    data: [{
      id: "agent-1",
      name: LONG_TOKEN,
      description: LONG_TOKEN,
      category: "execution",
      mode: "subagent",
      model: LONG_TOKEN,
      content: LONG_TOKEN,
      enabled: true,
      created_at: ISO,
      updated_at: ISO,
    }],
  });
  mocks.pluginsList.mockReset().mockResolvedValue({
    data: [{ id: "plugin-1", name: LONG_TOKEN, file_path: LONG_TOKEN, enabled: true, source_content: LONG_TOKEN }],
  });
  mocks.backupsList.mockReset().mockResolvedValue({
    data: [{ id: "backup-1", filename: `${LONG_TOKEN}.sqlite`, type: "manual", size: 1024, status: "completed", created_at: ISO }],
  });
  mocks.backupScheduleGet.mockReset().mockResolvedValue({
    data: {
      hourly: { enabled: true, retention: 24 },
      daily: { enabled: false, retention: 7 },
    },
  });
  mocks.backupScheduleSet.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("responsive dashboard routes", () => {
  it("keeps personality controls and long trait text within a mobile-first flex layout", async () => {
    render(<PersonalityPage />);

    const longTrait = await screen.findByText(LONG_TOKEN);
    expect(longTrait.className).toContain("break-words");
    expect(screen.getByRole("heading", { name: "Personality Profile" }).parentElement?.className).toContain("flex-col");
    expect(screen.getByRole("heading", { name: "Personality Profile" }).parentElement?.className).toContain("sm:flex-row");
  });

  it("stacks observation filters and keeps the mobile-only card action visible", async () => {
    render(<ObservationsPage />);

    const observation = await screen.findByRole("button", { name: "View observation 1" });
    const longObservation = within(observation).getByText(LONG_TOKEN, { selector: "span.block" });
    expect(longObservation.className).toContain("break-words");
    expect(screen.getByLabelText("Filter observations by status").className).toContain("w-full");
    expect(screen.getByLabelText("Filter observations by type").className).toContain("sm:w-auto");
    expect(screen.getByRole("button", { name: "Open" }).className).toContain("shrink-0");
  });

  it("contains the logs table in a focusable horizontal region", async () => {
    render(<LogsPage />);

    const region = await screen.findByRole("region", { name: "System logs table" });
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(region.className).toContain("min-w-0");
    expect(region.className).toContain("overflow-x-auto");
    expect(region.querySelector("table")?.className).toContain("min-w-[680px]");
  });

  it("wraps project actions and keeps the creation dialog viewport-contained", async () => {
    render(<ProjectsPage />);

    const projectName = await screen.findByText(LONG_TOKEN, { selector: "span" });
    expect(projectName.className).toContain("break-all");
    const create = screen.getByRole("button", { name: "+ New Project" });
    expect(create.className).toContain("w-full");
    fireEvent.click(create);
    const dialog = screen.getByRole("dialog", { name: "New Project" });
    expect(dialog.className).toContain("max-h-full");
    expect(dialog.className).toContain("overflow-y-auto");
  });

  it("wraps agent actions and breaks arbitrary agent text", async () => {
    render(<AgentsPage />);

    const agent = await screen.findByRole("button", { name: `View agent ${LONG_TOKEN}` });
    const agentName = within(agent).getByText(LONG_TOKEN, { selector: "span.text-lg" });
    expect(agentName.className).toContain("break-all");
    expect(screen.getByRole("button", { name: "Disable" }).className).toContain("flex-1");
  });

  it("stacks plugin creation inputs and keeps plugin actions touch-visible", async () => {
    render(<PluginsPage />);

    const [pluginName] = await screen.findAllByText(LONG_TOKEN, { selector: "span" });
    expect(pluginName.className).toContain("break-all");
    expect(screen.getByRole("button", { name: "Edit" }).className).toContain("flex-1");
    fireEvent.click(screen.getByRole("button", { name: "Add Plugin" }));
    expect(screen.getByPlaceholderText("my-plugin").className).toContain("w-full");
  });

  it("contains backups tables and exposes named schedule switches", async () => {
    render(<BackupsPage />);

    const mobileList = await screen.findByTestId("backup-mobile-list");
    const region = screen.getByRole("region", { name: "Backups table" });
    expect(region.getAttribute("tabindex")).toBe("0");
    expect(region.className).toContain("overflow-x-auto");
    expect(region.querySelector("table")?.className).toContain("min-w-[720px]");
    expect(region.className).toContain("sm:block");
    expect(mobileList.className).toContain("sm:hidden");
    const mobileCard = screen.getByTestId("backup-mobile-card-backup-1");
    expect(within(mobileCard).getByRole("button", { name: "Download" }).className).toContain("flex-1");
    expect(within(mobileCard).getByRole("button", { name: "Delete" }).className).toContain("flex-1");
    await waitFor(() => expect(screen.getByRole("switch", { name: "Enable hourly backups" })).toBeTruthy());
    expect(screen.getByRole("switch", { name: "Enable daily backups" })).toBeTruthy();
  });
});
