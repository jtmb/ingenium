type LogLevel = "debug" | "info" | "warn" | "error";
type LogSource = string;
interface LogEntry {
    timestamp: string;
    source: LogSource;
    level: LogLevel;
    message: string;
    data?: any;
}
/**
 * Singleton logger with an in-memory circular buffer.
 *
 * Design rationale:
 * - Buffer is in-process memory (not DB/file) — avoids I/O latency on the hot path,
 *   keeps the core package DB-free per convenience, and makes logs available to the
 *   dashboard API via `getLogs()` without any persistence layer.
 * - No log levels are filtered at write time — all entries are captured so the
 *   API/polling consumer can slice by level/source after the fact. This trades
 *   memory for flexibility.
 */
export declare const logger: {
    debug: (source: LogSource, message: string, data?: any) => void;
    info: (source: LogSource, message: string, data?: any) => void;
    warn: (source: LogSource, message: string, data?: any) => void;
    error: (source: LogSource, message: string, data?: any) => void;
    /** Returns buffered log entries with optional filtering by source, level, or time window. Used by the dashboard polling endpoint. */
    getLogs(options?: {
        source?: string;
        level?: string;
        since?: string;
        limit?: number;
    }): LogEntry[];
    /** Returns all unique source names seen in the buffer, sorted alphabetically. */
    getSources(): string[];
};
export {};
//# sourceMappingURL=logger.d.ts.map