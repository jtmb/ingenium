type LogLevel = "debug" | "info" | "warn" | "error";
type LogSource = string;

interface LogEntry {
  timestamp: string;
  source: LogSource;
  level: LogLevel;
  message: string;
  data?: any;
}

const MAX_BUFFER = 2000;
const logBuffer: LogEntry[] = [];

function addToBuffer(entry: LogEntry): void {
  logBuffer.push(entry);
  if (logBuffer.length > MAX_BUFFER) {
    logBuffer.splice(0, logBuffer.length - MAX_BUFFER);
  }
}

function formatConsole(entry: LogEntry): string {
  const ts = entry.timestamp.split("T")[1]?.split(".")[0] || entry.timestamp;
  const source = `[${entry.source}]`.padEnd(20);
  return `${ts} ${entry.level.toUpperCase().padEnd(5)} ${source}${entry.message}`;
}

function log(level: LogLevel, source: LogSource, message: string, data?: any): void {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    source,
    level,
    message,
    data,
  };
  addToBuffer(entry);
  
  const formatted = formatConsole(entry);
  switch (level) {
    case "error": console.error(formatted, data ? data : ""); break;
    case "warn": console.warn(formatted, data ? data : ""); break;
    case "debug": console.debug(formatted, data ? data : ""); break;
    default: console.log(formatted, data ? data : ""); break;
  }
}

// Public API
export const logger = {
  debug: (source: LogSource, message: string, data?: any) => log("debug", source, message, data),
  info: (source: LogSource, message: string, data?: any) => log("info", source, message, data),
  warn: (source: LogSource, message: string, data?: any) => log("warn", source, message, data),
  error: (source: LogSource, message: string, data?: any) => log("error", source, message, data),
  
  // For dashboard polling
  getLogs(options?: { source?: string; level?: string; since?: string; limit?: number }): LogEntry[] {
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
  
  getSources(): string[] {
    const sources = new Set<string>();
    for (const entry of logBuffer) {
      sources.add(entry.source);
    }
    return Array.from(sources).sort();
  },
};
