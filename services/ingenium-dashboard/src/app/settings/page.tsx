"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

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
    router.replace("/?settings=general");
  }, [router]);
  return (
    <p className="p-6 text-[var(--color-text-muted)] animate-pulse">
      Redirecting to settings...
    </p>
  );
}
