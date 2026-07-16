/**
 * Personality trait persistence — CRUD for learned user behavior traits.
 *
 * Traits are the durable output of the self-learning pipeline. Observations are
 * synthesized into traits with confidence scores. Confidence starts at 0.5 for
 * newly created traits, gets +0.1 on each re-observation, and caps at 0.95.
 * The display gate at 0.30 prevents noise from appearing in the profile.
 *
 * 🔴 All mutations use execTransaction() with checkpointAfterWrite() outside the txn.
 */

import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { PersonalityTrait } from "../schema.js";

/**
 * Upsert a personality trait keyed by (project_id, trait_type, trait_value).
 *
 * If the trait already exists, this is a "re-observation": confidence is boosted
 * by +0.1 (capped at 0.95) and optional exemplar/label fields are updated.
 * If it was previously disabled (is_active = 0), it's re-activated.
 *
 * New traits start at default confidence 0.5 — above the display gate of 0.30
 * so they immediately appear in the profile.
 */
export function upsertTrait(
  projectId: string,
  traitType: PersonalityTrait["trait_type"],
  traitValue: string,
  label?: string,
  confidence?: number,
  exemplarObservationId?: number,
  exemplarText?: string,
): PersonalityTrait {
  const result = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
    const now = new Date().toISOString();

    // Look for existing trait matching on project_id + trait_type + trait_value
    const existing = db.prepare(
      `SELECT * FROM personality_traits
       WHERE project_id = ? AND trait_type = ? AND trait_value = ?`
    ).get(projectId, traitType, traitValue) as PersonalityTrait | undefined;

    if (existing) {
      // Re-observation: boost confidence and update metadata
      // +0.1 per confirmation, 0.95 hard cap avoids over-confidence from a single
      // session producing many similar observations (e.g., repeated typos).
      const newConfidence = Math.min(0.95, existing.confidence + 0.1);
      const updates: string[] = [
        "confidence = ?",
        "updated_at = ?",
      ];
      const params: any[] = [newConfidence, now];

      if (exemplarObservationId !== undefined) {
        updates.push("exemplar_observation_id = ?");
        params.push(exemplarObservationId);
      }
      if (exemplarText !== undefined) {
        updates.push("exemplar_text = ?");
        params.push(exemplarText);
      }
      if (label !== undefined) {
        updates.push("display_label = ?");
        params.push(label);
      }
      if (!existing.is_active) {
        updates.push("is_active = 1");
      }

      params.push(existing.id);
      db.prepare(
        `UPDATE personality_traits SET ${updates.join(", ")} WHERE id = ?`
      ).run(...params);
      return db.prepare("SELECT * FROM personality_traits WHERE id = ?").get(existing.id) as PersonalityTrait;
    }

    // New trait: insert with provided or default confidence
    const insertResult = db.prepare(
      `INSERT INTO personality_traits (project_id, trait_type, trait_value, display_label, confidence, exemplar_observation_id, exemplar_text, source, is_active, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, 'synthesis', 1, NULL, ?, ?)`
    ).run(
      projectId,
      traitType,
      traitValue,
      label ?? null,
      confidence ?? 0.5,
      exemplarObservationId ?? null,
      exemplarText ?? null,
      now,
      now,
    );
    return db.prepare("SELECT * FROM personality_traits WHERE id = ?").get(insertResult.lastInsertRowid) as PersonalityTrait;
  });
  checkpointAfterWrite();
  return result;
}

/**
 * List all traits for a project, optionally including inactive (disabled) ones.
 * Returned in descending confidence order so the strongest traits come first.
 */
export function listTraits(projectId: string, includeInactive = false): PersonalityTrait[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
  const query = includeInactive
    ? "SELECT * FROM personality_traits WHERE project_id = ? ORDER BY confidence DESC"
    : "SELECT * FROM personality_traits WHERE project_id = ? AND is_active = 1 ORDER BY confidence DESC";
  return db.prepare(query).all(projectId) as PersonalityTrait[];
}

/**
 * Filter traits by optional trait type and minimum confidence threshold.
 * Only returns active traits. Uses post-filtering (not SQL) so the query is
 * simple and the dataset is small enough for in-memory filtering.
 */
export function getTraits(projectId: string, traitType?: PersonalityTrait["trait_type"], minConfidence?: number): PersonalityTrait[] {
  const all = listTraits(projectId, false);
  let filtered = traitType ? all.filter(t => t.trait_type === traitType) : all;
  if (minConfidence !== undefined) {
    filtered = filtered.filter(t => t.confidence >= minConfidence);
  }
  return filtered;
}

/**
 * Get the full personality profile as an array of (trait_type → grouped traits).
 * By default excludes traits below 0.30 confidence (the "display gate").
 *
 * The 0.30 threshold avoids showing speculative traits from a single observation
 * while allowing traits to appear quickly after just 2-3 reinforcing observations.
 * New traits start at 0.50, so one re-observation puts them at 0.60 — well above gate.
 * A trait at 0.30 needs ~3 observations starting from 0.5 with decay, or is explicitly
 * set there by synthesis.
 */
export function getProfile(projectId: string, options?: { includeHidden?: boolean }): Array<{ project_id: string; trait_type: string; traits: string }> {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
  if (options?.includeHidden) {
    // Return all active traits regardless of confidence
    return db.prepare(
      `SELECT project_id, trait_type,
       json_group_array(json_object(
         'trait_value', trait_value,
         'display_label', display_label,
         'confidence', confidence,
         'source', source
       )) as traits
       FROM personality_traits 
       WHERE project_id = ? AND is_active = 1
       GROUP BY project_id, trait_type
       ORDER BY trait_type, confidence DESC`
    ).all(projectId) as Array<{ project_id: string; trait_type: string; traits: string }>;
  }
  // Display gate: only traits at or above 0.30 confidence
  return db.prepare(
    `SELECT project_id, trait_type,
     json_group_array(json_object(
       'trait_value', trait_value,
       'display_label', display_label,
       'confidence', confidence,
       'source', source
     )) as traits
     FROM personality_traits 
     WHERE project_id = ? AND is_active = 1 AND confidence >= 0.30
     GROUP BY project_id, trait_type
     ORDER BY trait_type, confidence DESC`
  ).all(projectId) as Array<{ project_id: string; trait_type: string; traits: string }>;
}

/**
 * Soft-delete a trait by ID — sets is_active = 0.
 * The trait remains in the DB for history but is excluded from getProfile().
 */
export function disableTrait(id: number): boolean {
  const ok = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
    const now = new Date().toISOString();
    const result = db.prepare(
      "UPDATE personality_traits SET is_active = 0, updated_at = ? WHERE id = ?"
    ).run(now, id);
    return result.changes > 0;
  });
  checkpointAfterWrite();
  return ok;
}

/**
 * Enable or disable a specific trait by ID, scoped to a project.
 * Used by the dashboard toggle and the personaility-trait-dismiss MCP tool.
 */
export function setActive(projectId: string, traitId: number, active: boolean): void {
  execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
    db.prepare("UPDATE personality_traits SET is_active = ? WHERE project_id = ? AND id = ?")
      .run(active ? 1 : 0, projectId, traitId);
  });
  checkpointAfterWrite();
}

/**
 * Apply a signed delta to a trait's confidence (e.g., +0.15 for confirmation,
 * -0.10 for contradiction). Clamped to [0.0, 0.95] — the 0.95 ceiling matches
 * upsertTrait's cap to prevent runaway confidence from repeated reinforcement.
 * Returns the updated trait, or null if not found.
 */
export function updateConfidence(
  projectId: string,
  traitType: PersonalityTrait["trait_type"],
  traitValue: string,
  delta: number,
): PersonalityTrait | null {
  const result = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");

    const existing = db.prepare(
      `SELECT * FROM personality_traits
       WHERE project_id = ? AND trait_type = ? AND trait_value = ?`
    ).get(projectId, traitType, traitValue) as PersonalityTrait | undefined;

    if (!existing) return null;

    const newConfidence = Math.max(0.0, Math.min(0.95, existing.confidence + delta));
    db.prepare(
      "UPDATE personality_traits SET confidence = ?, updated_at = ? WHERE id = ?"
    ).run(newConfidence, new Date().toISOString(), existing.id);
    return db.prepare("SELECT * FROM personality_traits WHERE id = ?").get(existing.id) as PersonalityTrait;
  });
  if (result) {
    checkpointAfterWrite();
  }
  return result;
}

/**
 * Hard-delete a single trait by ID, scoped to project.
 * Returns true if a row was actually deleted.
 */
export function deleteTrait(projectId: string, id: number): boolean {
  const ok = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
    const result = db.prepare(
      "DELETE FROM personality_traits WHERE project_id = ? AND id = ?"
    ).run(projectId, id);
    return result.changes > 0;
  });
  checkpointAfterWrite();
  return ok;
}

/**
 * Hard-delete ALL traits for a project. Used by the "reset personality"
 * workflow — returns the count of deleted rows.
 */
export function deleteAllTraits(projectId: string): number {
  const result = execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
    const deleteResult = db.prepare(
      "DELETE FROM personality_traits WHERE project_id = ?"
    ).run(projectId);
    return deleteResult.changes;
  });
  checkpointAfterWrite();
  return result;
}
