"use client";

import { useState, useEffect, useRef } from "react";
import {
  normalizeOpenCodeProviderCatalog,
  opencode,
  type OpenCodeProvider,
  type OpenCodeAgent,
} from "./opencode";

export interface FlattenedModel {
  id: string;
  providerID: string;
  providerName: string;
  name: string;
  capabilities?: {
    temperature?: boolean;
    reasoning?: boolean;
    attachment?: boolean;
    toolcall?: boolean;
    input?: { text?: boolean; image?: boolean; audio?: boolean; video?: boolean };
    output?: { text?: boolean; image?: boolean; audio?: boolean };
  };
  cost?: { input: number; output: number; cache?: { read: number; write: number } };
  limit?: { context: number; input?: number; output?: number };
  status?: string;
  variants?: Record<string, { reasoningEffort?: string }>;
}

export interface UseOpenCodeProvidersReturn {
  providers: OpenCodeProvider[];
  models: FlattenedModel[];
  agents: OpenCodeAgent[];
  /** Raw `default` field from the providers response — maps providerID → modelID. */
  defaults: Record<string, string> | null;
  isLoading: boolean;
  error: string | null;
}

/**
 * React hook that fetches OpenCode providers, models, and agents.
 *
 * - Flattens provider.models into a single models array suitable for
 *   dropdown selection (model.id, model.name, model.providerName, etc.)
 * - Fetches both providers and agents on mount
 */
export function useOpenCodeProviders(
  directory?: string,
): UseOpenCodeProvidersReturn {
  const [providers, setProviders] = useState<OpenCodeProvider[]>([]);
  const [models, setModels] = useState<FlattenedModel[]>([]);
  const [agents, setAgents] = useState<OpenCodeAgent[]>([]);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [defaults, setDefaults] = useState<Record<string, string> | null>(null);
  const mountedRef = useRef(true);

  useEffect(() => {
    mountedRef.current = true;
    let cancelled = false;

    async function load() {
      try {
        setError(null);
        setIsLoading(true);

        const [providersRes, agentsRes] = await Promise.all([
          opencode.providers.list(directory),
          opencode.agents.list(),
        ]);

        if (cancelled || !mountedRef.current) return;

        // Keep the hook safe when a test double, an older proxy, or a future
        // upstream client bypasses the canonical provider DTO.
        const providerList = normalizeOpenCodeProviderCatalog(providersRes).providers;
        const agentList = Array.isArray(agentsRes) ? agentsRes : [];
        setProviders(providerList);
        setAgents(agentList);
        setDefaults(Object.fromEntries(
          providerList
            .filter((provider) => provider.defaultModel)
            .map((provider) => [provider.id, provider.defaultModel as string]),
        ));

        // Flatten models from all providers
        const flattened: FlattenedModel[] = [];
        for (const provider of providerList) {
          for (const model of provider.models) {
            flattened.push({
              id: model.id,
              providerID: provider.id,
              providerName: provider.label,
              name: model.label,
            });
          }
        }

        setModels(flattened);
      } catch (err: unknown) {
        if (cancelled || !mountedRef.current) return;
        setError(
          err instanceof Error ? err.message : "Failed to load providers",
        );
      } finally {
        if (!cancelled && mountedRef.current) setIsLoading(false);
      }
    }

    load();

    return () => {
      cancelled = true;
      mountedRef.current = false;
    };
  }, [directory]);

  return { providers, models, agents, defaults, isLoading, error };
}
