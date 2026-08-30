"use client";

export default function UsageRouteError({ reset }: { error: Error & { digest?: string }; reset: () => void }) {
  return (
    <section className="rounded-xl border border-[var(--color-error-border)] bg-[var(--color-error-bg)] p-6 text-center hover:shadow-md transition-shadow" role="alert">
      <h1 className="text-lg font-semibold text-[var(--color-error-text)]">Usage analytics could not be rendered</h1>
      <p className="mt-2 text-sm text-[var(--color-text-secondary)]">Retry the route. No usage telemetry has been modified.</p>
      <button
        type="button"
        onClick={reset}
        className="mt-4 rounded-lg bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700 focus:outline-none focus:ring-2 focus:ring-[var(--color-accent)]"
      >
        Retry
      </button>
    </section>
  );
}
