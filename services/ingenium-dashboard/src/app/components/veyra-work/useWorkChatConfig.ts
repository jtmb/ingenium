"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import type { ChatConfigResponse, ChatProviderInfo, ChatProviderModel } from "@/lib/api";
import type { OpenCodeClient } from "@/lib/opencode";

export type WorkChatConfig = Omit<ChatConfigResponse, "providers" | "defaultSelection"> & {
  providers: Array<Omit<ChatProviderInfo, "models"> & { models: Array<ChatProviderModel & { variants?: Record<string, { reasoningEffort?: string }> }> }>;
  defaultSelection: { providerId: string; modelId: string; variant?: string } | null;
};

export function useWorkChatConfig(client: OpenCodeClient) {
  const generation = useRef(0);
  const mounted = useRef(false);
  const [snapshot, setSnapshot] = useState<{ client: OpenCodeClient; config: WorkChatConfig | null; loading: boolean; error: string | null }>({ client, config: null, loading: true, error: null });
  const refresh = useCallback(async () => {
    const request = ++generation.current;
    setSnapshot((current) => ({ client, config: current.client === client ? current.config : null, loading: true, error: null }));
    try {
      const config: WorkChatConfig = await client.chat.config();
      if (mounted.current && generation.current === request) setSnapshot({ client, config, loading: false, error: null });
    } catch (error: unknown) {
      if (mounted.current && generation.current === request) setSnapshot((current) => ({ ...current, loading: false,
        error: error instanceof Error ? error.message : "Model configuration unavailable" }));
    }
  }, [client]);

  useEffect(() => {
    mounted.current = true;
    const changed = () => { void refresh(); };
    changed();
    window.addEventListener("veyra-chat-defaults-changed", changed);
    return () => { mounted.current = false; generation.current++; window.removeEventListener("veyra-chat-defaults-changed", changed); };
  }, [refresh]);
  return snapshot.client === client ? { ...snapshot, refresh } : { client, config: null, loading: true, error: null, refresh };
}
