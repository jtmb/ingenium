"use client";

type FieldDef = {
  key: string;
  label: string;
  /** Renderer for the metadata value (optional — defaults to string). */
  render?: (value: unknown) => string;
};

type MetadataCompareTableProps = {
  current: Record<string, unknown> | null;
  proposed: Record<string, unknown>;
  fields: FieldDef[];
};

/**
 * Three-column table (Field, Current, Proposed) for comparing metadata fields.
 *
 * Rows where the current value differs from the proposed value are highlighted
 * with a subtle background tint. For `create` proposals, `current` is `null`
 * and every row shows "—".
 */
export default function MetadataCompareTable({ current, proposed, fields }: MetadataCompareTableProps) {
  const isNew = current === null;

  return (
    <div>
      <h3 className="font-medium text-[var(--color-text-primary)] mb-2">Metadata Changes</h3>
      <div className="border border-[var(--color-border)] rounded overflow-hidden">
        {/* Header */}
        <div className="grid grid-cols-3 px-4 py-2.5 bg-[var(--color-surface-muted)] border-b border-[var(--color-border)] text-xs font-semibold text-[var(--color-text-secondary)] uppercase tracking-wide">
          <span>Field</span>
          <span>Current</span>
          <span>Proposed</span>
        </div>

        {/* Rows */}
        {fields.map((field) => {
          const currentValue = isNew ? undefined : current?.[field.key];
          const proposedValue = proposed[field.key];
          const currentStr = isNew
            ? "—"
            : currentValue !== undefined && currentValue !== null
              ? field.render?.(currentValue) ?? String(currentValue)
              : "—";
          const proposedStr =
            proposedValue !== undefined && proposedValue !== null
              ? field.render?.(proposedValue) ?? String(proposedValue)
              : "—";
          const hasChanged = !isNew && currentStr !== proposedStr;

          return (
            <div
              key={field.key}
              className={`grid grid-cols-3 px-4 py-2 border-b border-[var(--color-border-muted)] last:border-b-0 text-sm ${
                hasChanged
                  ? "bg-[var(--color-warning-bg)]"
                  : isNew
                    ? "bg-[var(--color-success-bg)]"
                    : ""
              }`}
              data-testid={`metadata-row-${field.key}`}
            >
              <span className="font-medium text-[var(--color-text-primary)]">
                {field.label}
              </span>
              <span
                className={`text-[var(--color-text-secondary)] font-mono text-xs truncate ${
                  hasChanged ? "line-through decoration-red-400" : ""
                }`}
                title={currentStr}
              >
                {currentStr}
              </span>
              <span
                className={`font-mono text-xs truncate ${
                  hasChanged
                    ? "text-[var(--color-success-text)]"
                    : isNew
                      ? "text-[var(--color-success-text)]"
                      : "text-[var(--color-text-secondary)]"
                }`}
                title={proposedStr}
              >
                {proposedStr}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
