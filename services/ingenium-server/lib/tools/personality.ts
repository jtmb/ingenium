/**
 * MCP tool handlers for the personality profile pipeline.
 * 🔴 DB ISOLATION: MCP tool wrapper — proxies to API via HTTP, no direct DB access.
 * Supports fetching aggregated profiles, listing traits, upserting, dismissing, disabling, and deleting traits.
 */
import { api } from "../client.js";

/** Get personality profile (aggregated) */
export async function personalityProfile(project: string) {
  const res = await api.get("/personality/profile", { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** List traits with optional type filter */
export async function personalityTraits(project: string, traitType?: string) {
  const params: Record<string, string> = { project };
  if (traitType) params.trait_type = traitType;
  const res = await api.get("/personality", params);
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Upsert a trait (used by synthesis pipeline) */
export async function personalitySetTrait(project: string, traitType: string, traitValue: string, displayLabel?: string, confidence?: number) {
  const res = await api.post("/personality", {
    trait_type: traitType,
    trait_value: traitValue,
    display_label: displayLabel,
    confidence,
  }, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Dismiss a trait (set as inactive without deleting) */
export async function personalityTraitDismiss(project: string, traitId: number) {
  const res = await api.post(`/personality/${traitId}/dismiss`, {}, { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Disable a trait (harder deactivation) */
export async function personalityTraitDisable(project: string, traitId: number) {
  const res = await api.post(`/personality/${traitId}/disable`, {}, { project });
  if (res.status === 204) {
    return { content: [{ type: "text" as const, text: JSON.stringify({ disabled: traitId }) }] };
  }
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Hard delete a single personality trait */
export async function personalityTraitDelete(project: string, traitId: number) {
  const res = await api.del(`/personality/${traitId}`, { project });
  if (res.status === 204) {
    return { content: [{ type: "text" as const, text: JSON.stringify({ deleted: traitId }) }] };
  }
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}

/** Hard delete ALL personality traits for the project — 🔴 requires confirm === true */
export async function personalityTraitsDeleteAll(project: string, confirm: boolean) {
  if (confirm !== true) {
    return {
      content: [{
        type: "text" as const,
        text: JSON.stringify({ error: "SAFETY_GUARD", message: "Set confirm=true to delete ALL personality traits for this project." }),
      }],
    };
  }
  const res = await api.del("/personality", { project });
  return { content: [{ type: "text" as const, text: JSON.stringify(res.data) }] };
}
