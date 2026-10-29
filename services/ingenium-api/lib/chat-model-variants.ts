import { isSafeBrowserIdentifier } from "./browser-safe-scalars.js";
export type ChatVariants = Record<string, { reasoningEffort?: string }>;
// V2 returns arrays; retained catalogs use records. Publish no settings or credentials.
export function chatModelVariants(value: unknown): ChatVariants {
  const entries: Array<[unknown, unknown]> = Array.isArray(value)
    ? value.flatMap(item => item && typeof item === "object" && "id" in item ? [[item.id, item.settings] as [unknown, unknown]] : [])
    : value && typeof value === "object" ? Object.entries(value) : [];
  return Object.fromEntries(entries.flatMap(([id, settings]) => {
    if (!isSafeBrowserIdentifier(id)) return [];
    const effort = settings && typeof settings === "object" && "reasoningEffort" in settings
      ? settings.reasoningEffort : undefined;
    return [[id, isSafeBrowserIdentifier(effort) ? { reasoningEffort: effort } : {}]];
  }));
}
