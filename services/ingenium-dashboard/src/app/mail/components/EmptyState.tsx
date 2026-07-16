"use client";

/**
 * EmptyState — centered placeholder with an optional action button.
 * Used when there's no data to display (no accounts, no emails, etc.).
 *
 * @param message — The text to display in the empty state center.
 * @param action — Optional action button (e.g., "Add Account", "Compose").
 */
export default function EmptyState({
  message,
  action,
}: {
  message: string;
  action?: { label: string; onClick: () => void };
}) {
  return (
    <div className="flex flex-col items-center justify-center py-16 text-center">
      <p className="text-[var(--color-text-muted)] text-sm mb-4">{message}</p>
      {action && (
        <button
          onClick={action.onClick}
          className="bg-blue-600 text-white py-2 px-4 rounded text-sm font-medium"
        >
          {action.label}
        </button>
      )}
    </div>
  );
}
