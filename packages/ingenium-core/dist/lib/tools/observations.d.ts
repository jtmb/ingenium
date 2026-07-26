/**
 * Observation persistence — the raw input to the self-learning pipeline.
 *
 * Observations are single statements about user behavior (corrections, preferences,
 * patterns, etc.) stored with importance and source metadata. The synthesis pipeline
 * reads pending observations and consolidates them into personality traits and skills.
 *
 * 🔴 All mutations use execTransaction() with checkpointAfterWrite() outside the txn.
 */
import { Observation } from "../schema.js";
/**
 * Store a single observation and fire a pipeline event for observability.
 *
 * Default importance of 5 (mid-scale 1-10) means most observations are treated
 * neutrally — the synthesis pipeline can up-rank based on patterns. Default
 * source 'agent' distinguishes agent-reported observations from auto-extracted ones.
 *
 * Pipeline event logging is intentionally outside the transaction (and wrapped in
 * try/catch) so a pipeline-log failure never prevents the observation from persisting.
 */
export declare function storeObservation(projectId: string, observationType: Observation["observation_type"], content: string, importance?: number, source?: Observation["source"], context?: string, sessionId?: string): Observation;
/**
 * List observations for a project, optionally filtered by status and type.
 * Ordered newest-first. Default limit of 50 prevents unbounded result sets.
 */
export declare function getObservations(projectId: string, status?: Observation["status"], type?: Observation["observation_type"], limit?: number): Observation[];
/**
 * Full-text search across observations using FTS5.
 * Query is sanitized via sanitizeFts5Query() to avoid FTS5 syntax errors
 * from raw user input (special chars like `*`, `"`, `-` in unexpected places).
 * Returns empty array if the query is invalid after sanitization.
 */
export declare function searchObservations(projectId: string, query: string, limit?: number): Observation[];
/** Retrieve a single observation by its primary key ID. */
export declare function getObservation(id: number): Observation | undefined;
/**
 * Batch-fetch observations by IDs. Uses a single parameterized query with
 * dynamically built IN clause placeholders. Returns only matching rows.
 * Empty input or no matches returns an empty array.
 */
export declare function getObservationsByIds(ids: number[]): Observation[];
/**
 * Update selected fields of an observation. Only the provided fields are changed.
 * Dynamically builds the SET clause to avoid writing unchanged columns.
 * Returns null if the observation doesn't exist (changes === 0).
 */
export declare function updateObservation(id: number, data: Partial<Pick<Observation, "status" | "importance" | "content" | "context" | "observation_type">>): Observation | null;
/**
 * Count observations still in 'pending' status — used by the synthesis pipeline
 * to decide whether processing is needed and by the dashboard to show backlogs.
 */
export declare function countUnprocessed(projectId: string): number;
/**
 * Fetch the next batch of unprocessed observations for synthesis.
 * Ordered by importance DESC (most important first) then created_at ASC (oldest first).
 * This ensures high-importance observations are processed first while maintaining
 * FIFO order within the same importance level.
 */
export declare function getUnprocessedBatch(projectId: string, limit?: number): Observation[];
/**
 * Hard-delete a single observation by ID, scoped to project.
 * Returns true if a row was actually deleted.
 */
export declare function deleteObservation(projectId: string, id: number): boolean;
/**
 * Bulk-delete all observations from a given source (e.g., 'auto-observer').
 * Used to reset observations when re-running extraction after fixing the pipeline.
 * Returns the number of deleted rows.
 */
export declare function deleteObservationsBySource(projectId: string, source: string): number;
//# sourceMappingURL=observations.d.ts.map