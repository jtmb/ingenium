import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import React from "react";
import type { Skill } from "../src/lib/api";

const {
  getSkill,
  listSkills,
  getProposal,
  legacyListProposals,
  proposalCounts,
  proposalPage,
  approveProposal,
  rejectProposal,
  rollbackProposal,
  mocks,
} = vi.hoisted(() => ({
  getSkill: vi.fn(),
  listSkills: vi.fn(),
  getProposal: vi.fn(),
  legacyListProposals: vi.fn(),
  proposalCounts: vi.fn(),
  proposalPage: vi.fn(),
  approveProposal: vi.fn(),
  rejectProposal: vi.fn(),
  rollbackProposal: vi.fn(),
  mocks: { activeProject: "test-project" },
}));

vi.mock("../src/lib/ProjectContext", () => ({
  useProject: () => mocks.activeProject,
}));

vi.mock("../src/lib/api", () => ({
  api: {
    skills: {
      get: getSkill,
      list: listSkills,
      proposals: {
        get: getProposal,
        list: legacyListProposals,
        counts: proposalCounts,
        page: proposalPage,
        approve: approveProposal,
        reject: rejectProposal,
        rollback: rollbackProposal,
      },
    },
  },
}));

vi.mock("../src/app/components/proposals/ProposalReviewOverlay", () => ({
  default: ({
    isOpen,
    proposal,
    proposalDetail,
    onApprove,
    onReject,
    onRollback,
  }: {
    isOpen: boolean;
    proposal: { targetName: string };
    proposalDetail: { targetName: string } | null;
    onApprove: (reviewer: string, reason: string) => void;
    onReject: (reviewer: string, reason: string) => void;
    onRollback: (reviewer: string, reason: string) => void;
  }) => (
    isOpen ? (
      <div
        role="dialog"
        aria-label={`Proposal ${proposalDetail?.targetName ?? proposal.targetName}`}
        data-testid={proposalDetail ? "proposal-detail-loaded" : "proposal-detail-loading"}
      >
        {proposalDetail?.targetName ?? proposal.targetName}
        <button type="button" onClick={() => onApprove("test-reviewer", "")}>Approve proposal</button>
        <button type="button" onClick={() => onReject("test-reviewer", "")}>Reject proposal</button>
        <button type="button" onClick={() => onRollback("test-reviewer", "reason")}>Rollback proposal</button>
      </div>
    ) : null
  ),
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

const createProposal = {
  id: "proposal-create",
  projectId: "test-project",
  status: "pending",
  proposalType: "create",
  targetSkillId: null,
  targetName: "new-skill",
  sourceProjectId: null,
  sourceName: null,
  expectedRevision: null,
  expectedSourceRevision: null,
  targetRevisionBefore: null,
  sourceRevisionBefore: null,
  targetCreated: 1,
  proposedState: { description: "A new skill", content: "# New skill" },
  evidence: [],
  observationIds: [],
  qualityScore: 0.9,
  noveltyScore: 0.8,
  contradictionFlag: 0,
  candidateGroupKey: null,
  reviewer: null,
  reviewReason: null,
  alwaysApply: 0,
  createdAt: "2026-07-28T00:00:00.000Z",
  updatedAt: "2026-07-28T00:00:00.000Z",
  reviewedAt: null,
  appliedAt: null,
  rolledBackAt: null,
};

function proposalFor(status: string, id: string, targetName = id) {
  return { ...createProposal, id, status, targetName };
}

function proposalCountsResponse(open = 0, history = 0) {
  return {
    data: {
      open,
      history,
      byStatus: { draft: 0, pending: open, stale: history, rejected: 0, applied: 0, rolled_back: 0 },
    },
  };
}

function proposalPageResponse(data: ReturnType<typeof proposalFor>[] = [], nextCursor: string | null = null, hasMore = false) {
  return { data, pagination: { nextCursor, hasMore } };
}

describe("SkillsPage detail overlay", () => {
  beforeEach(() => {
    mocks.activeProject = "test-project";
    listSkills.mockReset().mockResolvedValue({ data: [skill] });
    getSkill.mockReset().mockResolvedValue({ data: skill });
    legacyListProposals.mockReset();
    proposalCounts.mockReset().mockResolvedValue(proposalCountsResponse());
    proposalPage.mockReset().mockResolvedValue(proposalPageResponse());
    getProposal.mockReset().mockResolvedValue({ data: createProposal });
    approveProposal.mockReset().mockResolvedValue({ data: createProposal });
    rejectProposal.mockReset().mockResolvedValue({ data: createProposal });
    rollbackProposal.mockReset().mockResolvedValue({ data: createProposal });
  });

  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  it("shows loading without presenting an unverified zero count", async () => {
    let resolveSkills!: (value: { data: Skill[] }) => void;
    listSkills.mockReset().mockReturnValue(new Promise((resolve) => {
      resolveSkills = resolve;
    }));

    render(<SkillsPage />);

    expect(screen.getByRole("heading", { name: "Active Skills", exact: true })).toBeTruthy();
    expect(screen.getByTestId("active-skills-loading")).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Active Skills (0)", exact: true })).toBeNull();

    resolveSkills({ data: [skill] });
    await waitFor(() => expect(screen.getByRole("heading", { name: "Active Skills (1)", exact: true })).toBeTruthy());
  });

  it("renders an explicit active-skills error instead of a zero state", async () => {
    listSkills.mockReset().mockRejectedValue(new Error("Skills service unavailable"));

    render(<SkillsPage />);

    expect((await screen.findByTestId("active-skills-error")).textContent).toContain("Skills service unavailable");
    expect(screen.getByRole("heading", { name: "Active Skills", exact: true })).toBeTruthy();
    expect(screen.queryByRole("heading", { name: "Active Skills (0)", exact: true })).toBeNull();
  });

  it("names the selected project in the verified empty state", async () => {
    listSkills.mockReset().mockResolvedValue({ data: [] });

    render(<SkillsPage />);

    expect((await screen.findByTestId("active-skills-empty")).textContent).toContain(
      "No active skills in test-project. Use the project selector above to switch projects.",
    );
    expect(screen.getByRole("heading", { name: "Active Skills (0)", exact: true })).toBeTruthy();
    expect(screen.getByTestId("skills-project-label").textContent).toContain("Project: test-project");
  });

  it("loads totals and only a bounded Open page until History is selected", async () => {
    const open = Array.from({ length: 9 }, (_, index) => proposalFor(index === 0 ? "draft" : "pending", `open-${index + 1}`));
    const history = Array.from({ length: 25 }, (_, index) => proposalFor("stale", `history-${index + 1}`));
    proposalCounts.mockResolvedValue(proposalCountsResponse(9, 5_000));
    proposalPage.mockImplementation((view: string) => Promise.resolve(
      view === "open"
        ? proposalPageResponse(open)
        : proposalPageResponse(history, "history-cursor-1", true),
    ));

    render(<SkillsPage />);
    fireEvent.click(screen.getByTestId("tab-proposals"));

    const openFilter = await screen.findByRole("tab", { name: "Open proposals (9)" });
    const historyFilter = screen.getByRole("tab", { name: "Proposal history (5,000)" });
    expect(openFilter.getAttribute("aria-selected")).toBe("true");
    expect(screen.getAllByTestId(/proposal-card-/)).toHaveLength(9);
    expect(screen.getByTestId("proposals-open-showing").textContent).toContain("Showing 9 of 9 open proposals.");
    expect(proposalCounts).toHaveBeenCalledTimes(1);
    expect(proposalPage).toHaveBeenCalledTimes(1);
    expect(proposalPage.mock.calls[0]?.[0]).toBe("open");
    expect(proposalPage.mock.calls[0]?.[1]).toBe("test-project");
    expect(proposalPage.mock.calls[0]?.[2]).toMatchObject({ limit: 25 });
    expect(legacyListProposals).not.toHaveBeenCalled();

    openFilter.focus();
    fireEvent.keyDown(openFilter, { key: "ArrowRight" });
    expect(document.activeElement).toBe(historyFilter);
    expect(historyFilter.getAttribute("aria-selected")).toBe("true");
    await screen.findByTestId("proposal-card-history-1");
    expect(screen.getAllByTestId(/proposal-card-/)).toHaveLength(25);
    expect(screen.getByTestId("proposals-history-showing").textContent).toContain("Showing 25 of 5,000 history proposals.");
    expect(proposalPage.mock.calls.filter(([view]) => view === "history")).toHaveLength(1);
  });

  it("uses the additive counts and bounded page API contracts", async () => {
    const fetchMock = vi.fn()
      .mockResolvedValueOnce(new Response(JSON.stringify(proposalCountsResponse(9, 5_000)), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify(proposalPageResponse([], "next-cursor", true)), { status: 200 }));
    vi.stubGlobal("fetch", fetchMock);
    const actual = await vi.importActual<typeof import("../src/lib/api")>("../src/lib/api");
    const controller = new AbortController();

    const counts = await actual.api.skills.proposals.counts("test-project", controller.signal);
    const page = await actual.api.skills.proposals.page("history", "test-project", {
      limit: 25,
      cursor: "next-cursor",
      signal: controller.signal,
    });

    expect(counts.data).toMatchObject({ open: 9, history: 5_000, byStatus: { pending: 9, stale: 5_000 } });
    expect(page.pagination).toMatchObject({ nextCursor: "next-cursor", hasMore: true });
    expect(fetchMock.mock.calls[0]?.[0]).toBe("/api/v1/skills/proposals/counts?project=test-project");
    expect(fetchMock.mock.calls[0]?.[1]).toMatchObject({ signal: controller.signal });
    expect(fetchMock.mock.calls[1]?.[0]).toBe("/api/v1/skills/proposals/page?project=test-project&view=history&limit=25&cursor=next-cursor");
    expect(fetchMock.mock.calls[1]?.[1]).toMatchObject({ signal: controller.signal });
  });

  it("keeps Open and History empty states independent", async () => {
    proposalCounts.mockResolvedValue(proposalCountsResponse());
    proposalPage.mockResolvedValue(proposalPageResponse());

    render(<SkillsPage />);
    fireEvent.click(screen.getByTestId("tab-proposals"));

    expect((await screen.findByTestId("proposals-open-empty")).textContent).toContain("No open proposals in test-project.");
    fireEvent.click(screen.getByTestId("proposal-filter-history"));
    expect((await screen.findByTestId("proposals-history-empty")).textContent).toContain("No proposal history in test-project.");
    expect(screen.queryByTestId("proposals-open-empty")).toBeNull();
  });

  it("keeps totals, view, and load-more failures independently visible", async () => {
    const open = proposalFor("pending", "open-proposal");
    let openRequests = 0;
    proposalCounts.mockRejectedValue(new Error("Totals unavailable"));
    proposalPage.mockImplementation((view: string) => {
      if (view === "history") return Promise.reject(new Error("History unavailable"));
      openRequests += 1;
      return openRequests === 1
        ? Promise.resolve(proposalPageResponse([open], "open-cursor-1", true))
        : Promise.reject(new Error("More Open unavailable"));
    });

    render(<SkillsPage />);
    fireEvent.click(screen.getByTestId("tab-proposals"));

    expect((await screen.findByTestId("proposal-counts-error")).textContent).toContain("Totals unavailable");
    expect(await screen.findByTestId("proposal-card-open-proposal")).toBeTruthy();
    fireEvent.click(screen.getByTestId("proposals-open-load-more"));
    expect((await screen.findByTestId("proposals-open-load-more-error")).textContent).toContain("More Open unavailable");
    expect(screen.getByTestId("proposal-card-open-proposal")).toBeTruthy();

    fireEvent.click(screen.getByTestId("proposal-filter-history"));
    expect((await screen.findByTestId("proposals-history-error")).textContent).toContain("History unavailable");
    expect(screen.queryByTestId("proposals-history-empty")).toBeNull();
  });

  it("appends deduplicated keyset History pages from the native load-more button", async () => {
    const firstPage = Array.from({ length: 25 }, (_, index) => proposalFor("stale", `history-${index + 1}`));
    const secondPage = [
      proposalFor("stale", "history-25"),
      ...Array.from({ length: 24 }, (_, index) => proposalFor("stale", `history-${index + 26}`)),
    ];
    proposalCounts.mockResolvedValue(proposalCountsResponse(0, 5_000));
    proposalPage.mockImplementation((view: string, _project: string, options?: { cursor?: string }) => {
      if (view === "open") return Promise.resolve(proposalPageResponse());
      return Promise.resolve(options?.cursor === "history-cursor-1"
        ? proposalPageResponse(secondPage)
        : proposalPageResponse(firstPage, "history-cursor-1", true));
    });

    render(<SkillsPage />);
    fireEvent.click(screen.getByTestId("tab-proposals"));
    fireEvent.click(await screen.findByTestId("proposal-filter-history"));
    await screen.findByTestId("proposal-card-history-1");

    const loadMore = screen.getByRole("button", { name: "Load more history" });
    expect(loadMore.tagName).toBe("BUTTON");
    expect(loadMore.getAttribute("type")).toBe("button");
    loadMore.focus();
    expect(document.activeElement).toBe(loadMore);
    fireEvent.click(loadMore);

    await screen.findByTestId("proposal-card-history-49");
    expect(screen.getAllByTestId(/proposal-card-history-/)).toHaveLength(49);
    expect(screen.getByTestId("proposals-history-showing").textContent).toContain("Showing 49 of 5,000 history proposals.");
    expect(proposalPage.mock.calls.filter(([view]) => view === "history")[1]?.[2]).toMatchObject({
      cursor: "history-cursor-1",
      limit: 25,
    });
  });

  it("drops stale old-project proposal responses and resets to Open", async () => {
    const oldProposal = proposalFor("pending", "old-proposal");
    const newProposal = proposalFor("pending", "new-proposal");
    let resolveOldCounts!: (value: ReturnType<typeof proposalCountsResponse>) => void;
    let resolveOldPage!: (value: ReturnType<typeof proposalPageResponse>) => void;
    const oldCounts = new Promise<ReturnType<typeof proposalCountsResponse>>((resolve) => { resolveOldCounts = resolve; });
    const oldPage = new Promise<ReturnType<typeof proposalPageResponse>>((resolve) => { resolveOldPage = resolve; });
    proposalCounts.mockImplementation((requestedProject: string) => (
      requestedProject === "test-project" ? oldCounts : Promise.resolve(proposalCountsResponse(1, 0))
    ));
    proposalPage.mockImplementation((view: string, requestedProject: string) => {
      if (view !== "open") return Promise.resolve(proposalPageResponse());
      return requestedProject === "test-project"
        ? oldPage
        : Promise.resolve(proposalPageResponse([newProposal]));
    });

    const { rerender } = render(<SkillsPage />);
    fireEvent.click(screen.getByTestId("tab-proposals"));

    mocks.activeProject = "other-project";
    rerender(<SkillsPage />);

    await screen.findByTestId("proposal-card-new-proposal");
    resolveOldCounts(proposalCountsResponse(1, 0));
    resolveOldPage(proposalPageResponse([oldProposal]));
    await waitFor(() => expect(screen.queryByTestId("proposal-card-old-proposal")).toBeNull());
    expect(screen.getByTestId("proposal-filter-open").getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByTestId("proposal-card-new-history")).toBeNull();
  });

  it("refreshes totals and Open while invalidating cached History after a mutation", async () => {
    const openProposal = proposalFor("pending", "open-proposal", "new-skill");
    const historyProposal = proposalFor("stale", "history-proposal");
    let openRequests = 0;
    proposalCounts
      .mockResolvedValueOnce(proposalCountsResponse(1, 1))
      .mockResolvedValueOnce(proposalCountsResponse(0, 2));
    proposalPage.mockImplementation((view: string) => {
      if (view === "history") return Promise.resolve(proposalPageResponse([historyProposal]));
      openRequests += 1;
      return Promise.resolve(proposalPageResponse(openRequests === 1 ? [openProposal] : []));
    });
    getProposal.mockResolvedValue({ data: { ...createProposal, id: "open-proposal", targetName: "new-skill", currentSkill: null } });

    render(<SkillsPage />);
    fireEvent.click(screen.getByTestId("tab-proposals"));
    await screen.findByTestId("proposal-card-open-proposal");
    fireEvent.click(screen.getByTestId("proposal-filter-history"));
    await screen.findByTestId("proposal-card-history-proposal");
    fireEvent.click(screen.getByTestId("proposal-filter-open"));
    fireEvent.click(await screen.findByTestId("proposal-card-open-proposal"));
    await screen.findByTestId("proposal-detail-loaded");
    fireEvent.click(screen.getByRole("button", { name: "Approve proposal" }));

    await waitFor(() => expect(approveProposal).toHaveBeenCalledWith("open-proposal", "test-reviewer", undefined, "test-project"));
    await waitFor(() => expect(proposalCounts).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(proposalPage.mock.calls.filter(([view]) => view === "open")).toHaveLength(2));
    expect(proposalPage.mock.calls.filter(([view]) => view === "history")).toHaveLength(1);
    expect(screen.getByTestId("proposal-filter-open").getAttribute("aria-selected")).toBe("true");
    expect(screen.queryByTestId("proposal-card-history-proposal")).toBeNull();
  });

  it("loads the proposal detail only after an accessible summary card is activated", async () => {
    proposalCounts.mockResolvedValue(proposalCountsResponse(1, 0));
    proposalPage.mockResolvedValue(proposalPageResponse([createProposal]));
    getProposal.mockResolvedValue({ data: { ...createProposal, currentSkill: null } });
    getSkill.mockResolvedValue({ data: skill });

    render(<SkillsPage />);
    fireEvent.click(screen.getByTestId("tab-proposals"));

    const card = await screen.findByRole("button", { name: "Open create proposal for new-skill" });
    expect(card.tagName).toBe("BUTTON");
    expect(card.getAttribute("type")).toBe("button");
    expect(card.querySelectorAll("button, a, input, select, textarea, [role='button']")).toHaveLength(0);
    expect(getProposal).not.toHaveBeenCalled();
    expect(getSkill).not.toHaveBeenCalled();

    card.focus();
    fireEvent.click(card);
    expect(await screen.findByTestId("proposal-detail-loaded")).toBeTruthy();
    expect(screen.getByRole("dialog", { name: "Proposal new-skill" })).toBeTruthy();
    expect(getProposal).toHaveBeenCalledWith("proposal-create", "test-project");
    expect(getSkill).not.toHaveBeenCalled();
  });

  it("silently tolerates a missing target when opening a historical update proposal", async () => {
    const staleUpdate = { ...createProposal, id: "proposal-stale", proposalType: "update", status: "stale", targetName: "removed-skill" };
    proposalCounts.mockResolvedValue(proposalCountsResponse(0, 1));
    proposalPage.mockImplementation((view: string) => Promise.resolve(
      view === "history" ? proposalPageResponse([staleUpdate]) : proposalPageResponse(),
    ));
    getProposal.mockResolvedValue({ data: { ...staleUpdate, currentSkill: null } });
    getSkill.mockRejectedValue(new Error("Skill not found"));
    const consoleError = vi.spyOn(console, "error").mockImplementation(() => {});

    render(<SkillsPage />);
    fireEvent.click(screen.getByTestId("tab-proposals"));
    fireEvent.click(await screen.findByTestId("proposal-filter-history"));
    const card = await screen.findByRole("button", { name: "Open update proposal for removed-skill" });
    fireEvent.click(card);

    await waitFor(() => expect(getSkill).toHaveBeenCalledWith("removed-skill", "test-project"));
    expect(screen.getByRole("dialog", { name: "Proposal removed-skill" })).toBeTruthy();
    expect(consoleError).not.toHaveBeenCalled();
    consoleError.mockRestore();
  });

  it("opens from the native skill control and restores focus after Escape", async () => {
    render(<SkillsPage />);

    expect(await screen.findByRole("combobox", { name: "Sort skills" })).toBeTruthy();

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

  it("wraps skill controls so Upload Skill stays within a mobile viewport", async () => {
    render(<SkillsPage />);

    const controls = (await screen.findByTestId("skills-search")).parentElement;
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
