"use client";
import { useEffect } from "react";
import { useRouter } from "next/navigation";

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
