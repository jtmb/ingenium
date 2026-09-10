"use client";

import { useState } from "react";

type ScoreGaugeProps = {
  value: number; // 0–1 (or 0–max for percentage-convert)
  label: string;
  max?: number; // default 1; use 100 for percentage bars
  tooltip?: string;
};

/** Explanations for each score type when tooltip is not explicitly provided. */
const DEFAULT_TOOLTIPS: Record<string, string> = {
  Quality: "Quality measures how well the proposed change aligns with existing skill patterns, conventions, and user preferences. Higher is better.",
  Novelty: "Novelty measures how unique and non-redundant the proposed content is relative to existing skills. Higher novelty means less overlap.",
  Contradiction: "Contradiction flags whether the proposal conflicts with an existing pattern or preference. A flagged proposal needs review.",
};

/**
 * A horizontal progress-bar gauge showing a score with a label and optional tooltip.
 *
 * Bar fill colour is computed from the percentage:
 *   < 33% → red, 33–66% → amber, ≥ 66% → green
 *
 * The tooltip appears on hover/tap and explains what the score means.
 */
export default function ScoreGauge({ value, label, max = 1, tooltip }: ScoreGaugeProps) {
  const [showTooltip, setShowTooltip] = useState(false);
  const pct = Math.min(100, Math.max(0, (value / max) * 100));
  const width = `${pct}%`;

  const fillColor =
    pct < 33 ? "bg-red-500" : pct < 66 ? "bg-amber-500" : "bg-green-500";

  const tooltipText = tooltip ?? DEFAULT_TOOLTIPS[label] ?? `${label} score out of ${max}`;

  return (
    <div className="relative">
      <div className="flex items-center justify-between mb-1">
        <span className="text-xs font-medium text-[var(--color-text-secondary)] uppercase tracking-wide">
          {label}
        </span>
        <span className="text-sm font-bold text-[var(--color-text-primary)] tabular-nums">
          {pct.toFixed(0)}%
        </span>
      </div>
      <div className="relative h-2.5 bg-[var(--color-surface-muted)] rounded-full overflow-hidden">
        <div
          className={`h-full rounded-full transition-all duration-500 ease-out ${fillColor}`}
          style={{ width }}
          role="progressbar"
          aria-valuenow={value}
          aria-valuemin={0}
          aria-valuemax={max}
          aria-label={`${label}: ${pct.toFixed(0)}%`}
        />
      </div>
      <button
        type="button"
        className="mt-0.5 text-[10px] text-[var(--color-text-muted)] hover:text-[var(--color-text-secondary)] cursor-help underline decoration-dotted"
        onMouseEnter={() => setShowTooltip(true)}
        onMouseLeave={() => setShowTooltip(false)}
        onFocus={() => setShowTooltip(true)}
        onBlur={() => setShowTooltip(false)}
        aria-label={`What does ${label} mean?`}
      >
        What&apos;s this?
      </button>
      {showTooltip && (
        <div
          className="absolute z-10 top-full left-0 mt-1 w-64 p-2.5 bg-[var(--color-surface-raised)] border border-[var(--color-border)] rounded shadow-lg text-xs text-[var(--color-text-secondary)] leading-relaxed"
          role="tooltip"
        >
          {tooltipText}
        </div>
      )}
    </div>
  );
}
