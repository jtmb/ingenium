import { Observation, PersonalityTrait } from "../schema.js";
import * as observations from "./observations.js";
import * as personality from "./personality.js";
import * as skills from "./skills.js";
import * as synthesisLlm from "./synthesis-llm.js";
import { getSetting } from "./settings.js";
import { logEvent } from "./pipeline-events.js";

export interface SynthesisResult {
  observations_processed: number;
  traits_created: number;
  traits_updated: number;
  skills_created: number;
  observations_skipped: number;
  errors: string[];
  summary: string;
}

/**
 * Maps an observation type to the most appropriate personality trait type
 * for synthesis classification.
 */
function mapObservationToTraitType(
  obsType: Observation["observation_type"],
): PersonalityTrait["trait_type"] {
  switch (obsType) {
    case "correction":   return "feedback_style";
    case "preference":   return "code_preference";
    case "pattern":      return "workflow_pattern";
    case "insight":      return "domain_knowledge";
    case "feedback":     return "feedback_style";
    case "behavior":     return "interaction_pattern";
    case "terminology":  return "terminology";
    case "workflow":     return "workflow_pattern";
    case "error":        return "priority_signal";
    case "goal":         return "priority_signal";
  }
}

/**
 * Run the synthesis pipeline: process pending observations into personality traits.
 *
 * Classification heuristics:
 *   - "correction" observations → upsert feedback_style trait
 *   - "preference" observations → upsert code_preference trait
 *   - "pattern" observations → upsert workflow_pattern trait
 *   - "terminology" observations → upsert terminology trait
 *   - "feedback" observations → update confidence on matching existing traits
 *   - "insight", "behavior", "workflow" → upsert with lower initial confidence (0.4)
 *   - "error", "goal" → upsert priority_signal with low confidence (0.3)
 *
 * Future phases will replace these heuristics with LLM-based analysis.
 */
export async function runSynthesis(projectId: string): Promise<SynthesisResult> {
  const result: SynthesisResult = {
    observations_processed: 0,
    traits_created: 0,
    traits_updated: 0,
    skills_created: 0,
    observations_skipped: 0,
    errors: [],
    summary: "",
  };

  const batch = observations.getUnprocessedBatch(projectId, 50);
  if (batch.length === 0) {
    result.summary = "No pending observations to process.";
    return result;
  }

  // Track pre-synthesis trait count to distinguish created vs updated
  const preTraitCount = personality.getTraits(projectId).length;

  // Log synthesis start
  let synthesisEventId: number | undefined;
  try {
    const evt = logEvent(
      projectId,
      "synthesis_started",
      "synthesis",
      `Synthesis started — ${batch.length} observation(s) to process`,
      `${batch.length} pending observations across ${new Set(batch.map(o => o.observation_type)).size} type(s)`,
      { batch_size: batch.length, types: [...new Set(batch.map(o => o.observation_type))] },
    );
    synthesisEventId = evt.id;
  } catch (_) { /* non-fatal */ }

  for (const obs of batch) {
    try {
      const traitType = mapObservationToTraitType(obs.observation_type);

      switch (obs.observation_type) {
        case "correction":
        case "preference":
        case "pattern":
        case "terminology": {
          // Upsert a trait — creates if new, boosts confidence if existing
          personality.upsertTrait(
            projectId,
            traitType,
            obs.content,
            undefined,          // label — derive from content later in LLM phase
            undefined,          // confidence — use default or boost on existing
            obs.id,
            obs.content,
          );
          break;
        }
        case "feedback": {
          // Update confidence on existing traits (fuzzy match by content)
          const existingTraits = personality.getTraits(projectId);
          for (const trait of existingTraits) {
            if (obs.content.toLowerCase().includes(trait.trait_value.toLowerCase())) {
              personality.updateConfidence(
                projectId,
                trait.trait_type,
                trait.trait_value,
                0.05,
              );
            }
          }
          break;
        }
        case "insight":
        case "behavior":
        case "workflow": {
          // New traits with slightly lower initial confidence
          personality.upsertTrait(
            projectId,
            traitType,
            obs.content,
            undefined,
            0.4,
            obs.id,
            obs.content,
          );
          break;
        }
        case "error":
        case "goal": {
          // Priority signals — record but don't over-weight
          personality.upsertTrait(
            projectId,
            traitType,
            obs.content,
            undefined,
            0.3,
            obs.id,
            obs.content,
          );
          break;
        }
      }

      observations.updateObservation(obs.id, { status: "processed" });
      result.observations_processed++;
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      result.errors.push(`Observation ${obs.id}: ${msg}`);
      // Mark as failed so it doesn't block future synthesis runs
      try {
        observations.updateObservation(obs.id, { status: "failed" });
      } catch {
        result.errors.push(`Observation ${obs.id}: also failed to mark as failed`);
      }
    }
  }

  // Determine how many traits were created vs updated
  const postTraitCount = personality.getTraits(projectId).length;
  result.traits_created = Math.max(0, postTraitCount - preTraitCount);

  // Traits updated: upserted observations minus the ones that were truly new
  const upsertedCount = batch.filter(o =>
    ["correction", "preference", "pattern", "terminology"].includes(o.observation_type)
  ).length;
  result.traits_updated = Math.max(0, upsertedCount - result.traits_created);

  result.summary = `Processed ${result.observations_processed} observations: ${result.traits_created} traits created, ${result.traits_updated} traits updated.`;
  if (result.errors.length > 0) {
    result.summary += ` ${result.errors.length} error(s) encountered.`;
  }

  // ── Phase 2: LLM Skill Synthesis ────────────────────────
  // If user has configured an LLM for skill synthesis, use it
  // to analyze observations and create/update skills.
  if (synthesisLlm.isLLMSynthesisConfigured(projectId)) {
    try {
      const config = synthesisLlm.getLLMSynthesisConfig(projectId);
      const endpointSetting = getSetting(projectId, "synthesis_endpoint");
      if (config && endpointSetting) {
        const existingTraits = personality.getTraits(projectId);
        const existingSkillsList = skills.listSkills(projectId);

        const llmResult = await synthesisLlm.callSynthesisLLM(
          batch, // the observations that were just processed
          existingSkillsList.map(s => ({ name: s.name, description: s.description })),
          existingTraits.map(t => ({
            trait_type: t.trait_type,
            trait_value: t.trait_value,
            confidence: t.confidence
          })),
          endpointSetting,
          config.model,
          config.apiKey,
        );

        // Execute skill create operations
        for (const skillToCreate of llmResult.skills_to_create) {
          try {
            skills.createSkill(
              projectId,
              skillToCreate.name,
              skillToCreate.description,
              skillToCreate.content,
              "learning", // category
              "llm-synthesized,auto-generated",
              1, // always_apply
            );
            result.skills_created++;

            logEvent(
              projectId, "trait_created", "synthesis",
              `Skill created: ${skillToCreate.name}`,
              skillToCreate.description.substring(0, 200),
              { skill_name: skillToCreate.name, via_llm: true },
              synthesisEventId,
            );
          } catch (err: any) {
            result.errors.push(`Skill create "${skillToCreate.name}": ${err.message}`);
          }
        }

        // Execute skill update operations
        for (const skillToUpdate of llmResult.skills_to_update) {
          try {
            const existing = skills.getSkill(projectId, skillToUpdate.name);
            if (existing) {
              const updatedContent = existing.content + `\n\n${skillToUpdate.patch}`;
              skills.updateSkill(projectId, skillToUpdate.name, updatedContent);
              logEvent(
                projectId, "trait_updated", "synthesis",
                `Skill updated: ${skillToUpdate.name}`,
                `Patch type: ${skillToUpdate.patch_type}`,
                { skill_name: skillToUpdate.name, patch_type: skillToUpdate.patch_type, via_llm: true },
                synthesisEventId,
              );
            } else {
              result.errors.push(`Skill update "${skillToUpdate.name}": not found`);
            }
          } catch (err: any) {
            result.errors.push(`Skill update "${skillToUpdate.name}": ${err.message}`);
          }
        }

        // Update summary to include skill info
        if (result.skills_created > 0 || llmResult.skills_to_update.length > 0) {
          result.summary += ` LLM synthesized ${result.skills_created} skill(s), ${llmResult.skills_to_update.filter(s => s.name).length} update(s).`;
        }
      }
    } catch (err: any) {
      result.errors.push(`LLM synthesis phase failed: ${err.message}`);
    }
  }

  // Log trait created events for the newest traits
  try {
    const allTraits = personality.getTraits(projectId);
    const newest = [...allTraits].sort((a, b) => b.created_at.localeCompare(a.created_at));
    const recentlyCreated = newest.slice(0, Math.min(result.traits_created, 5));
    for (const t of recentlyCreated) {
      logEvent(
        projectId, "trait_created", "synthesis",
        `Trait: ${t.trait_type} → ${t.trait_value.substring(0, 60)}`,
        `Confidence: ${t.confidence?.toFixed(2) ?? "N/A"}`,
        { trait_type: t.trait_type, trait_value: t.trait_value,
          confidence: t.confidence, id: t.id },
        synthesisEventId,
      );
    }
  } catch (_) { /* non-fatal */ }

  // Log synthesis completion
  try {
    logEvent(
      projectId,
      "synthesis_completed",
      "synthesis",
      `Synthesis completed — ${result.observations_processed} processed`,
      result.summary,
      { ...result },
      synthesisEventId,
    );
  } catch (_) { /* non-fatal */ }

  return result;
}

/**
 * Get synthesis pipeline status and statistics for a project.
 */
export function getSynthesisStatus(projectId: string): {
  total_observations: number;
  pending_count: number;
  processed_count: number;
  trait_count: number;
  last_synthesis_at: string | null;
} {
  const pendingCount = observations.countUnprocessed(projectId);

  // Count total observations for this project
  const allObservations = observations.getObservations(projectId, undefined, undefined, 10000);
  const processedCount = allObservations.filter(o => o.status === "processed").length;

  const traits = personality.getTraits(projectId);

  // Determine last_synthesis_at from the most recently updated processed observation
  const processedObservations = allObservations
    .filter(o => o.status === "processed")
    .sort((a, b) => b.updated_at.localeCompare(a.updated_at));

  return {
    total_observations: allObservations.length,
    pending_count: pendingCount,
    processed_count: processedCount,
    trait_count: traits.length,
    last_synthesis_at: processedObservations.length > 0 ? processedObservations[0]!.updated_at : null,
  };
}
