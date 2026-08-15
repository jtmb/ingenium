"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import OpenCodeFrame from "../components/OpenCodeFrame";
import OpenCodeToolbar from "../components/OpenCodeToolbar";
import { useOpenCodeMode } from "@/lib/open-code-mode";

/**
 * OpenCode page — dual-mode interface: Web, CLI.
 *
 * Renders iframe-based OpenCode interface with toolbar. Both iframes
 * persist in the DOM after first mount. The inactive iframe is hidden via
 * opacity/visibility/pointer-events instead of display:none to prevent
 * xterm dimension zeroing on the CLI side.
 *
 * Mode is persisted to localStorage under the `opencode-mode` key.
 * The legacy "chat" value is gracefully redirected to "web" since Chat
 * is now a standalone page at /chat.
 */
export default function OpenCodePage() {
  return (
    <Suspense fallback={<div className="h-full bg-black" />}>
      <OpenCodeContent />
    </Suspense>
  );
}

function OpenCodeContent() {
  const searchParams = useSearchParams();
  const { mode, cliMounted, changeMode } = useOpenCodeMode(searchParams.get("mode"));
  const [connectionStatus, setConnectionStatus] = useState<"pending" | "connected" | "error">("pending");

  return (
    <div className="flex flex-col h-full min-h-0">
      <OpenCodeToolbar
        mode={mode}
        onModeChange={changeMode}
        status={connectionStatus}
      />
      <div className="flex-1 relative bg-black">
        <OpenCodeFrame
          mode={mode}
          cliMounted={cliMounted}
          onConnectionStatusChange={setConnectionStatus}
        />
      </div>
    </div>
  );
}
