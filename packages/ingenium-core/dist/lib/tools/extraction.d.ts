interface CandidateMessage {
    text: string;
    time_created: number;
    hash: string;
    messageId?: string;
    sessionId?: string;
}
interface ExtractionRule {
    content: string;
    type: string;
    importance?: number;
}
interface ExtractionResult {
    scanned: number;
    candidates: number;
    created: number;
    skipped: number;
    failedBatches: number;
    watermark: number;
    reason?: string;
}
export declare function callLLMForExtraction(messages: CandidateMessage[], config: {
    model: string;
    endpoint: string;
    apiKey?: string;
    allowPrivateNetwork?: boolean;
}): Promise<{
    rules: ExtractionRule[];
    failed: boolean;
}>;
/** Parse the LLM response JSON with defensive handling. */
export declare function parseExtractionResponse(raw: string): ExtractionRule[];
export declare function runExtraction(projectId: string, projectName: string, opts?: {
    limit?: number;
}): Promise<ExtractionResult>;
/**
 * Look up a project name from its ID. Returns undefined if not found.
 */
export declare function getProjectNameById(projectId: string): string | undefined;
export {};
//# sourceMappingURL=extraction.d.ts.map