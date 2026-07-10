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
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
    const now = new Date().toISOString();

    // Look for existing trait matching on project_id + trait_type + trait_value
    const existing = db.prepare(
      `SELECT * FROM personality_traits
       WHERE project_id = ? AND trait_type = ? AND trait_value = ?`
    ).get(projectId, traitType, traitValue) as PersonalityTrait | undefined;

    if (existing) {
      // Re-observation: boost confidence and update metadata
      const newConfidence = Math.min(1.0, existing.confidence + 0.1);
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
      checkpointAfterWrite();
      return db.prepare("SELECT * FROM personality_traits WHERE id = ?").get(existing.id) as PersonalityTrait;
    }

    // New trait: insert with provided or default confidence
    const result = db.prepare(
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
    checkpointAfterWrite();
    return db.prepare("SELECT * FROM personality_traits WHERE id = ?").get(result.lastInsertRowid) as PersonalityTrait;
  });
}

export function getTraits(projectId: string, traitType?: PersonalityTrait["trait_type"]): PersonalityTrait[] {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
  if (traitType) {
    return db.prepare(
      `SELECT * FROM personality_traits
       WHERE project_id = ? AND trait_type = ? AND is_active = 1
       ORDER BY confidence DESC`
    ).all(projectId, traitType) as PersonalityTrait[];
  }
  return db.prepare(
    `SELECT * FROM personality_traits
     WHERE project_id = ? AND is_active = 1
     ORDER BY confidence DESC`
  ).all(projectId) as PersonalityTrait[];
}

export function getProfile(projectId: string): Array<{ project_id: string; trait_type: string; traits: string }> {
  const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
  return db.prepare(
    `SELECT * FROM personality_profile WHERE project_id = ?`
  ).all(projectId) as Array<{ project_id: string; trait_type: string; traits: string }>;
}

export function disableTrait(id: number): boolean {
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");
    const now = new Date().toISOString();
    const result = db.prepare(
      "UPDATE personality_traits SET is_active = 0, updated_at = ? WHERE id = ?"
    ).run(now, id);
    checkpointAfterWrite();
    return result.changes > 0;
  });
}

export function updateConfidence(
  projectId: string,
  traitType: PersonalityTrait["trait_type"],
  traitValue: string,
  delta: number,
): PersonalityTrait | null {
  return execTransaction(() => {
    const db = getDb(process.env.INGENIUM_CORE_DB_PATH ?? "./.ingenium/data.db");

    const existing = db.prepare(
      `SELECT * FROM personality_traits
       WHERE project_id = ? AND trait_type = ? AND trait_value = ?`
    ).get(projectId, traitType, traitValue) as PersonalityTrait | undefined;

    if (!existing) return null;

    const newConfidence = Math.max(0.0, Math.min(1.0, existing.confidence + delta));
    db.prepare(
      "UPDATE personality_traits SET confidence = ?, updated_at = ? WHERE id = ?"
    ).run(newConfidence, new Date().toISOString(), existing.id);
    checkpointAfterWrite();
    return db.prepare("SELECT * FROM personality_traits WHERE id = ?").get(existing.id) as PersonalityTrait;
  });
}
