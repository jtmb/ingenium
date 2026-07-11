import { getDb, execTransaction, checkpointAfterWrite } from "../db.js";
import { PersonalityTrait } from "../schema.js";

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

export function listTraits(projectId: string, includeInactive = false): PersonalityTrait[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
  const query = includeInactive
    ? "SELECT * FROM personality_traits WHERE project_id = ? ORDER BY confidence DESC"
    : "SELECT * FROM personality_traits WHERE project_id = ? AND is_active = 1 ORDER BY confidence DESC";
  return db.prepare(query).all(projectId) as PersonalityTrait[];
}

export function getTraits(projectId: string, traitType?: PersonalityTrait["trait_type"], minConfidence?: number): PersonalityTrait[] {
  const all = listTraits(projectId, false);
  let filtered = traitType ? all.filter(t => t.trait_type === traitType) : all;
  if (minConfidence !== undefined) {
    filtered = filtered.filter(t => t.confidence >= minConfidence);
  }
  return filtered;
}

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

export function setActive(projectId: string, traitId: number, active: boolean): void {
  execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
    db.prepare("UPDATE personality_traits SET is_active = ? WHERE project_id = ? AND id = ?")
      .run(active ? 1 : 0, projectId, traitId);
  });
  checkpointAfterWrite();
}

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
