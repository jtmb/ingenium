"use client";

import { Suspense } from "react";
import ProjectSelector from "@/app/components/ProjectSelector";
import { useProject } from "@/lib/ProjectContext";

/**
 * Thin shared component placed at the top of every project-scoped page.
 *
 * Replaces the nav-bar ProjectSelector (removed from the global layout)
 * with a per-page, right-aligned inline selector.
 *
 * Wrapped in <Suspense> because ProjectSelector consumes
 * `useSearchParams()` which requires client-side navigation context.
 */
export default function PageProjectBar() {
  return (
    <div className="flex items-center justify-end gap-2 mb-4 text-sm text-[var(--color-text-secondary)]">
      <span className="whitespace-nowrap">Project:</span>
      <Suspense fallback={<span className="text-[var(--color-text-muted)]">Loading…</span>}>
        <ProjectSelector />
      </Suspense>
    </div>
  );
}
