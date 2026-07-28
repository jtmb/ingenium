/** Shared provider normalization utilities used by PipelinePanel and ChatShell. */

import type { FlattenedModel } from "./use-opencode-providers";

// Re-export FlattenedModel so importers can get it from one place
export type { FlattenedModel };

type ProviderWithModels = {
  name?: string;
  label?: string;
  models?: unknown;
};

/**
 * Extract model entries from a provider object.
 * Works with both OpenCodeProvider and raw provider objects (PipelinePanel).
 */
export function providerModels(
  p: ProviderWithModels | undefined,
): [string, unknown][] {
  if (!p || !p.models) return [];
  if (Array.isArray(p.models)) {
    return p.models.flatMap((model, index): [string, unknown][] => {
      if (typeof model === "string") return [[model, model]];
      if (!model || typeof model !== "object") return [];
      const id = "id" in model && typeof model.id === "string" ? model.id : String(index);
      return [[id, model]];
    });
  }
  if (typeof p.models !== "object") return [];
  return Object.entries(p.models as Record<string, unknown>);
}

/**
 * Sort providers for a dropdown: known providers first with a fixed ranking,
 * then alphabetically. Filters out providers with no models.
 */
export function sortProviders<T extends ProviderWithModels>(
  providers: T[],
): T[] {
  const pinned: [string, number][] = [
    ["opencode zen", 0],
    ["opencode pro", 1],
    ["opencode", 2],
    ["go", 3],
    ["deepseek", 4],
    ["zen", 5],
  ];
  const rank = (p: T): number => {
    const name = (p.name ?? p.label ?? "").toLowerCase();
    for (const [kw, r] of pinned) {
      if (name.includes(kw)) return r;
    }
    return 999;
  };
  return [...providers]
    .filter((p) => providerModels(p).length > 0)
    .sort((a, b) => {
      const ar = rank(a);
      const br = rank(b);
      if (ar !== br) return ar - br;
      return (a.name ?? a.label ?? "").localeCompare(b.name ?? b.label ?? "");
    });
}

/**
 * Resolve a model ID across providers. Given a providerId and modelId string,
 * looks up the model in the flattened models list. Returns the model if found,
 * or undefined.
 *
 * This is useful for cases where a stored model ID may belong to a different
 * provider than the currently-selected one (e.g., after provider switching).
 */
export function normalizeModelId(
  providerId: string,
  modelId: string,
  models: FlattenedModel[] | undefined,
): FlattenedModel | undefined {
  const modelList = Array.isArray(models) ? models : [];
  // First try: exact match on providerID + model id
  const exact = modelList.find(
    (m) => m.providerID === providerId && m.id === modelId,
  );
  if (exact) return exact;

  // Fallback: any model matching the ID (across any provider)
  return modelList.find((m) => m.id === modelId);
}
