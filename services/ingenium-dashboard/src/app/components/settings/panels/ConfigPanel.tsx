"use client";
import { useRouter, useSearchParams } from "next/navigation";
import SettingRow from "../SettingRow";

/**
 * Config settings panel — a single row that navigates to the full Config Editor
 * page (`/config`). This is a thin redirect because the editor is too complex
 * to embed within the settings overlay.
 */
export default function ConfigPanel() {
  const router = useRouter();
  const searchParams = useSearchParams();

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
        <button
          onClick={goToConfig}
          className="bg-blue-600 text-white px-4 py-1.5 rounded text-sm hover:bg-blue-700 cursor-pointer"
        >
          Open Config Editor
        </button>
      </SettingRow>
    </div>
  );
}
