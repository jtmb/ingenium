"use client";

/**
 * EmptyState — centered placeholder with an optional action button.
 * Used when there's no data to display (no accounts, no emails, etc.).
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
      <p className="text-gray-500 text-sm mb-4">{message}</p>
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
