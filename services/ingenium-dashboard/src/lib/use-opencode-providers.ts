"use client";

import { useState, useEffect, useRef } from "react";
import { opencode, type OpenCodeProvider, type OpenCodeModel, type OpenCodeAgent } from "./opencode";

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

        const providerList = providersRes.all ?? [];
        setProviders(providerList);
        setAgents(agentsRes);
        setDefaults(providersRes.default ?? null);

        // Flatten models from all providers
        const flattened: FlattenedModel[] = [];
        for (const p of providerList) {
          const entries = p.models ?? {};
          for (const [_key, m] of Object.entries(entries)) {
            flattened.push({
              id: m.id,
              providerID: m.providerID,
              providerName: p.name,
              name: m.name,
              capabilities: m.capabilities,
              cost: m.cost,
              limit: m.limit,
              status: m.status,
              variants: m.variants,
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
