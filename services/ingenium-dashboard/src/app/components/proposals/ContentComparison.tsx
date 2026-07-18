"use client";

type ContentComparisonProps = {
  currentContent: string | null;
  proposedContent: string;
  currentLabel?: string;
  proposedLabel?: string;
  isNewSkill?: boolean;
};

/**
 * Side-by-side source comparison panel for current vs. proposed skill content.
 *
 * Both panels show source text only (no Markdown rendering) with identical
 * structure, sizing, and typography. On mobile (<768px), panels stack vertically.
 */
export default function ContentComparison({
  currentContent,
  proposedContent,
  currentLabel = "Current",
  proposedLabel = "Proposed",
  isNewSkill = false,
}: ContentComparisonProps) {
  return (
    <div>
      <h3 className="font-medium text-[var(--color-text-primary)] mb-2">Content Comparison</h3>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-4" data-testid="proposal-diff">
        {/* Current */}
        <div className="border border-[var(--color-border)] rounded overflow-hidden flex flex-col">
          <div className="px-3 py-2 bg-[var(--color-surface-muted)] border-b border-[var(--color-border)] shrink-0">
            <span className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">
              {currentLabel}
            </span>
          </div>
          <div className="p-3 flex-1 overflow-y-auto bg-[var(--color-surface)]" style={{ maxHeight: "400px" }}>
            {isNewSkill ? (
              <p className="text-sm text-[var(--color-text-muted)] italic">
                New skill — no current content
              </p>
            ) : currentContent !== null ? (
              <pre className="text-sm font-mono whitespace-pre-wrap text-[var(--color-text-primary)] leading-relaxed">
                {currentContent || "(empty)"}
              </pre>
            ) : (
              <p className="text-sm text-[var(--color-text-muted)] italic">Loading...</p>
            )}
          </div>
        </div>

        {/* Proposed */}
        <div className="border border-[var(--color-border)] rounded overflow-hidden flex flex-col">
          <div className="px-3 py-2 bg-[var(--color-surface-muted)] border-b border-[var(--color-border)] shrink-0">
            <span className="text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">
              {proposedLabel}
            </span>
          </div>
          <div className="p-3 flex-1 overflow-y-auto bg-[var(--color-surface)]" style={{ maxHeight: "400px" }}>
            {proposedContent ? (
              <pre className="text-sm font-mono whitespace-pre-wrap text-[var(--color-text-primary)] leading-relaxed">
                {proposedContent}
              </pre>
            ) : (
              <p className="text-sm text-[var(--color-text-muted)] italic">(no content)</p>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
