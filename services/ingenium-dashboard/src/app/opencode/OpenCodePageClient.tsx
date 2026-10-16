"use client";

import { useState } from "react";
import { request } from "@/lib/api";
import { useRuntime } from "@/lib/RuntimeContext";
import OpenCodeFrame from "../components/OpenCodeFrame";
import OpenCodeToolbar from "../components/OpenCodeToolbar";
import StepUpDialog from "../components/auth/StepUpDialog";
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
  const { workspace } = useRuntime();
  const [confirmAutomation, setConfirmAutomation] = useState(false);
  const [automationPending, setAutomationPending] = useState(false);
  const [automationStatus, setAutomationStatus] = useState("");

  const authorizeAutomation = async () => {
    setConfirmAutomation(false);
    if (workspace.mode !== "compatibility" || !workspace.confirmedWorkspaceId) return;
    setAutomationPending(true);
    setAutomationStatus("");
    try {
      await request(`/runtimes/browser/workspaces/${encodeURIComponent(workspace.confirmedWorkspaceId)}/automation`, {
        method: "POST", body: "{}",
      });
      setAutomationStatus("Background learning enabled for this runtime.");
    } catch {
      setAutomationStatus("Background learning could not be enabled. Confirm the runtime is active and try again.");
    } finally {
      setAutomationPending(false);
    }
  };

  return (
    <div className="flex flex-col h-full min-h-0">
      <OpenCodeToolbar mode={mode} onModeChange={changeMode} status={connectionStatus} />
      {workspace.mode === "compatibility" && workspace.confirmedWorkspaceId && (
        <div className="flex items-center gap-3 border-b border-[var(--color-border)] bg-[var(--color-surface)] px-3 py-1 text-xs">
          <button type="button" disabled={automationPending} onClick={() => setConfirmAutomation(true)}
            className="rounded border border-[var(--color-border)] px-2 py-1 font-medium hover:bg-[var(--color-surface-hover)] disabled:opacity-50">
            Enable background learning
          </button>
          {automationStatus && <span role="status">{automationStatus}</span>}
        </div>
      )}
      <StepUpDialog open={confirmAutomation} onClose={() => setConfirmAutomation(false)} onComplete={() => { void authorizeAutomation(); }} />
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
