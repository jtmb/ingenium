import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import React from "react";
import type { Skill } from "../src/lib/api";

const { listSkills, getSkill, createSkill, updateSkill, request, proposalCounts, proposalPage, active } = vi.hoisted(() => ({
  listSkills: vi.fn(), getSkill: vi.fn(), createSkill: vi.fn(), updateSkill: vi.fn(), request: vi.fn(),
  proposalCounts: vi.fn(), proposalPage: vi.fn(),
  active: { project: "test-project" },
}));
vi.mock("../src/lib/ProjectContext", () => ({ useProject: () => active.project }));
vi.mock("../src/lib/api", () => ({ request, api: { skills: {
  list: listSkills, get: getSkill, create: createSkill, update: updateSkill,
  proposals: { counts: proposalCounts, page: proposalPage },
} } }));
vi.mock("../src/app/components/Overlay", () => ({
  default: ({ isOpen, title, children }: { isOpen: boolean; title: string; children: React.ReactNode }) =>
    isOpen ? <div role="dialog" aria-label={title}>{children}</div> : null,
}));
vi.mock("../src/app/components/MarkdownViewer", () => ({ default: ({ content }: { content: string }) => <pre>{content}</pre> }));
vi.mock("../src/app/components/proposals/ProposalReviewOverlay", () => ({ default: () => null }));
vi.mock("../src/app/components/FileTree", () => ({
  default: ({ onSelectFile }: { onSelectFile: (path: string, content: string) => void }) =>
    <button type="button" onClick={() => onSelectFile("references/check.md", "# Reference")}>Reference file</button>,
}));
import SkillsPage from "../src/app/skills/page";

const base: Skill = { id: "skill", project_id: "project-uuid", name: "release-checks", description: "Verify release",
  content: "# Original", category: null, tags: null, always_apply: 0,
  file_tree: JSON.stringify({ "references/check.md": "# Reference" }), enabled: 1, revision: 1, archived_at: null,
  created_at: "2026-10-29", updated_at: "2026-10-29" };
const markdown = "---\nname: release-checks\ndescription: Verify release\n---\n# Uploaded\n";
function upload(text = markdown) {
  const file = new File([text], "SKILL.md", { type: "text/markdown" });
  Object.defineProperty(file, "text", { value: async () => text });
  fireEvent.change(screen.getByTestId("skills-upload-input"), { target: { files: [file] } });
}
async function ready() { await screen.findByTestId("skills-upload-btn"); }
async function edit(text: string) {
  fireEvent.click(await screen.findByRole("button", { name: "Open skill release-checks", exact: true }));
  fireEvent.click(await screen.findByRole("button", { name: "Edit", exact: true }));
  fireEvent.change(screen.getByRole("textbox", { name: "Edit SKILL.md", exact: true }), { target: { value: text } });
}

beforeEach(() => {
  active.project = "test-project";
  listSkills.mockReset().mockResolvedValue({ data: [base] });
  getSkill.mockReset().mockResolvedValue({ data: base });
  createSkill.mockReset().mockResolvedValue({ data: { ...base, content: "# Uploaded" } });
  updateSkill.mockReset().mockResolvedValue({ data: base });
  request.mockReset();
  proposalCounts.mockReset().mockResolvedValue({data: {open: 0, history: 0, byStatus: {}}});
  proposalPage.mockReset().mockResolvedValue({data: [], pagination: {nextCursor: null, hasMore: false}});
});
afterEach(() => { cleanup(); vi.useRealTimers(); });

describe("Skills upload and save outcomes", () => {
  it("rejects malformed Markdown before calling create", async () => {
    render(<SkillsPage />); await ready();
    upload("No metadata");
    expect(await screen.findByTestId("upload-error")).toHaveAttribute("data-outcome", "validation-error");
    expect(createSkill).not.toHaveBeenCalled();
  });

  it("shows denied upload as a persistent service refusal", async () => {
    createSkill.mockRejectedValue(Object.assign(new Error("Project access denied"), { status: 403, code: "FORBIDDEN" }));
    render(<SkillsPage />); await ready();
    vi.useFakeTimers();
    await act(async () => { upload(); });
    expect(screen.getByTestId("upload-error")).toHaveTextContent("Project access denied");
    expect(screen.getByTestId("upload-error")).toHaveAttribute("data-outcome", "refused");
    await act(async () => { vi.advanceTimersByTime(10_000); });
    expect(screen.getByTestId("upload-error")).toHaveTextContent("Project access denied");
    expect(createSkill).toHaveBeenCalledTimes(1);
  });

  it("blocks duplicate unknown creates and verifies stored content without replay", async () => {
    createSkill.mockRejectedValue(new TypeError("Connection lost"));
    getSkill.mockResolvedValue({ data: { ...base, content: "# Uploaded" } });
    render(<SkillsPage />); await ready();
    upload();
    await screen.findByText(/Upload outcome is unknown/);
    expect(screen.getByTestId("skills-upload-btn")).toBeDisabled();
    upload();
    expect(createSkill).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByRole("button", { name: "Verify stored upload", exact: true }));
    expect(await screen.findByTestId("upload-success")).toHaveAttribute("data-outcome", "verified");
    expect(createSkill).toHaveBeenCalledTimes(1);
    expect(getSkill).toHaveBeenCalledWith("release-checks", "test-project");
  });

  it("keeps confirmed create/failed refresh visible outside the unavailable list", async () => {
    listSkills.mockResolvedValueOnce({ data: [base] }).mockRejectedValue(new Error("List refresh offline"));
    render(<SkillsPage />); await ready();
    upload();
    const notice = await screen.findByTestId("upload-error");
    expect(notice).toHaveAttribute("data-outcome", "saved-refresh-failed");
    expect(notice).toHaveTextContent("skill was created");
    expect(notice).not.toHaveTextContent("Invalid Markdown");
    expect(screen.getByRole("button", { name: "Verify stored upload", exact: true })).toBeVisible();
    expect(createSkill).toHaveBeenCalledTimes(1);
  });

  it("retains the typed draft and error when save permission is denied", async () => {
    updateSkill.mockRejectedValue(Object.assign(new Error("Save permission denied"), { status: 403 }));
    render(<SkillsPage />); await edit("# Exact draft  \n");
    fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
    const dialog = screen.getByRole("dialog");
    expect(await within(dialog).findByTestId("skill-save-outcome")).toHaveTextContent("Save permission denied");
    expect(screen.getByRole("textbox", { name: "Edit SKILL.md", exact: true })).toHaveValue("# Exact draft  \n");
    expect(getSkill).toHaveBeenCalledTimes(1);
    expect(updateSkill).toHaveBeenCalledTimes(1);
    fireEvent.click(screen.getByTestId("tab-consolidated"));
    expect(screen.getByTestId("skill-save-outcome")).toHaveTextContent("Save permission denied");
    fireEvent.click(screen.getByTestId("tab-active"));
    expect(screen.getByRole("textbox", { name: "Edit SKILL.md", exact: true })).toHaveValue("# Exact draft  \n");
  });

  it("retains a confirmed saved draft after readback failure and verifies without another update", async () => {
    getSkill.mockResolvedValueOnce({ data: base }).mockRejectedValueOnce(new Error("Readback offline"))
      .mockResolvedValue({ data: { ...base, content: "# Desired" } });
    render(<SkillsPage />); await edit("# Desired");
    fireEvent.click(screen.getByRole("button", { name: "Save", exact: true }));
    const notice = await within(screen.getByRole("dialog")).findByTestId("skill-save-outcome");
    await waitFor(() => expect(notice).toHaveAttribute("data-outcome", "saved-refresh-failed"));
    expect(screen.getByRole("textbox", { name: "Edit SKILL.md", exact: true })).toHaveValue("# Desired");
    expect(screen.getByRole("button", { name: "Save", exact: true })).toBeDisabled();
    fireEvent.click(screen.getByRole("button", { name: "Verify stored save", exact: true }));
    await waitFor(() => expect(screen.queryByRole("textbox", { name: "Edit SKILL.md", exact: true })).toBeNull());
    expect(updateSkill).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("skill-save-outcome")).toHaveTextContent("Saved and verified");
  });

  it("does not leak a pending upload result across project selection", async () => {
    let complete: (value: {data: Skill}) => void = () => { throw new Error("Create did not start"); };
    createSkill.mockImplementation(() => new Promise((resolve) => { complete = resolve; }));
    const view = render(<SkillsPage />); await ready(); upload();
    await waitFor(() => expect(createSkill).toHaveBeenCalledTimes(1));
    active.project = "other-project";
    view.rerender(<SkillsPage />);
    await waitFor(() => expect(listSkills).toHaveBeenCalledWith("other-project"));
    await act(async () => { complete({ data: base }); });
    expect(screen.queryByTestId("upload-success")).toBeNull();
    expect(screen.queryByTestId("upload-error")).toBeNull();
    expect(createSkill).toHaveBeenCalledWith("release-checks", "Verify release", "# Uploaded", "test-project");
  });
});

it("preserves History selection across project switches while fencing old rows and totals", async () => {
  const page = (data: unknown[]) => ({data, pagination: {nextCursor: null, hasMore: false}});
  const counts = (history: number) => ({data: {open: 0, history, byStatus: {}}});
  const record = (id: string) => ({
    id, targetName: id, status: "stale", proposalType: "update", projectId: "project-uuid",
    qualityScore: 0.9, noveltyScore: 0.8, contradictionFlag: 0, createdAt: "2026-10-29",
  });
  let finishOldPage!: (value: ReturnType<typeof page>) => void;
  let finishOldCounts!: (value: ReturnType<typeof counts>) => void;
  const pendingPage = new Promise<ReturnType<typeof page>>(resolve => { finishOldPage = resolve; });
  const pendingCounts = new Promise<ReturnType<typeof counts>>(resolve => { finishOldCounts = resolve; });
  proposalCounts.mockImplementation((project: string) => project === "test-project" ? pendingCounts : Promise.resolve(counts(1)));
  proposalPage.mockImplementation((view: string, project: string) => view !== "history" ? Promise.resolve(page([]))
    : project === "test-project" ? pendingPage : Promise.resolve(page([record("new-history")])));
  const view = render(<SkillsPage />);
  await ready();
  fireEvent.click(screen.getByTestId("tab-proposals"));
  fireEvent.click(await screen.findByTestId("proposal-filter-history"));
  await waitFor(() => expect(proposalPage).toHaveBeenCalledWith("history", "test-project", expect.anything()));
  active.project = "other-project";
  view.rerender(<SkillsPage />);
  expect(await screen.findByTestId("proposal-card-new-history")).toBeVisible();
  expect(screen.getByTestId("proposal-filter-history")).toHaveAttribute("aria-selected", "true");
  await act(async () => { finishOldPage(page([record("old-history")])); finishOldCounts(counts(99)); });
  expect(screen.queryByTestId("proposal-card-old-history")).toBeNull();
  expect(screen.getByTestId("proposals-history-showing")).toHaveTextContent("Showing 1 of 1 history proposals.");
  expect(screen.getByTestId("proposal-card-new-history")).toBeVisible();
});
