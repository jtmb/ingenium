import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import React from "react";

const { listAgents, listPlugins } = vi.hoisted(() => ({
  listAgents: vi.fn(),
  listPlugins: vi.fn(),
}));

vi.mock("../src/lib/ProjectContext", () => ({ useProject: () => "active-project" }));
vi.mock("../src/lib/api", () => ({
  api: {
    agents: { list: listAgents },
    plugins: { list: listPlugins },
  },
}));
vi.mock("../src/app/components/Overlay", () => ({
  default: ({ isOpen, title, children }: { isOpen: boolean; title: string; children: React.ReactNode }) => (
    isOpen ? <div role="dialog" aria-label={title}>{children}</div> : null
  ),
}));
vi.mock("../src/app/components/MarkdownViewer", () => ({ default: () => null }));

import AgentsPage from "../src/app/agents/page";
import PluginsPage from "../src/app/plugins/page";

beforeEach(() => {
  listAgents.mockReset();
  listPlugins.mockReset();
});

afterEach(cleanup);

describe("resource card controls", () => {
  it("opens an agent detail overlay from a native button", async () => {
    listAgents.mockResolvedValue({
      data: [{
        id: "agent-1",
        name: "review-agent",
        description: "Reviews changes",
        category: "execution",
        mode: "subagent",
        content: "# Review",
        enabled: true,
        created_at: "2026-08-09T00:00:00.000Z",
        updated_at: "2026-08-09T00:00:00.000Z",
      }],
    });

    render(<AgentsPage />);

    const card = await screen.findByRole("button", { name: "View agent review-agent" });
    expect(card.tagName).toBe("BUTTON");
    fireEvent.click(card);
    expect(screen.getByRole("dialog", { name: "review-agent" })).not.toBeNull();
  });

  it("opens a plugin detail overlay from a native button", async () => {
    listPlugins.mockResolvedValue({
      data: [{ id: "plugin-1", name: "review-plugin", file_path: "review-plugin.ts", enabled: true }],
    });

    render(<PluginsPage />);

    const card = await screen.findByRole("button", { name: "View plugin review-plugin" });
    expect(card.tagName).toBe("BUTTON");
    fireEvent.click(card);
    expect(screen.getByRole("dialog", { name: "review-plugin" })).not.toBeNull();
  });
});
