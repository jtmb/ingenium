import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, within } from "@testing-library/react";
import React from "react";
import ProposalReviewOverlay, { type EnrichedObservation, type ProposalDto } from "../src/app/components/proposals/ProposalReviewOverlay";
import EvidenceCard from "../src/app/components/proposals/EvidenceCard";

afterEach(cleanup);

const proposal: ProposalDto = {
  id: "synthesis-proposal", projectId: "team / project", status: "applied",
  proposalType: "update", targetSkillId: "owned-skill", targetName: "verification",
  sourceProjectId: null, sourceName: null, expectedRevision: 1, expectedSourceRevision: null,
  targetRevisionBefore: 1, sourceRevisionBefore: null, targetCreated: 0,
  proposedState: { content: "# Verification", description: "Owned workflow" },
  evidence: [{ trigger: "LLM synthesis update", observation_ids: [228], model: "" }],
  observationIds: [228], qualityScore: 0.9, noveltyScore: 0.8, contradictionFlag: 0,
  candidateGroupKey: null, reviewer: null, reviewReason: null, alwaysApply: 0,
  createdAt: "2026-10-27T18:17:11.026Z", updatedAt: "2026-10-27T18:19:11.640Z",
  reviewedAt: null, appliedAt: "2026-10-27T18:19:11.640Z", rolledBackAt: null,
};

function review(observations: EnrichedObservation[]) {
  return render(<ProposalReviewOverlay
    isOpen onClose={vi.fn()} proposal={proposal} proposalDetail={proposal}
    detailLoading={false} currentSkillContent="# Verification"
    enrichedObservations={observations} project="team / project"
    onApprove={vi.fn()} onReject={vi.fn()} onRollback={vi.fn()}
    actionLoading={false} onViewSkill={vi.fn()}
  />);
}

describe("proposal evidence from the API", () => {
  it("shows the actual synthesis trigger and camelCase source preview/type", () => {
    review([{ id: 228, type: "correction", contentPreview: "Count uppercase R only.", importance: 9, source: "manual" }]);
    expect(screen.getByText("LLM synthesis update")).toBeTruthy();
    const source = screen.getByTestId("obs-card-228");
    expect(within(source).getByText("correction")).toBeTruthy();
    expect(within(source).getByText("Count uppercase R only.")).toBeTruthy();
    expect(source.getAttribute("href")).toBe("/observations/228?project=team%20%2F%20project");
    const evidence = screen.getByTestId("proposal-evidence");
    expect(within(evidence).getByText("Source previews")).toBeTruthy();
    expect(within(evidence).getByText("Count uppercase R only.")).toBeTruthy();
    expect(within(evidence).getByRole("link").getAttribute("title")).toContain("correction #228: Count uppercase R only.");
    expect(screen.queryByText("No supporting summaries available.")).toBeNull();
    expect(screen.queryByText("No preview")).toBeNull();
  });

  it("retains legacy observation aliases while preferring canonical API fields", () => {
    review([{ id: 228, type: "correction", observation_type: "legacy type",
      contentPreview: "Canonical preview", content_preview: "Legacy preview", content: "Full content" }]);
    const source = screen.getByTestId("obs-card-228");
    expect(within(source).getByText("Canonical preview")).toBeTruthy();
    expect(within(source).getByText("correction")).toBeTruthy();
    expect(screen.queryByText("Legacy preview")).toBeNull();
  });

  it("still renders legacy payload previews and trigger labels", () => {
    render(<EvidenceCard project="legacy" evidence={{ trigger_label: "Legacy trigger", observation_ids: [12] }}
      observations={[{ id: 12, observation_type: "workflow", content_preview: "Legacy source preview" }]} />);
    expect(screen.getByText("Legacy trigger")).toBeTruthy();
    expect(screen.getByText("Legacy source preview")).toBeTruthy();
    expect(screen.getByRole("link").getAttribute("title")).toBe("workflow #12: Legacy source preview");
  });

  it("keeps every source link when none or only some observations are enriched", () => {
    const { rerender } = render(<EvidenceCard project="team / project"
      evidence={{ observation_ids: [1, 2] }} observations={[]} />);
    expect(screen.getAllByRole("link").map((link) => link.getAttribute("href"))).toEqual([
      "/observations/1?project=team%20%2F%20project", "/observations/2?project=team%20%2F%20project",
    ]);
    rerender(<EvidenceCard project="team / project" evidence={{ observation_ids: [1, 2] }}
      observations={[{ id: 1, type: "correction", contentPreview: "Available source" }]} />);
    expect(screen.getAllByRole("link")).toHaveLength(2);
    expect(screen.getByRole("link", { name: "#2" }).getAttribute("title")).toContain("not enriched");
    expect(screen.getByText("Available source")).toBeTruthy();
  });

  it("preserves authored summaries and does not invent a preview for unavailable content", () => {
    const { rerender } = render(<EvidenceCard project="p"
      evidence={{ trigger: "Current trigger", observation_ids: [1], observation_summaries: ["Authored summary"] }}
      observations={[{ id: 1, type: "correction", contentPreview: "Raw source preview" }]} />);
    expect(screen.getByText("Authored summary")).toBeTruthy();
    expect(screen.queryByText("Source previews")).toBeNull();
    rerender(<EvidenceCard project="p" evidence={{ observation_ids: [1] }} observations={[{ id: 1 }]} />);
    expect(screen.getByText("No supporting summaries available.")).toBeTruthy();
    expect(screen.queryByText("Source previews")).toBeNull();
    expect(screen.getByRole("link").getAttribute("title")).toContain("No preview available");
  });
});
