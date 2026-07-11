import { Observation, PersonalityTrait } from "../schema.js";
import * as observations from "./observations.js";
import * as personality from "./personality.js";
import * as skills from "./skills.js";
import * as projects from "./projects.js";
import * as synthesisLlm from "./synthesis-llm.js";
import type { SynthesisLLMResult } from "./synthesis-llm.js";
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
 *   - "terminology" observations → upsert terminology trait
 *   - "feedback" observations → update confidence on matching existing traits
 *   - "behavior", "workflow" → upsert with low initial confidence (0.10)
 *   - "error", "goal" → upsert priority_signal with very low confidence (0.05)
 *   - "pattern", "insight" → implementation notes, no trait creation
 *
 * Confidence gating: new traits start below display threshold (0.3).
 * Only repeated observations of the same trait boost confidence into display range.
 *
 * Future phases will replace these heuristics with LLM-based analysis.
 */
export async function runSynthesis(projectId: string, sessionId?: string): Promise<SynthesisResult> {
  const result: SynthesisResult = {
    observations_processed: 0,
    traits_created: 0,
    traits_updated: 0,
    skills_created: 0,
    observations_skipped: 0,
    errors: [],
    summary: "",
  };

  // Read synthesis config once for event enrichment
  const gid = projects.getGlobalProject()?.id;
  const synthModel = gid ? getSetting(gid, "synthesis_model") : undefined;
  const synthEndpoint = gid ? getSetting(gid, "synthesis_endpoint") : undefined;
  const synthProvider = gid ? getSetting(gid, "synthesis_provider") : undefined;
  const projectName = projects.getProject(projectId)?.name || "unknown";

  const batch = observations.getUnprocessedBatch(projectId, 50);

  // Apply trait decay — traits untouched for 7+ days lose confidence
  const allTraits = personality.getTraits(projectId);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
  for (const trait of allTraits) {
    if (trait.updated_at < sevenDaysAgo && trait.confidence > 0.05) {
      try {
        personality.updateConfidence(projectId, trait.trait_type, trait.trait_value, -0.05);
      } catch (_) { /* non-fatal — skip on missing trait */ }
    }
  }

  if (batch.length === 0) {
    result.summary = "No pending observations to process.";
    // Log completion event so the pipeline timeline shows activity
    try {
      logEvent(projectId, "synthesis_completed", "synthesis", "No pending observations.", result.summary, { observations_processed: 0, model: synthModel, endpoint: synthEndpoint, provider: synthProvider }, undefined, sessionId);
    } catch (_) { /* non-fatal */ }
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
      { batch_size: batch.length, types: [...new Set(batch.map(o => o.observation_type))], observation_ids: batch.map(o => o.id), model: synthModel, endpoint: synthEndpoint },
      undefined,
      sessionId,
    );
    synthesisEventId = evt.id;
  } catch (_) { /* non-fatal */ }

  for (const obs of batch) {
    try {
      const traitType = mapObservationToTraitType(obs.observation_type);

      switch (obs.observation_type) {
        case "correction":
        case "preference":
        case "terminology": {
          // Only create/boost from user behavior observations, not implementation notes.
          // New traits start below display threshold (0.15), re-observation boosts by 0.15.
          const existing = personality.getTraits(projectId).find(t =>
            t.trait_type === traitType && t.trait_value === obs.content
          );
          if (existing) {
            // updateConfidence applies exact delta — avoids upsertTrait's implicit +0.1 override
            personality.updateConfidence(projectId, traitType, obs.content, 0.15);
          } else {
            personality.upsertTrait(
              projectId, traitType, obs.content, undefined, 0.15,
              obs.id, obs.content,
            );
          }
          break;
        }
        case "pattern":
        case "insight":
          // Patterns and insights are implementation notes — do NOT create personality traits.
          // They are still processed for skill synthesis in Phase 2.
          break;
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
        case "behavior":
        case "workflow": {
          // Behavior/workflow observations — low initial confidence, re-observation boosts by 0.10
          const existing = personality.getTraits(projectId).find(t =>
            t.trait_type === traitType && t.trait_value === obs.content
          );
          if (existing) {
            personality.updateConfidence(projectId, traitType, obs.content, 0.10);
          } else {
            personality.upsertTrait(
              projectId, traitType, obs.content, undefined, 0.10,
              obs.id, obs.content,
            );
          }
          break;
        }
        case "error":
        case "goal": {
          // Priority signals — very low initial confidence, re-observation boosts by 0.05
          const existing = personality.getTraits(projectId).find(t =>
            t.trait_type === traitType && t.trait_value === obs.content
          );
          if (existing) {
            personality.updateConfidence(projectId, traitType, obs.content, 0.05);
          } else {
            personality.upsertTrait(
              projectId, traitType, obs.content, undefined, 0.05,
              obs.id, obs.content,
            );
          }
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
    ["correction", "preference", "terminology", "behavior", "workflow", "error", "goal"].includes(o.observation_type)
  ).length;
  result.traits_updated = Math.max(0, upsertedCount - result.traits_created);

  result.summary = `Processed ${result.observations_processed} observations: ${result.traits_created} traits created, ${result.traits_updated} traits updated.`;
  if (result.errors.length > 0) {
    result.summary += ` ${result.errors.length} error(s) encountered.`;
  }

  // ── Phase 2: LLM Skill Synthesis ────────────────────────
  // If user has configured an LLM for skill synthesis, use it
  // to analyze observations and create/update skills.
  let llmInsights: string[] = [];
  if (synthesisLlm.isLLMSynthesisConfigured(projectId)) {
    try {
      const config = synthesisLlm.getLLMSynthesisConfig(projectId);
      const gid = projects.getGlobalProject()?.id;
      const endpointSetting = gid ? getSetting(gid, "synthesis_endpoint") : undefined;
      if (config && endpointSetting) {
        const existingTraits = personality.getTraits(projectId);
        const existingSkillsList = skills.listSkills(projectId);

        let llmResult: SynthesisLLMResult;
        try {
          llmResult = await synthesisLlm.callSynthesisLLM(
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
          llmInsights = llmResult.insights || [];
        } catch (primaryErr: any) {
          // Try backup provider if primary fails
          const backupModel = gid ? getSetting(gid, "synthesis_backup_model") : undefined;
          const backupEndpoint = gid ? getSetting(gid, "synthesis_backup_endpoint") : undefined;
          const backupApiKey = gid ? getSetting(gid, "synthesis_backup_api_key") : undefined;

          if (backupModel && backupEndpoint) {
            try {
              llmResult = await synthesisLlm.callSynthesisLLM(
                batch,
                existingSkillsList.map(s => ({ name: s.name, description: s.description })),
                existingTraits.map(t => ({
                  trait_type: t.trait_type,
                  trait_value: t.trait_value,
                  confidence: t.confidence
                })),
                backupEndpoint,
                backupModel,
                backupApiKey || undefined,
              );
              llmInsights = llmResult.insights || [];
            } catch (backupErr: any) {
              // Both primary and backup failed
              throw new Error(`Synthesis LLM failed (primary: ${primaryErr.message}, backup: ${backupErr.message})`);
            }
          } else {
            // No backup configured — re-throw primary error
            throw primaryErr;
          }
        }

        // Execute skill create operations
        for (const skillToCreate of llmResult.skills_to_create) {
          try {
            const fileTree = skillToCreate.reference_files && skillToCreate.reference_files.length > 0
              ? JSON.stringify(Object.fromEntries(skillToCreate.reference_files.map(rf => [rf.path, rf.content])))
              : undefined;
            skills.createSkill(
              projectId,
              skillToCreate.name,
              skillToCreate.description,
              skillToCreate.content,
              "learning", // category
              "llm-synthesized,auto-generated",
              1, // always_apply
              fileTree,
            );
            result.skills_created++;

            logEvent(
              projectId, "trait_created", "synthesis",
              `Skill created: ${skillToCreate.name}`,
              skillToCreate.description.substring(0, 200),
              { skill_name: skillToCreate.name, via_llm: true, model: synthModel, observation_ids: batch.map(o => o.id), project_name: projectName },
              synthesisEventId,
              sessionId,
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
                { skill_name: skillToUpdate.name, patch_type: skillToUpdate.patch_type, via_llm: true, model: synthModel, observation_ids: batch.map(o => o.id), project_name: projectName },
                synthesisEventId,
                sessionId,
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
          confidence: t.confidence, id: t.id, observation_ids: batch.map(o => o.id), project_name: projectName, model: synthModel },
        synthesisEventId,
        sessionId,
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
      { ...result, model: synthModel, endpoint: synthEndpoint, provider: synthProvider, insights: llmInsights },
      synthesisEventId,
      sessionId,
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

/**
 * Cross-project synthesis: identifies patterns present in 2+ projects
 * and promotes them to the global-default project as shared skills and traits.
 */
export async function runCrossProjectSynthesis(): Promise<SynthesisResult> {
  const result: SynthesisResult = {
    observations_processed: 0,
    traits_created: 0,
    traits_updated: 0,
    skills_created: 0,
    observations_skipped: 0,
    errors: [],
    summary: "",
  };

  try {
    logEvent(
      "global-default",
      "synthesis_started",
      "synthesis",
      "Cross-project synthesis started",
      "Evaluating patterns across all non-global projects",
    );
  } catch (_) { /* non-fatal */ }

  // Find global project
  const globalProject = projects.getGlobalProject();
  if (!globalProject) {
    result.errors.push("No global project found. Mark a project as global first via setProjectGlobal().");
    result.summary = "No global project configured.";
    return result;
  }

  // Find all non-global, non-archived projects
  const allProjects = projects.listProjects();
  const nonGlobalProjects = allProjects.filter(
    p => !p.is_global && !p.archived_at && p.id !== globalProject.id,
  );

  if (nonGlobalProjects.length === 0) {
    result.summary = "No non-global projects found for cross-project synthesis.";
    return result;
  }

  // ── Skill frequency analysis ──
  // Build map: skillName -> { projectIds[], sample skill }
  const skillMap = new Map<string, { projectIds: string[]; sampleSkill: any }>();

  for (const proj of nonGlobalProjects) {
    try {
      const projSkills = skills.listSkills(proj.id);
      for (const sk of projSkills) {
        const entry = skillMap.get(sk.name);
        if (entry) {
          entry.projectIds.push(proj.id);
        } else {
          skillMap.set(sk.name, { projectIds: [proj.id], sampleSkill: sk });
        }
      }
    } catch (err) {
      // Skip projects that fail to load skills
    }
  }

  // Promote skills present in 2+ projects to global-default
  for (const [skillName, { projectIds, sampleSkill }] of skillMap) {
    if (projectIds.length < 2) continue;

    try {
      const existing = skills.getSkill(globalProject.id, skillName);
      if (!existing) {
        const sourceSkill = skills.getSkill(sampleSkill.project_id || projectIds[0]!, skillName);
        const fileTree = (sourceSkill as any)?.file_tree || undefined;
        skills.createSkill(
          globalProject.id,
          sampleSkill.name,
          `[Cross-project] ${sampleSkill.description}`,
          sampleSkill.content,
          "global",
          "cross-project,auto-generated",
          1,
          fileTree,
        );
        result.skills_created++;

        try {
          logEvent(
            globalProject.id,
            "trait_created",
            "synthesis",
            `Cross-project skill created: ${skillName}`,
            `Promoted from ${projectIds.length} projects`,
            { skill_name: skillName, project_count: projectIds.length, cross_project: true },
          );
        } catch (_) { /* non-fatal */ }
      } else {
        // Update description to note cross-project nature
        const updatedDesc = existing.description.includes("[Cross-project]")
          ? existing.description
          : `[Cross-project] ${existing.description}`;
        skills.updateSkill(globalProject.id, skillName, existing.content, updatedDesc);
      }
    } catch (err: any) {
      result.errors.push(`Skill "${skillName}": ${err.message}`);
    }
  }

  // ── Cross-project traits ──
  // Aggregate traits from all non-global projects
  const traitMap = new Map<string, { count: number; trait: any }>();
  for (const proj of nonGlobalProjects) {
    try {
      const traits = personality.getTraits(proj.id);
      for (const t of traits) {
        if (t.confidence < 0.7) continue;
        const key = `${t.trait_type}::${t.trait_value}`;
        const entry = traitMap.get(key);
        if (entry) {
          entry.count++;
        } else {
          traitMap.set(key, { count: 1, trait: t });
        }
      }
    } catch (_) { /* skip */ }
  }

  // Promote traits with confidence ≥ 0.7 present in 2+ projects to global-default
  for (const [, { count, trait }] of traitMap) {
    if (count < 2) continue;

    try {
      personality.upsertTrait(
        globalProject.id,
        trait.trait_type,
        trait.trait_value,
        trait.display_label,
        trait.confidence,
        trait.exemplar_observation_id,
        trait.exemplar_text,
      );
      result.traits_created++;
    } catch (err: any) {
      result.errors.push(`Trait "${trait.trait_value}": ${err.message}`);
    }
  }

  result.summary = `Cross-project synthesis complete: ${result.skills_created} skill(s) promoted, ${result.traits_created} trait(s) aggregated from ${nonGlobalProjects.length} project(s).`;
  if (result.errors.length > 0) {
    result.summary += ` ${result.errors.length} error(s) encountered.`;
  }

  try {
    logEvent(
      globalProject.id,
      "synthesis_completed",
      "synthesis",
      "Cross-project synthesis completed",
      result.summary,
      { ...result },
    );
  } catch (_) { /* non-fatal */ }

  return result;
}
