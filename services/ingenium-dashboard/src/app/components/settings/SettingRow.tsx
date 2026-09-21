interface SettingRowProps {
  label: string;
  description?: string;
  controlId?: string;
  children: React.ReactNode;
}

/**
 * Reusable labelled row layout for settings panels — label + description on the
 * left, arbitrary control (input, select, button) on the right. Consistent
 * spacing and border-top separator across all panels.
 */
export default function SettingRow({ label, description, controlId, children }: SettingRowProps) {
  return (
    <div className="flex flex-col items-stretch gap-2 px-6 py-4 border-t border-[var(--color-border)] sm:flex-row sm:items-center sm:justify-between sm:gap-6">
      <div className="min-w-0 w-full sm:flex-1">
        <label htmlFor={controlId} className="text-sm font-medium text-[var(--color-text-primary)]">{label}</label>
        {description && (
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{description}</p>
        )}
      </div>
      <div className="min-w-0 w-full sm:w-auto sm:shrink-0">
        {children}
      </div>
    </div>
  );
}
