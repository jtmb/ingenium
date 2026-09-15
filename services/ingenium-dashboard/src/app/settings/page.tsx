"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

/** Build the overlay URL without dropping project, query, or fragment context. */
export function buildSettingsRedirectUrl(search: string, hash: string): string {
  const params = new URLSearchParams(search);
  if (!params.has("settings")) params.set("settings", "general");
  const query = params.toString();
  return `/${query ? `?${query}` : ""}${hash}`;
}

/**
 * SettingsPage — Redirect-only page.
 *
 * Settings are rendered as a full-screen overlay on the home page
 * (triggered by the `?settings=` query param). This page exists so the
 * sidebar nav has a `/settings` target; it immediately redirects to the
 * home page with the settings overlay open to the General tab.
 */
export default function SettingsPage() {
  const router = useRouter();
  useEffect(() => {
    router.replace(buildSettingsRedirectUrl(window.location.search, window.location.hash), { scroll: false });
  }, [router]);
  return (
    <p className="p-6 text-[var(--color-text-muted)] animate-pulse">
      Redirecting to settings...
    </p>
  );
}
