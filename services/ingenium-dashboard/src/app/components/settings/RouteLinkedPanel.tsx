import Link from "next/link";
import type { SettingsTab } from "./tabs";

interface RouteLinkedPanelProps {
  tab: SettingsTab;
  destination: string;
  description: string;
}

/**
 * Settings sections whose full management UI is an existing dashboard route.
 *
 * Keeping these panels route-linked preserves the route's established data
 * loading, authorization, and mutation behavior instead of duplicating it in
 * the overlay. The panel remains a useful deep-link destination: it identifies
 * the requested Settings category and provides the direct workspace action.
 */
export default function RouteLinkedPanel({ tab, destination, description }: RouteLinkedPanelProps) {
  const titleId = `settings-panel-title-${tab.id}`;

  return (
    <section
      aria-labelledby={titleId}
      className="px-4 py-5 sm:px-6"
      data-testid={`settings-route-panel-${tab.id}`}
    >
      <h3 id={titleId} className="text-base font-semibold text-[var(--color-text-primary)]">
        {tab.label}
      </h3>
      <p className="mt-1 max-w-2xl text-sm text-[var(--color-text-muted)]">
        {description}
      </p>
      <Link
        href={destination}
        className="mt-5 inline-flex rounded bg-blue-600 px-4 py-2 text-sm font-medium text-white hover:bg-blue-700"
        data-testid={`settings-route-link-${tab.id}`}
      >
        Open {tab.label} workspace
      </Link>
    </section>
  );
}
