"use client";
import { useState, useEffect } from "react";
import { useRouter, useSearchParams } from "next/navigation";
import SettingRow from "../SettingRow";

/**
 * Config settings panel — a single row that navigates to the full Config Editor
 * page (`/config`). This is a thin redirect because the editor is too complex
 * to embed within the settings overlay.
 *
 * Uses a `mounted` guard to avoid hydration mismatch: the button text/layout
 * is identical in both renders, but the skeleton prevents a flash of incorrect
 * content before the client-side router is available.
 */
export default function ConfigPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [mounted, setMounted] = useState(false);

  useEffect(() => setMounted(true), []);

  const goToConfig = () => {
    const params = new URLSearchParams(searchParams.toString());
    params.delete("settings");
    router.push(`/config?${params.toString()}`);
  };

  return (
    <div>
      <SettingRow
        label="OpenCode Configuration"
        description="Manage opencode.json (project) and opencode.jsonc (global) — add MCP servers, plugins, skills, agents, and more."
      >
        {mounted ? (
          <button
            onClick={goToConfig}
            className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm hover:bg-blue-700 cursor-pointer"
          >
            Open Config Editor
          </button>
        ) : (
          <div className="w-36 h-8 bg-[var(--color-surface-muted)] rounded animate-pulse" />
        )}
      </SettingRow>
    </div>
  );
}
