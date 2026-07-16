/**
 * Maximum in-memory log entries retained.
 * 2000 entries balances ~2–5 minutes of high-frequency logging against memory usage.
 * Past this, older entries are trimmed — logs are ephemeral and not persisted.
 */
const MAX_BUFFER = 2000;
const logBuffer = [];
function addToBuffer(entry) {
    logBuffer.push(entry);
    if (logBuffer.length > MAX_BUFFER) {
        // Trim from the front (oldest entries) — splice is O(n) but n is capped at MAX_BUFFER,
        // and this only fires when the buffer is full, so it's acceptably infrequent.
        logBuffer.splice(0, logBuffer.length - MAX_BUFFER);
    }
}
function formatConsole(entry) {
    const ts = entry.timestamp.split("T")[1]?.split(".")[0] || entry.timestamp;
    const source = `[${entry.source}]`.padEnd(20);
    return `${ts} ${entry.level.toUpperCase().padEnd(5)} ${source}${entry.message}`;
}
function log(level, source, message, data) {
    const entry = {
        timestamp: new Date().toISOString(),
        source,
        level,
        message,
        data,
    };
    addToBuffer(entry);
    const formatted = formatConsole(entry);
    switch (level) {
        case "error":
            console.error(formatted, data ? data : "");
            break;
        case "warn":
            console.warn(formatted, data ? data : "");
            break;
        case "debug":
            console.debug(formatted, data ? data : "");
            break;
        default:
            console.log(formatted, data ? data : "");
            break;
    }
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
export const logger = {
    debug: (source, message, data) => log("debug", source, message, data),
    info: (source, message, data) => log("info", source, message, data),
    warn: (source, message, data) => log("warn", source, message, data),
    error: (source, message, data) => log("error", source, message, data),
    /** Returns buffered log entries with optional filtering by source, level, or time window. Used by the dashboard polling endpoint. */
    getLogs(options) {
        let entries = [...logBuffer];
        if (options?.source) {
            entries = entries.filter(e => e.source === options.source);
        }
        if (options?.level) {
            entries = entries.filter(e => e.level === options.level);
        }
        if (options?.since) {
            const sinceDate = new Date(options.since).getTime();
            entries = entries.filter(e => new Date(e.timestamp).getTime() > sinceDate);
        }
        const limit = options?.limit || 500;
        return entries.slice(-limit);
    },
    /** Returns all unique source names seen in the buffer, sorted alphabetically. */
    getSources() {
        const sources = new Set();
        for (const entry of logBuffer) {
            sources.add(entry.source);
        }
        return Array.from(sources).sort();
    },
};
