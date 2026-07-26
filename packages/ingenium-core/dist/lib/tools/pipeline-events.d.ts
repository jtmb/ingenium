import { PipelineEvent } from "../schema.js";
/**
 * Log a pipeline event. Returns the created event.
 *
 * The `data` object is JSON-serialized for storage in a TEXT column.
 * Events form a parent-child tree via `parentEventId`, used by getTimeline()
 * to reconstruct grouped views of pipeline activity.
 */
export declare function logEvent(projectId: string, eventType: PipelineEvent["event_type"], eventSource: PipelineEvent["event_source"], title: string, description?: string, data?: object, parentEventId?: number, sessionId?: string, importance?: number): PipelineEvent;
/**
 * Get pipeline events with optional filters.
 * Dynamically builds the WHERE clause from the provided options — each optional
 * filter appends a clause to avoid hard-coding every combination.
 */
export declare function getEvents(projectId: string, options?: {
    source?: PipelineEvent["event_source"];
    type?: PipelineEvent["event_type"];
    limit?: number;
    since?: string;
    parentEventId?: number;
}): PipelineEvent[];
/**
 * Get a flat timeline with parent events and their children grouped.
 * Returns events ordered by created_at DESC with children nested in `data.children`.
 *
 * NOTE: This performs N+1 queries (one for parents, one per parent for children).
 * Acceptable because parent counts are bounded by the limit (default 50).
 * If the pipeline produces thousands of events per interval, consider a
 * single-query approach with a window function instead.
 */
export declare function getTimeline(projectId: string, options?: {
    source?: PipelineEvent["event_source"];
    limit?: number;
    since?: string;
}): PipelineEvent[];
export { logEvent as logPipelineEvent };
//# sourceMappingURL=pipeline-events.d.ts.map