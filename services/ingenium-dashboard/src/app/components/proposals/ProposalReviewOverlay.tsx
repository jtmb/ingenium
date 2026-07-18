"use client";

import { useState, useEffect, useCallback } from "react";
import { createPortal } from "react-dom";
import { badgeTones, BADGE_BASE } from "../../../lib/badgeTones";
import ScoreGauge from "./ScoreGauge";
import ProposalTimeline from "./ProposalTimeline";
import ContentComparison from "./ContentComparison";
import MetadataCompareTable from "./MetadataCompareTable";
import EvidenceCard from "./EvidenceCard";
import ObservationSourceCard from "./ObservationSourceCard";
import ReviewActionForm from "./ReviewActionForm";

/** Enriched observation data from the API when `enrich=true` is requested. */
export type EnrichedObservation = {
  id: number;
  observation_type?: string;
  content_preview?: string;
  content?: string;
  importance?: number;
  source?: string;
};

/** DTO shape for a proposal (matches the API response). */
export type ProposalDto = {
  id: string;
  projectId: string;
  status: string;
  proposalType: string;
  targetSkillId: string | null;
  targetName: string;
  sourceProjectId: string | null;
  sourceName: string | null;
  expectedRevision: number | null;
  expectedSourceRevision: number | null;
  targetRevisionBefore: number | null;
  sourceRevisionBefore: number | null;
  targetCreated: number;
  proposedState: Record<string, unknown>;
  evidence: unknown[];
  observationIds: unknown[];
  qualityScore: number;
  noveltyScore: number;
  contradictionFlag: number;
  candidateGroupKey: string | null;
  reviewer: string | null;
  reviewReason: string | null;
  alwaysApply: number;
  createdAt: string;
  updatedAt: string;
  reviewedAt: string | null;
  appliedAt: string | null;
  rolledBackAt: string | null;
};

type ProposalReviewOverlayProps = {
  isOpen: boolean;
  onClose: () => void;
  proposal: ProposalDto;
  proposalDetail: ProposalDto | null;
  detailLoading: boolean;
  currentSkillContent: string | null;
  enrichedObservations: EnrichedObservation[];
  project: string;
  onApprove: (reviewer: string, reason: string) => void;
  onReject: (reviewer: string, reason: string) => void;
  onRollback: (reviewer: string, reason: string) => void;
  actionLoading: boolean;
  actionError?: string | null;
  onViewSkill: () => void;
};

/** Map proposal status → badge hue. */
function proposalStatusHue(status: string): string {
  switch (status) {
    case "draft": return "gray";
    case "pending": return "amber";
    case "applied": return "green";
    case "rolledBack": return "orange";
    case "stale": return "slate";
    default: return "gray";
  }
}

/** Map proposal type → badge hue. */
function proposalTypeHue(type: string): string {
  switch (type) {
    case "create": return "emerald";
    case "update": return "blue";
    case "merge": return "purple";
    case "archive": return "orange";
    default: return "gray";
  }
}

/** Parse the proposedState.content as a Markdown string (NOT raw JSON). */
function parseProposedContent(proposedState: Record<string, unknown>): string {
  if (!proposedState) return "";
  // The content field is an actual Markdown string
  if (typeof proposedState.content === "string") return proposedState.content;
  // Fallback: if content is missing, try to construct a readable preview
  return "";
}

/** Parse the current skill metadata for MetadataCompareTable. */
function parseCurrentMetadata(skillContent: string | null, existingTags?: string, existingAlwaysApply?: number): Record<string, unknown> {
  if (!skillContent) return {};
  // Extract frontmatter if present
  const fm = skillContent.match(/^---\s*\n([\s\S]*?)\n---/);
  const desc = fm ? fm[1]?.match(/description:\s*(.+)/)?.[1]?.trim() ?? "" : "";
  return {
    description: desc || "(parsed from content)",
    category: "",
    tags: existingTags ?? "",
    alwaysApply: existingAlwaysApply ?? 0,
  };
}

/**
 * ProposalReviewOverlay — full overlay for reviewing a single governance proposal.
 *
 * Structure:
 * - Header (target name, type/status badges, close button)
 * - Scores grid (ScoreGauge × 3)
 * - ContentComparison (current vs proposed, source-only panels)
 * - MetadataCompareTable (field changes)
 * - Evidence cards (EvidenceCard widgets)
 * - Observation source cards (ObservationSourceCard, linked)
 * - ProposalTimeline
 * - ReviewActionForm (unified approve/reject/rollback)
 * - View Skill button (for applied proposals)
 *
 * On mobile (<768px): full-screen, panels stack vertically.
 * Supports Escape to close, keyboard navigation, focus trap.
 */
export default function ProposalReviewOverlay({
  isOpen,
  onClose,
  proposal,
  proposalDetail,
  detailLoading,
  currentSkillContent,
  enrichedObservations,
  project,
  onApprove,
  onReject,
  onRollback,
  actionLoading,
  actionError,
  onViewSkill,
}: ProposalReviewOverlayProps) {
  const [mobileExpanded, setMobileExpanded] = useState(false);

  // Escape key handler
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    },
    [onClose]
  );

  useEffect(() => {
    if (isOpen) {
      document.addEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "hidden";
    }
    return () => {
      document.removeEventListener("keydown", handleKeyDown);
      document.body.style.overflow = "";
    };
  }, [isOpen, handleKeyDown]);

  if (!isOpen) return null;

  const detail = proposalDetail ?? proposal;
  const proposedContent = parseProposedContent(detail.proposedState);
  const currentMeta = parseCurrentMetadata(currentSkillContent, undefined, proposal.targetSkillId ? undefined : undefined);

  // Proposed metadata fields for comparison
  const proposedMeta: Record<string, unknown> = {
    description: (detail.proposedState?.description as string) ?? "",
    category: (detail.proposedState?.category as string) ?? "",
    tags: (detail.proposedState?.tags as string) ?? "",
    alwaysApply: (detail.proposedState?.alwaysApply as number) ?? 0,
  };

  const metaFields = [
    { key: "description", label: "Description" },
    { key: "category", label: "Category" },
    {
      key: "tags",
      label: "Tags",
      render: (v: unknown) => (Array.isArray(v) ? v.join(", ") : String(v)),
    },
    {
      key: "alwaysApply",
      label: "Always Apply",
      render: (v: unknown) => (v === 1 ? "Yes" : "No"),
    },
  ];

  const isNewSkill = detail.proposalType === "create";
  const canApprove = detail.status === "pending";
  const canReject = detail.status === "pending";
  const canRollback = detail.status === "applied";
  const isApplied = detail.status === "applied";

  const renderBadge = (type: string, hue: string) => (
    <span className={`${BADGE_BASE} ${badgeTones(hue)}`}>{type}</span>
  );

  const body = (
    <div className="space-y-6">
      {detailLoading ? (
        <p className="text-center py-12 text-[var(--color-text-muted)]">Loading details...</p>
      ) : !detail ? (
        <p className="text-center py-12 text-[var(--color-error-text)]">Failed to load proposal detail.</p>
      ) : (
        <>
          {/* Scores grid */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4" data-testid="proposal-scores">
            <ScoreGauge value={detail.qualityScore} label="Quality" max={1} />
            <ScoreGauge value={detail.noveltyScore} label="Novelty" max={1} />
            <div className="border border-[var(--color-border)] rounded p-3 bg-[var(--color-surface)]">
              <span className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wide block mb-1">
                Contradiction
              </span>
              <span
                className={`text-lg font-bold ${
                  detail.contradictionFlag
                    ? "text-[var(--color-error-text)]"
                    : "text-[var(--color-success-text)]"
                }`}
              >
                {detail.contradictionFlag ? "Flagged ⚠" : "None"}
              </span>
              <span className="text-[10px] text-[var(--color-text-muted)] block mt-0.5">
                {detail.contradictionFlag
                  ? "This proposal conflicts with an existing pattern"
                  : "No conflicts detected"}
              </span>
            </div>
          </div>

          {/* ContentComparison — source-only comparison panels */}
          <ContentComparison
            currentContent={currentSkillContent}
            proposedContent={proposedContent}
            currentLabel={isNewSkill ? "Empty" : "Current Skill"}
            proposedLabel="Proposed"
            isNewSkill={isNewSkill}
          />

          {/* MetadataCompareTable */}
          <MetadataCompareTable
            current={isNewSkill ? null : currentMeta}
            proposed={proposedMeta}
            fields={metaFields}
          />

          {/* Evidence cards — rendered as meaningful widgets, NOT <pre> blocks */}
          {detail.evidence && detail.evidence.length > 0 && (
            <div>
              <h3 className="font-medium text-[var(--color-text-primary)] mb-2">
                Evidence ({detail.evidence.length})
              </h3>
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3" data-testid="proposal-evidence">
                {(detail.evidence as Record<string, unknown>[]).map((ev, i) => (
                  <EvidenceCard
                    key={i}
                    evidence={ev as any}
                    observations={enrichedObservations}
                    project={project}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Observation source cards — clickable, linked to /observations */}
          {enrichedObservations.length > 0 && (
            <div>
              <h3 className="font-medium text-[var(--color-text-primary)] mb-2">
                Source Observations ({enrichedObservations.length})
              </h3>
              <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3" data-testid="proposal-observations">
                {enrichedObservations.map((obs) => (
                  <ObservationSourceCard
                    key={obs.id}
                    id={obs.id}
                    type={obs.observation_type}
                    contentPreview={obs.content_preview ?? obs.content}
                    importance={obs.importance}
                    source={obs.source}
                    project={project}
                  />
                ))}
              </div>
            </div>
          )}

          {/* Fallback: show observation IDs as linked badges when not enriched */}
          {enrichedObservations.length === 0 && detail.observationIds && detail.observationIds.length > 0 && (
            <div>
              <h3 className="font-medium text-[var(--color-text-primary)] mb-2">Observation IDs</h3>
              <div className="flex flex-wrap gap-1.5" data-testid="proposal-observations">
                {(detail.observationIds as number[]).map((oid) => (
                  <a
                    key={oid}
                    href={`/observations/${oid}?project=${encodeURIComponent(project)}`}
                    className={`${BADGE_BASE} bg-gray-100 text-gray-700 dark:bg-gray-500/20 dark:text-gray-300 hover:bg-gray-200 dark:hover:bg-gray-500/40 hover:underline`}
                  >
                    #{oid}
                  </a>
                ))}
              </div>
            </div>
          )}

          {/* Reviewer info */}
          {detail.reviewer && (
            <div className="bg-[var(--color-info-bg)] border border-[var(--color-info-border)] p-3 rounded text-sm">
              <p><span className="font-medium">Reviewer:</span> {detail.reviewer}</p>
              {detail.reviewReason && <p className="mt-1"><span className="font-medium">Reason:</span> {detail.reviewReason}</p>}
              {detail.reviewedAt && <p className="mt-1 text-[var(--color-text-muted)]">Reviewed: {new Date(detail.reviewedAt).toLocaleString()}</p>}
            </div>
          )}

          {/* Timeline */}
          <div className="border border-[var(--color-border)] rounded p-4 bg-[var(--color-surface)]">
            <h3 className="font-medium text-[var(--color-text-primary)] mb-2">Timeline</h3>
            <ProposalTimeline
              createdAt={detail.createdAt}
              reviewedAt={detail.reviewedAt}
              appliedAt={detail.appliedAt}
              rolledBackAt={detail.rolledBackAt}
              status={detail.status}
            />
          </div>

          {/* Review actions — unified form (replace duplicated Approve/Reject) */}
          <div className="border-t border-[var(--color-border)] pt-4 space-y-3">
            {canApprove && (
              <ReviewActionForm
                action="approve"
                onSubmit={onApprove}
                loading={actionLoading}
                error={actionError}
              />
            )}

            {canReject && (
              <ReviewActionForm
                action="reject"
                onSubmit={onReject}
                loading={actionLoading}
                error={actionError}
              />
            )}

            {canRollback && (
              <ReviewActionForm
                action="rollback"
                onSubmit={onRollback}
                loading={actionLoading}
                error={actionError}
                requireReason={true}
              />
            )}

            {/* View Skill button (applied) */}
            {isApplied && proposal.targetName && (
              <div>
                <button
                  onClick={onViewSkill}
                  className="px-4 py-1.5 bg-blue-600 text-white text-sm rounded hover:bg-blue-700 transition-colors"
                  data-testid="proposal-view-skill-btn"
                >
                  View Skill
                </button>
              </div>
            )}
          </div>
        </>
      )}
    </div>
  );

  return createPortal(
    <div
      className="fixed inset-0 z-50 flex items-start justify-center"
      data-testid="proposal-overlay"
      role="dialog"
      aria-modal="true"
      aria-labelledby="proposal-overlay-title"
    >
      {/* Backdrop */}
      <div className="absolute inset-0 bg-black/50" onClick={onClose} />

      {/* Panel */}
      <div className={`relative bg-[var(--color-surface)] rounded-lg shadow-2xl flex flex-col ${
        mobileExpanded
          ? "inset-0 rounded-none m-0 max-w-none max-h-none"
          : "mt-4 mb-4 w-[calc(100%-16px)] sm:w-11/12 max-w-7xl max-h-[95vh] md:max-h-[90vh]"
      }`}>
        {/* Header */}
        <div className="flex items-center justify-between px-4 sm:px-6 py-3 sm:py-4 border-b border-[var(--color-border)] shrink-0">
          <div className="min-w-0">
            <div className="flex items-center gap-2 flex-wrap mb-1">
              <h2 id="proposal-overlay-title" className="text-lg sm:text-xl font-bold text-[var(--color-text-primary)] truncate">
                {detail.targetName}
              </h2>
              {renderBadge(detail.proposalType, proposalTypeHue(detail.proposalType))}
              {renderBadge(detail.status, proposalStatusHue(detail.status))}
            </div>
            {detail.sourceName && (
              <p className="text-xs text-[var(--color-text-muted)]">
                Source: {detail.sourceName}
              </p>
            )}
            <p className="text-[10px] text-[var(--color-text-muted)] font-mono">{detail.id}</p>
          </div>
          <div className="flex items-center gap-2 shrink-0">
            {/* Mobile: fullscreen toggle */}
            <button
              onClick={() => setMobileExpanded(!mobileExpanded)}
              className="p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] rounded-full md:hidden"
              aria-label={mobileExpanded ? "Exit fullscreen" : "Fullscreen"}
            >
              {mobileExpanded ? (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 8V4m0 0h4M4 4l5 5m11-1V4m0 0h-4m4 0l-5 5M4 16v4m0 0h4m-4 0l5-5m11 5l-5-5m5 5v-4m0 4h-4" />
                </svg>
              )}
            </button>
            {/* Close */}
            <button
              onClick={onClose}
              className="p-2 text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] hover:bg-[var(--color-surface-hover)] rounded-full"
              aria-label="Close proposal overlay"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto px-4 sm:px-6 py-4">
          {body}
        </div>
      </div>
    </div>,
    document.body
  );
}
