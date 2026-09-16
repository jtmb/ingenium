"use client";

import { useState } from "react";
import OpenCodeFrame from "../components/OpenCodeFrame";
import OpenCodeToolbar from "../components/OpenCodeToolbar";
import type { OpenCodeMode } from "@/lib/open-code-mode";
import { useOpenCodeMode } from "@/lib/use-open-code-mode";

export default function OpenCodePageClient({
  initialMode,
  restoreStoredMode,
}: {
  initialMode: OpenCodeMode;
  restoreStoredMode: boolean;
}) {
  const { mode, cliMounted, changeMode } = useOpenCodeMode(initialMode, restoreStoredMode);
  const [connectionStatus, setConnectionStatus] = useState<"pending" | "connected" | "error">("pending");

  return (
    <div className="flex flex-col h-full min-h-0">
      <OpenCodeToolbar mode={mode} onModeChange={changeMode} status={connectionStatus} />
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
