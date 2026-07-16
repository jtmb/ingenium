interface SettingRowProps {
  label: string;
  description?: string;
  children: React.ReactNode;
}

/**
 * Reusable labelled row layout for settings panels — label + description on the
 * left, arbitrary control (input, select, button) on the right. Consistent
 * spacing and border-top separator across all panels.
 */
export default function SettingRow({ label, description, children }: SettingRowProps) {
  return (
    <div className="flex items-center justify-between gap-6 px-6 py-4 border-t border-[var(--color-border)]">
      <div className="min-w-0 flex-shrink">
        <label className="text-sm font-medium text-[var(--color-text-primary)]">{label}</label>
        {description && (
          <p className="text-xs text-[var(--color-text-muted)] mt-0.5">{description}</p>
        )}
      </div>
      <div className="flex-shrink-0">
        {children}
      </div>
    </div>
  );
}
