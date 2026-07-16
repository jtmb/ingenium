"use client";

import { usePathname, useRouter, useSearchParams } from "next/navigation";
import { tabForPathname } from "./tabs";

/**
 * Gear-button in the nav bar that opens the settings overlay.
 *
 * Uses the current pathname to auto-select the relevant tab via `tabForPathname`,
 * enabling deep-linking: e.g., clicking the gear icon while on `/mail` opens
 * Settings → Mail directly. The `?settings=<tab>` search param drives the overlay.
 *
 * `scroll: false` prevents the page from jumping when the URL search param changes.
 */
export default function SettingsLauncher() {
  const pathname = usePathname();
  const router = useRouter();
  const searchParams = useSearchParams();

  const isOpen = searchParams.has("settings");

  const handleClick = () => {
    const tab = tabForPathname(pathname);
    const params = new URLSearchParams(searchParams.toString());
    params.set("settings", tab);
    router.replace(`${pathname}?${params.toString()}`, { scroll: false });
  };

  return (
    <button
      onClick={handleClick}
      title="Settings"
      aria-label="Settings"
      className={`p-1.5 rounded hover:bg-[var(--color-surface-hover)] ${
        isOpen ? "bg-[var(--color-surface-muted)]" : ""
      }`}
    >
      <svg
        className="w-5 h-5 text-[var(--color-text-secondary)]"
        fill="none"
        stroke="currentColor"
        viewBox="0 0 24 24"
      >
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z"
        />
        <path
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={2}
          d="M15 12a3 3 0 11-6 0 3 3 0 016 0z"
        />
      </svg>
    </button>
  );
}
