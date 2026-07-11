/**
 * MCP tool handlers for the personality profile pipeline.
 * Supports fetching aggregated profiles, listing traits, and upserting traits.
 */
import { api } from "../client.js";
/** Get personality profile (aggregated) */
export async function personalityProfile(project) {
    const res = await api.get("/personality/profile", { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** List traits with optional type filter */
export async function personalityTraits(project, traitType) {
    const params = { project };
    if (traitType)
        params.trait_type = traitType;
    const res = await api.get("/personality", params);
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
/** Upsert a trait (used by synthesis pipeline) */
export async function personalitySetTrait(project, traitType, traitValue, label, confidence) {
    const res = await api.post("/personality", {
        trait_type: traitType,
        trait_value: traitValue,
        display_label: label,
        confidence,
    }, { project });
    return { content: [{ type: "text", text: JSON.stringify(res.data) }] };
}
