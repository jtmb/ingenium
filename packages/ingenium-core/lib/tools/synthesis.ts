import * as observations from "./observations.js";
import * as personality from "./personality.js";
import * as skills from "./skills.js";
import * as projects from "./projects.js";
import * as synthesisLlm from "./synthesis-llm.js";
import type { LLMTextExecutor } from "./synthesis-llm.js";
import * as skillGovernance from "./skill-governance.js";
import { getSetting, setSetting } from "./settings.js";
import { logEvent } from "./pipeline-events.js";
import { logger } from "../logger.js";
import {
  getIncompleteSynthesisBatchStatus,
  runDurableSynthesis,
  type DurableSynthesisOptions,
} from "./synthesis-batches.js";
import type { SynthesisStatus } from "../schema.js";

export type { DurableSynthesisOptions as SynthesisRunOptions, SynthesisFaultPoint } from "./synthesis-batches.js";

/** Safely parse a JSON string, returning `{}` on failure instead of throwing. */
function safeParseJson(str: string): Record<string, any> {
  try { return JSON.parse(str); } catch { return {}; }
}

function submitNewProposalCandidate(projectId: string, candidate: skillGovernance.ProposalCandidateResult): boolean {
  if (candidate.proposal.status === "draft") {
    skillGovernance.submitProposal(projectId, candidate.proposal.id);
  }
  return candidate.disposition !== "reused";
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

/** Advance one durable synthesis batch through trait, proposal, and acknowledgment phases. */
export async function runSynthesis(
  projectId: string,
  sessionId?: string,
  opts?: DurableSynthesisOptions,
): Promise<SynthesisResult> {
  return runDurableSynthesis(projectId, sessionId, opts);
}

/**
 * Get synthesis pipeline status and statistics for a project.
 */
export function getSynthesisStatus(projectId: string): SynthesisStatus {
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
    incompleteBatch: getIncompleteSynthesisBatchStatus(projectId),
  };
}

/**
 * Cross-project synthesis: identifies patterns present in 2+ projects
 * and promotes them to the global-default project as shared skills and traits.
 *
 * Skills appearing in ≥2 non-global projects are copied to the global project.
 * Traits with confidence ≥0.7 appearing in ≥2 projects are also promoted.
 * Already-existing global skills are updated to note their cross-project origin.
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
        const proposedState = JSON.stringify({
          content: sampleSkill.content,
          description: `[Cross-project] ${sampleSkill.description}`,
          category: "global",
          tags: sampleSkill.tags || "cross-project,auto-generated",
          always_apply: 0,
          file_tree: fileTree || null,
        });
        const evidenceJson = JSON.stringify([
          { trigger: "cross-project synthesis", project_count: projectIds.length, source_projects: projectIds },
        ]);
        const candidate = skillGovernance.ensureProposalCandidate(
          globalProject.id,
          "create",
          sampleSkill.name,
          proposedState,
          {
            evidenceJson,
            qualityScore: 0.5,
            noveltyScore: 0.3,
            alwaysApply: 0,
          },
        );
        if (!submitNewProposalCandidate(globalProject.id, candidate)) continue;
        const proposal = candidate.proposal;
        result.skills_created++;

        try {
          logEvent(
            globalProject.id,
            "proposal_created",
            "synthesis",
            `Cross-project proposal created (create): ${skillName}`,
            `Promoted from ${projectIds.length} projects`,
            { proposal_id: proposal.id, skill_name: skillName, proposal_type: "create", project_count: projectIds.length, cross_project: true },
          );
        } catch (_) { /* non-fatal */ }
      } else {
        // Update description to note cross-project nature
        const updatedDesc = existing.description.includes("[Cross-project]")
          ? existing.description
          : `[Cross-project] ${existing.description}`;
        const proposedState = JSON.stringify({
          content: existing.content,
          description: updatedDesc,
          category: (existing as any).category || null,
          tags: existing.tags || null,
          always_apply: (existing as any).always_apply ?? 0,
          file_tree: (existing as any).file_tree || null,
        });
        const evidenceJson = JSON.stringify([
          { trigger: "cross-project synthesis update", project_count: projectIds.length, source_projects: projectIds },
        ]);
        const candidate = skillGovernance.ensureProposalCandidate(
          globalProject.id,
          "update",
          skillName,
          proposedState,
          {
            evidenceJson,
            qualityScore: 0.5,
            noveltyScore: 0.2,
            alwaysApply: (existing as any).always_apply ?? 0,
          },
        );
        if (!submitNewProposalCandidate(globalProject.id, candidate)) continue;
        const proposal = candidate.proposal;
        try {
          logEvent(
            globalProject.id,
            "proposal_created",
            "synthesis",
            `Cross-project proposal created (update): ${skillName}`,
            `Updated description from ${projectIds.length} projects`,
            { proposal_id: proposal.id, skill_name: skillName, proposal_type: "update", project_count: projectIds.length, cross_project: true },
          );
        } catch (_) { /* non-fatal */ }
      }
    } catch (err: any) {
      logger.error("synthesis", `Cross-project skill promotion "${skillName}" failed: ${err.message}`, { error: err.message, name: err.name, stack: err.stack?.split("\n").slice(0, 5).join("\n") });
      result.errors.push(`Skill "${skillName}": ${err.message}`);
    }
  }

  // ── Cross-project traits ──
  // Aggregate traits from all non-global projects.
  // Only traits with confidence ≥ 0.7 are eligible for promotion (threshold
  // filters out weak signals that haven't been reinforced across cycles).
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

  result.summary = `Cross-project synthesis complete: ${result.skills_created} proposal(s) created, ${result.traits_created} trait(s) aggregated from ${nonGlobalProjects.length} project(s).`;
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
 * Result of a skill consolidation run.
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
 *
 * Pre-consolidation state is saved as a setting (`consolidation_backup`) capped
 * at 50 KB, enabling a manual restore if the LLM's proposals are too aggressive.
 *
 * WARNING: Merges use `stripLeadingFrontmatter()` to avoid embedding YAML in
 *          the middle of the merged document. If either skill lacks frontmatter,
 *          the merge still proceeds (the function returns the body unchanged).
 */
export async function consolidateSkills(
  projectId: string,
  opts?: { llmExecutor?: LLMTextExecutor },
): Promise<ConsolidationResult> {
  // Prefer direct configuration; use the API-owned broker only when none exists.
  const gid = projects.getGlobalProject()?.id;
  const directConfig = synthesisLlm.getFullLLMSynthesisConfig(projectId);
  if (!directConfig && !opts?.llmExecutor) {
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
    result = await synthesisLlm.callConsolidationLLM(
      projectId,
      prompt,
      undefined,
      undefined,
      undefined,
      opts?.llmExecutor,
    );
  } catch (primaryErr: any) {
    logger.warn("synthesis", `Consolidation primary LLM failed: ${primaryErr.message} — trying backup`);
    result = { merges: [], delete: [] };
  }

  // If primary returned empty (or threw), try backup provider
  if (result.merges.length === 0 && result.delete.length === 0) {
    const backupModel = gid ? getSetting(gid, "synthesis_backup_model") : undefined;
    const backupEndpoint = gid ? getSetting(gid, "synthesis_backup_endpoint") : undefined;
    const backupApiKey = gid ? getSetting(gid, "synthesis_backup_api_key") : undefined;

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

  // Save pre-consolidation snapshot for restore capability
  try {
    const allSkillsForBackup = skills.listSkills(projectId);
    const backupData = JSON.stringify(allSkillsForBackup.map((s: any) => ({
      name: s.name,
      content: s.content,
      description: s.description,
      file_tree: (s as any).file_tree || "{}",
      tags: s.tags,
      always_apply: (s as any).always_apply
    })));
    setSetting(projectId, "consolidation_backup", backupData.substring(0, 50000)); // cap at 50KB
  } catch (_) { /* non-fatal */ }

  // Process merges: produce governance merge proposals (governance-gated)
  for (const merge of result.merges || []) {
    try {
      const target = skills.getSkill(projectId, merge.target);
      const source = skills.getSkill(projectId, merge.source);
      if (!target || !source) continue;

      // Merge content: append source's SKILL.md after target's.
      // Strip frontmatter from BOTH to avoid embedding YAML mid-document.
      const targetBody = skills.stripLeadingFrontmatter(target.content);
      const sourceBody = skills.stripLeadingFrontmatter(source.content);
      const mergedContent = `${targetBody}\n\n## Merged from ${merge.source}\n\n${sourceBody}`;

      // Merge file_trees: combine reference files (source files prefixed)
      const targetTree = safeParseJson((target as any).file_tree || "{}");
      const sourceTree = safeParseJson((source as any).file_tree || "{}");
      for (const [key, val] of Object.entries(sourceTree)) {
        if (key.startsWith("merged-")) continue;
        targetTree[`merged-${merge.source}/${key}`] = val;
      }

      // Merge tags
      const mergedTags = [
        ...new Set([
          ...(target.tags || "").split(",").map(t => t.trim()).filter(Boolean),
          ...(source.tags || "").split(",").map(t => t.trim()).filter(Boolean),
        ]),
      ].join(",");

      const proposedState = JSON.stringify({
        content: mergedContent,
        description: target.description || "",
        category: (target as any).category || null,
        tags: mergedTags || null,
        always_apply: (target as any).always_apply ?? 0,
        file_tree: JSON.stringify(targetTree),
      });
      const candidate = skillGovernance.ensureProposalCandidate(
        projectId,
        "merge",
        merge.target,
        proposedState,
        {
          sourceProjectId: projectId,
          sourceName: merge.source,
          qualityScore: 0.7,
          noveltyScore: 0.1,
          alwaysApply: (target as any).always_apply ?? 0,
        },
      );
      if (!submitNewProposalCandidate(projectId, candidate)) continue;
      merged++;
    } catch (e: any) {
      logger.warn("synthesis", `Merge proposal failed: ${merge.source} → ${merge.target}: ${e.message}`);
    }
  }

  // Process deletes: produce governance archive proposals (governance-gated)
  for (const name of result.delete || []) {
    try {
      const skillToArchive = skills.getSkill(projectId, name);
      if (!skillToArchive) continue;
      const proposedState = JSON.stringify({
        // Archive proposals don't require content/description — the skill is being soft-deleted.
        // We include minimal metadata for traceability.
        content: skillToArchive.content,
        description: skillToArchive.description || "",
        category: (skillToArchive as any).category || null,
        tags: skillToArchive.tags || null,
        always_apply: (skillToArchive as any).always_apply ?? 0,
        file_tree: (skillToArchive as any).file_tree || null,
      });
      const candidate = skillGovernance.ensureProposalCandidate(
        projectId,
        "archive",
        name,
        proposedState,
        {
          qualityScore: 0.7,
          noveltyScore: 0.0,
          alwaysApply: (skillToArchive as any).always_apply ?? 0,
        },
      );
      if (!submitNewProposalCandidate(projectId, candidate)) continue;
      deleted++;
    } catch (e: any) {
      logger.warn("synthesis", `Archive proposal failed for ${name}: ${e.message}`);
    }
  }

  const summary = `Consolidation created ${merged} merge proposal(s) and ${deleted} archive proposal(s) for ${allSkills.length} skills`;

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
