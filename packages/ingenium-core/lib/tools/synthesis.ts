import * as observations from "./observations.js";
import * as personality from "./personality.js";
import * as skills from "./skills.js";
import * as projects from "./projects.js";
import * as synthesisLlm from "./synthesis-llm.js";
import type { SynthesisLLMResult } from "./synthesis-llm.js";
import { getSetting } from "./settings.js";
import { logEvent } from "./pipeline-events.js";
import { logger } from "../logger.js";

function safeParseJson(str: string): Record<string, any> {
  try { return JSON.parse(str); } catch { return {}; }
}

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

  // ── Phase 1: Trait Consolidation via LLM ──
  // Load existing active traits for the consolidation prompt
  const existingActiveTraits = personality.getTraits(projectId);

  const consolidation = await synthesisLlm.consolidateTraits(
    projectId,
    batch.map(o => ({ id: o.id, observation_type: o.observation_type, content: o.content })),
    existingActiveTraits.map(t => ({ id: t.id, trait_type: t.trait_type, trait_value: t.trait_value, confidence: t.confidence })),
  );

  if (!consolidation) {
    // LLM not configured or unavailable — leave observations PENDING for a future cycle
    const reason = synthesisLlm.isLLMSynthesisConfigured(projectId)
      ? "LLM consolidation API unreachable — leaving observations pending for retry"
      : "LLM synthesis not configured — leaving observations pending until configured";
    result.summary = reason;
    result.errors.push(reason);
    try {
      logEvent(
        projectId, "synthesis_completed", "synthesis",
        "Synthesis skipped — LLM unavailable",
        reason,
        { ...result, model: synthModel, endpoint: synthEndpoint, provider: synthProvider },
        synthesisEventId,
        sessionId,
      );
    } catch (_) { /* non-fatal */ }
    return result;
  }

  // Collect all observation IDs referenced by the LLM
  const involvedObsIds = new Set<number>();
  for (const c of consolidation.create) {
    for (const oid of c.observation_ids) involvedObsIds.add(oid);
  }
  for (const c of consolidation.confirm) {
    involvedObsIds.add(c.observation_id);
  }

  // Execute CREATE operations
  for (const toCreate of consolidation.create) {
    try {
      const clampedConfidence = Math.min(0.15, Math.max(0.10, toCreate.confidence_hint));
      // Use the first observation_id as the exemplar
      const exemplarObsId = toCreate.observation_ids[0];
      const exemplarObs = exemplarObsId ? batch.find(o => o.id === exemplarObsId) : undefined;

      personality.upsertTrait(
        projectId,
        toCreate.trait_type,
        toCreate.trait_value,
        undefined, // label
        clampedConfidence,
        exemplarObsId,
        exemplarObs?.content, // USE observation content as exemplar text (not trait_value — that's normalized)
      );
      result.traits_created++;

      // Log trait_created event with normalized value
      try {
        logEvent(
          projectId, "trait_created", "synthesis",
          `Trait created: ${toCreate.trait_type} → ${toCreate.trait_value.substring(0, 60)}`,
          `Normalized from ${toCreate.observation_ids.length} observation(s), confidence: ${clampedConfidence.toFixed(2)}`,
          {
            trait_type: toCreate.trait_type,
            trait_value: toCreate.trait_value,
            confidence: clampedConfidence,
            observation_ids: toCreate.observation_ids,
            project_name: projectName,
            model: synthModel,
          },
          synthesisEventId,
          sessionId,
        );
      } catch (_) { /* non-fatal */ }
    } catch (err: any) {
      logger.error("synthesis", `Trait create failed: ${err.message}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n") });
      result.errors.push(`Trait create "${toCreate.trait_value?.substring(0, 30)}": ${err.message}`);
    }
  }

  // Execute CONFIRM operations
  for (const toConfirm of consolidation.confirm) {
    try {
      const trait = existingActiveTraits.find(t => t.id === toConfirm.trait_id);
      if (trait) {
        personality.updateConfidence(
          projectId,
          trait.trait_type,
          trait.trait_value,
          0.15,
        );
        result.traits_updated++;

        try {
          logEvent(
            projectId, "trait_updated", "synthesis",
            `Trait confirmed: ${trait.trait_type} → ${trait.trait_value.substring(0, 60)}`,
            `Boosted by observation #${toConfirm.observation_id}`,
            {
              trait_type: trait.trait_type,
              trait_value: trait.trait_value,
              observation_id: toConfirm.observation_id,
              project_name: projectName,
              model: synthModel,
            },
            synthesisEventId,
            sessionId,
          );
        } catch (_) { /* non-fatal */ }
      }
    } catch (err: any) {
      logger.error("synthesis", `Trait confirm failed for trait_id=${toConfirm.trait_id}: ${err.message}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n") });
      result.errors.push(`Trait confirm trait_id=${toConfirm.trait_id}: ${err.message}`);
    }
  }

  // Mark observations as processed if the LLM acted on them (CREATE or CONFIRM).
  // Observations the LLM explicitly ignored are also marked processed — the LLM
  // evaluated them and decided they're noise/unactionable. Leaving them pending
  // would re-submit them every cycle, wasting LLM tokens.
  for (const obs of batch) {
    try {
      if (involvedObsIds.has(obs.id)) {
        observations.updateObservation(obs.id, { status: "processed" });
        result.observations_processed++;
      } else {
        // Mark as processed — the LLM evaluated and chose to ignore them
        observations.updateObservation(obs.id, { status: "processed" });
        result.observations_skipped++;
      }
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err);
      const errName = err instanceof Error ? err.name : "Unknown";
      const stack = err instanceof Error ? err.stack : undefined;
      logger.error("synthesis", `Observation ${obs.id} processing failed: ${msg}`, { error: msg, name: errName, stack: stack?.split("\n").slice(0, 5).join("\n") });
      result.errors.push(`Observation ${obs.id}: ${msg}`);
      try {
        observations.updateObservation(obs.id, { status: "failed" });
      } catch {
        result.errors.push(`Observation ${obs.id}: also failed to mark as failed`);
      }
    }
  }

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
              skillToCreate.tags || "auto-generated",
              1, // always_apply
              fileTree,
            );
            result.skills_created++;

            // Best-effort disk write (createSkill already writes to disk,
            // but this provides defense-in-depth if the internal path changes)
            try {
              const skillObj = skills.getSkill(projectId, skillToCreate.name);
              if (skillObj) skills.writeSkillToDisk(skillObj);
            } catch (_) { /* non-fatal — disk write is best-effort */ }

            logEvent(
              projectId, "skill_created", "synthesis",
              `Skill created: ${skillToCreate.name}`,
              skillToCreate.description.substring(0, 200),
              { skill_name: skillToCreate.name, via_llm: true, model: synthModel, observation_ids: batch.map(o => o.id), project_name: projectName },
              synthesisEventId,
              sessionId,
            );
          } catch (err: any) {
            logger.error("synthesis", `Skill create "${skillToCreate.name}" failed: ${err.message}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n") });
            result.errors.push(`Skill create "${skillToCreate.name}": ${err.message}`);
          }
        }

        // Execute skill update operations
        for (const skillToUpdate of llmResult.skills_to_update) {
          try {
            const existing = skills.getSkill(projectId, skillToUpdate.name);
            if (existing) {
              const updatedContent = existing.content + `\n\n${skillToUpdate.patch}`;
              // Merge reference_files into existing file_tree if the update provides them
              let mergedFileTree: string | undefined;
              if (skillToUpdate.reference_files && skillToUpdate.reference_files.length > 0) {
                const existingTree = (existing as any).file_tree
                  ? JSON.parse((existing as any).file_tree)
                  : {};
                for (const rf of skillToUpdate.reference_files) {
                  existingTree[rf.path] = rf.content;
                }
                mergedFileTree = JSON.stringify(existingTree);
              }
              skills.updateSkill(projectId, skillToUpdate.name, updatedContent, undefined, undefined, undefined, mergedFileTree);
              // Best-effort disk write
              try {
                const skillObj = skills.getSkill(projectId, skillToUpdate.name);
                if (skillObj) skills.writeSkillToDisk(skillObj);
              } catch (_) { /* non-fatal */ }
              logEvent(
                projectId, "skill_updated", "synthesis",
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
            logger.error("synthesis", `Skill update "${skillToUpdate.name}" failed: ${err.message}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n") });
            result.errors.push(`Skill update "${skillToUpdate.name}": ${err.message}`);
          }
        }

        // Execute LLM personality_traits — these were silently dropped before
        if (llmResult.personality_traits && llmResult.personality_traits.length > 0) {
          for (const pt of llmResult.personality_traits) {
            try {
              const clampedConf = Math.min(0.95, Math.max(0.05, pt.confidence));
              personality.upsertTrait(
                projectId,
                pt.trait_type,
                pt.trait_value,
                undefined,
                clampedConf,
              );
              try {
                logEvent(
                  projectId, "trait_created", "synthesis",
                  `Trait (LLM): ${pt.trait_type} → ${pt.trait_value.substring(0, 60)}`,
                  `LLM-synthesized trait, confidence: ${clampedConf.toFixed(2)}`,
                  {
                    trait_type: pt.trait_type,
                    trait_value: pt.trait_value,
                    confidence: clampedConf,
                    via_llm: true,
                    model: synthModel,
                    project_name: projectName,
                  },
                  synthesisEventId,
                  sessionId,
                );
              } catch (_) { /* non-fatal */ }
            } catch (err: any) {
              logger.error("synthesis", `LLM trait "${pt.trait_value?.substring(0, 30)}" failed: ${err.message}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n") });
              result.errors.push(`LLM trait "${pt.trait_value?.substring(0, 30)}": ${err.message}`);
            }
          }
        }

        // Update summary to include skill info
        if (result.skills_created > 0 || llmResult.skills_to_update.length > 0) {
          result.summary += ` LLM synthesized ${result.skills_created} skill(s), ${llmResult.skills_to_update.filter(s => s.name).length} update(s).`;
        }
      }
    } catch (err: any) {
      logger.error("synthesis", `LLM synthesis phase failed: ${err.message}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n") });
      result.errors.push(`LLM synthesis phase failed: ${err.message}`);
    }
  }

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
          sampleSkill.tags || "cross-project,auto-generated",
          1,
          fileTree,
        );
        result.skills_created++;

        try {
          logEvent(
            globalProject.id,
            "skill_created",
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
      logger.error("synthesis", `Cross-project skill promotion "${skillName}" failed: ${err.message}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n") });
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
      logger.error("synthesis", `Cross-project trait promotion "${trait.trait_value}" failed: ${err.message}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n") });
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

/**
 * Consolidation result from the skill audit job.
 */
export interface ConsolidationResult {
  merged: number;
  deleted: number;
  summary: string;
}

/**
 * Audit all enabled skills for a project and use the LLM to propose merges/deletes,
 * condensing to ≤20 skills. This is a standalone pass that runs after synthesis,
 * not driven by new observations — it evaluates the entire skill catalog.
 */
export async function consolidateSkills(projectId: string): Promise<ConsolidationResult> {
  // Skip if LLM not configured
  const gid = projects.getGlobalProject()?.id;
  if (!gid || !synthesisLlm.isLLMSynthesisConfigured(gid)) {
    return { merged: 0, deleted: 0, summary: "LLM not configured — skipping consolidation" };
  }

  const allSkills = skills.listSkills(projectId);
  if (allSkills.length <= 20) {
    return { merged: 0, deleted: 0, summary: `${allSkills.length} skills — already ≤20, no consolidation needed` };
  }

  // Build skill summary for LLM
  const skillSummaries = allSkills.map(s => ({
    name: s.name,
    description: s.description || "",
    tags: s.tags || "",
    // First 300 chars of content for context
    content_preview: (s.content || "").substring(0, 300),
  }));

  const prompt = synthesisLlm.buildConsolidationPrompt(skillSummaries, allSkills.length);

  // Try primary LLM; fall back to backup provider on failure
  let result: synthesisLlm.ConsolidationSkillResult;
  try {
    result = await synthesisLlm.callConsolidationLLM(projectId, prompt);
  } catch (primaryErr: any) {
    logger.warn("synthesis", `Consolidation primary LLM failed: ${primaryErr.message} — trying backup`);
    result = { merges: [], delete: [] };
  }

  // If primary returned empty (or threw), try backup provider
  if (result.merges.length === 0 && result.delete.length === 0) {
    const backupModel = getSetting(gid, "synthesis_backup_model");
    const backupEndpoint = getSetting(gid, "synthesis_backup_endpoint");
    const backupApiKey = getSetting(gid, "synthesis_backup_api_key");

    if (backupModel && backupEndpoint) {
      logger.info("synthesis", "Consolidation primary returned empty — falling back to backup provider");
      try {
        result = await synthesisLlm.callConsolidationLLM(
          projectId, prompt, backupEndpoint, backupModel, backupApiKey || undefined,
        );
      } catch (backupErr: any) {
        logger.warn("synthesis", `Consolidation backup LLM also failed: ${backupErr.message}`);
      }
    }
  }

  let merged = 0;
  let deleted = 0;

  // Process merges: combine source skill into target, delete source
  for (const merge of result.merges || []) {
    try {
      const target = skills.getSkill(projectId, merge.target);
      const source = skills.getSkill(projectId, merge.source);
      if (!target || !source) continue;

      // Merge content: append source's SKILL.md after target's
      const mergedContent = `${target.content}\n\n## Merged from ${merge.source}\n\n${source.content}`;

      // Merge file_trees: combine reference files (source files prefixed)
      const targetTree = safeParseJson((target as any).file_tree || "{}");
      const sourceTree = safeParseJson((source as any).file_tree || "{}");
      for (const [key, val] of Object.entries(sourceTree)) {
        targetTree[`merged-${merge.source}/${key}`] = val;
      }

      // Merge tags
      const mergedTags = [
        ...new Set([
          ...(target.tags || "").split(",").map(t => t.trim()).filter(Boolean),
          ...(source.tags || "").split(",").map(t => t.trim()).filter(Boolean),
        ]),
      ].join(",");

      skills.updateSkill(
        projectId,
        merge.target,
        mergedContent,
        target.description || "",
        mergedTags,
        (target as any).always_apply,
        JSON.stringify(targetTree),
      );
      skills.writeSkillToDisk(skills.getSkill(projectId, merge.target)!);
      skills.deleteSkill(projectId, merge.source);
      merged++;
    } catch (e: any) {
      logger.warn("synthesis", `Merge failed: ${merge.source} → ${merge.target}: ${e.message}`);
    }
  }

  // Process deletes
  for (const name of result.delete || []) {
    try {
      skills.deleteSkill(projectId, name);
      deleted++;
    } catch (e: any) {
      logger.warn("synthesis", `Delete failed for ${name}: ${e.message}`);
    }
  }

  const summary = `Consolidated ${allSkills.length} → ${allSkills.length - merged - deleted} skills (${merged} merged, ${deleted} deleted)`;

  // Log consolidation result
  logger.info("synthesis", `Skill consolidation: ${summary}`);

  // Log pipeline event
  try {
    logEvent(
      projectId,
      "synthesis_completed",
      "synthesis",
      `Skill consolidation: ${summary}`,
      summary,
      { merged, deleted, total: allSkills.length },
      undefined,
      undefined,
    );
  } catch (_) { /* non-fatal */ }

  return { merged, deleted, summary };
}
