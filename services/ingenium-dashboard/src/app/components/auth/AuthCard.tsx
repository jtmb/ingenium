import type { ReactNode } from "react";

export const authInput = "w-full rounded-md border border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-2 text-[var(--color-text-primary)] focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[var(--color-text-link)]";

export default function AuthCard({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <main className="flex min-h-dvh items-center justify-center bg-[var(--color-surface-muted)] p-4">
    <section className="w-full max-w-md rounded-xl border border-[var(--color-border)] bg-[var(--color-surface)] p-6 hover:shadow-md transition-shadow" aria-labelledby="auth-title">
      <h1 id="auth-title" className="text-2xl font-bold text-[var(--color-text-primary)]">{title}</h1>
      {description && <p className="mt-2 text-sm text-[var(--color-text-secondary)]">{description}</p>}
      <div className="mt-6">{children}</div>
    </section>
  </main>;
}
