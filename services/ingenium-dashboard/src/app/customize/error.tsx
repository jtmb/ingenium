"use client";

export default function CustomizeError({ reset }: { reset: () => void }) {
  return <section role="alert" className="space-y-3 p-6">
    <h1 className="text-xl font-semibold">Customize unavailable</h1>
    <p>Check your connection and project access.</p>
    <button type="button" onClick={reset} className="rounded-lg border border-[var(--color-border)] px-3 py-2 focus-visible:outline-2 focus-visible:outline-blue-400">Retry</button>
  </section>;
}
