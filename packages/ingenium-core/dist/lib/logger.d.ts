type LogLevel = "debug" | "info" | "warn" | "error";
type LogSource = string;
interface LogEntry {
    timestamp: string;
    source: LogSource;
    level: LogLevel;
    message: string;
    data?: any;
}
export declare const logger: {
    debug: (source: LogSource, message: string, data?: any) => void;
    info: (source: LogSource, message: string, data?: any) => void;
    warn: (source: LogSource, message: string, data?: any) => void;
    error: (source: LogSource, message: string, data?: any) => void;
    getLogs(options?: {
        source?: string;
        level?: string;
        since?: string;
        limit?: number;
    }): LogEntry[];
    getSources(): string[];
};
export {};
//# sourceMappingURL=logger.d.ts.map