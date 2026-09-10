"use client";

import { useEffect, useState } from "react";
import { api } from "@/lib/api";

export function useMemoryCapabilities(project: string, workspaceId: string | null, refreshedAt: number | null) {
  const [result, setResult] = useState<{
    project: string;
    workspaceId: string;
    canRead: boolean;
    canSave: boolean;
    reason: string | null;
  } | null>(null);

  useEffect(() => {
    if (!workspaceId) return;
    let active = true;
    let generation = 0;
    const check = async () => {
      const current = ++generation;
      setResult(null);
      try {
        // The catalog filters credential permissions; the read probe also verifies
        // private-memory workspace binding without attempting a write.
        const [catalog] = await Promise.all([
          api.mcpTools.list(project, true),
          api.memory.list(project, workspaceId, { limit: 1, tokenBudget: 1 }),
        ]);
        if (!active || current !== generation) return;
        const tools = new Set(catalog.project === project
          ? catalog.data.flatMap((category) => category.tools.filter((tool) => tool.enabled).map((tool) => tool.tool_name))
          : []);
        const canRead = tools.has("ingenium_memory_list");
        const canSave = tools.has("ingenium_memory_save") && tools.has("ingenium_memory_operation_status");
        setResult({ project, workspaceId, canRead, canSave, reason: canRead && canSave ? null
          : "Some memory controls are unavailable: required tools are disabled or not authorized for this credential." });
      } catch {
        if (active && current === generation) setResult({ project, workspaceId, canRead: false, canSave: false,
          reason: "Saved memory is unsupported or unavailable for this workspace and credential." });
      }
    };
    void check();
    window.addEventListener("focus", check);
    return () => { active = false; window.removeEventListener("focus", check); };
  }, [project, workspaceId, refreshedAt]);

  if (!workspaceId) return { canRead: false, canSave: false, reason: "Select a confirmed project workspace to use saved memory." };
  if (result?.project !== project || result.workspaceId !== workspaceId) {
    return { canRead: false, canSave: false, reason: "Checking memory tools and credential scope…" };
  }
  return result;
}
