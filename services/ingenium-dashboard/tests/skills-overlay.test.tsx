import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import type { Skill } from "../src/lib/api";

const { getSkill, listSkills } = vi.hoisted(() => ({
  getSkill: vi.fn(),
  listSkills: vi.fn(),
}));

vi.mock("../src/lib/ProjectContext", () => ({
  useProject: () => "test-project",
}));

vi.mock("../src/lib/api", () => ({
  api: {
    skills: {
      get: getSkill,
      list: listSkills,
    },
  },
}));

vi.mock("../src/app/components/proposals/ProposalReviewOverlay", () => ({
  default: () => null,
}));

import SkillsPage from "../src/app/skills/page";

const skill: Skill = {
  id: "skill-layout",
  project_id: "test-project",
  name: "layout-skill",
  description: "Verifies a bounded skill detail dialog",
  content: "# Skill",
  category: null,
  tags: null,
  always_apply: 0,
  file_tree: JSON.stringify({
    "references/nested/a-path-that-is-deliberately-long-to-test-overflow.md": "# Preview",
  }),
  enabled: 1,
  revision: 1,
  archived_at: null,
  created_at: "2026-07-28T00:00:00.000Z",
  updated_at: "2026-07-28T00:00:00.000Z",
};

describe("SkillsPage detail overlay", () => {
  beforeEach(() => {
    listSkills.mockReset().mockResolvedValue({ data: [skill] });
    getSkill.mockReset().mockResolvedValue({ data: skill });
  });

  afterEach(cleanup);

  it("opens from the native skill control and restores focus after Escape", async () => {
    render(<SkillsPage />);

    expect(screen.getByRole("combobox", { name: "Sort skills" })).toBeTruthy();

    const opener = await screen.findByTestId("skill-card-layout-skill");
    expect(opener.tagName).toBe("BUTTON");
    expect(opener.getAttribute("aria-label")).toBe("Open skill layout-skill");
    expect(opener.querySelectorAll("button, a, input, select, textarea, [role='button']").length).toBe(0);

    opener.focus();
    fireEvent.click(opener);
    expect(await screen.findByRole("dialog", { name: "layout-skill" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("textbox", { name: "Edit SKILL.md" })).toBeTruthy();

    fireEvent.click(screen.getByRole("button", { name: "Open references/nested/a-path-that-is-deliberately-long-to-test-overflow.md" }));
    fireEvent.click(screen.getByRole("button", { name: "Edit" }));
    expect(screen.getByRole("textbox", { name: "Edit references/nested/a-path-that-is-deliberately-long-to-test-overflow.md" })).toBeTruthy();

    fireEvent.keyDown(document, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("dialog", { name: "layout-skill" })).toBeNull());
    expect(document.activeElement).toBe(opener);
  });

  it("wraps skill controls so Upload Skill stays within a mobile viewport", () => {
    render(<SkillsPage />);

    const controls = screen.getByTestId("skills-search").parentElement;
    expect(controls?.className).toContain("flex-col");
    expect(controls?.className).toContain("sm:flex-row");
    expect(screen.getByTestId("skills-search").className).toContain("w-full");
    expect(screen.getByRole("combobox", { name: "Sort skills" }).className).toContain("w-full");
    expect(screen.getByTestId("skills-upload-btn").className).toContain("w-full");
  });

  it("uses the shared accessible dialog with a viewport-bounded responsive preview", async () => {
    render(<SkillsPage />);

    fireEvent.click(await screen.findByTestId("skill-card-layout-skill"));

    const dialog = await screen.findByRole("dialog", { name: "layout-skill" });
    expect(dialog.className).toContain("h-[90dvh]");
    expect(dialog.className).toContain("min-h-0");

    const body = screen.getByTestId("skill-modal-body");
    expect(body.className).toContain("flex-col");
    expect(body.className).toContain("md:flex-row");

    const preview = screen.getByTestId("skill-preview");
    expect(preview.className).toContain("min-w-0");
    expect(preview.className).toContain("overflow-hidden");
    expect(screen.getByTestId("skill-preview-content").className).toContain("overflow-auto");
    expect(screen.getByTestId("skill-file-tree").className).toContain("max-h-[40%]");
  });
});
