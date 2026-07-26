/**
 * RAG chunker — splits text into semantically meaningful chunks
 * for ingestion into the RAG search index.
 *
 * Supported formats:
 * - Markdown: splits by ## headings, preserves heading context
 * - Plaintext: splits by paragraphs, merges short ones
 * - JSON: parses {entries: [...]} format
 * - JSONL: handles Copilot transcript format
 */
export interface Chunk {
    id: number;
    content: string;
    heading?: string;
    source?: string;
    tokens: number;
}
export interface ChunkOptions {
    /** Maximum tokens per chunk (approximate) */
    maxTokens?: number;
    /** Minimum characters for a standalone paragraph */
    minParagraphChars?: number;
    /** Source identifier for chunks */
    source?: string;
}
/** Estimate token count: ~4 chars per token on average */
export declare function estimateTokens(text: string): number;
/**
 * Chunk markdown text by ## headings.
 * Each chunk includes the heading context + content under it.
 * Content before the first ## heading is assigned a "lead" chunk.
 */
export declare function chunkMarkdown(text: string, options?: ChunkOptions): Chunk[];
/**
 * Chunk plain text by paragraphs (double newline).
 * Merges short paragraphs (< minParagraphChars) with the next one.
 */
export declare function chunkPlaintext(text: string, options?: ChunkOptions): Chunk[];
/**
 * Chunk JSON in {entries: [...]} format.
 * Each entry becomes one chunk. Falls back to plaintext for non-JSON.
 */
export declare function chunkJSON(text: string, options?: ChunkOptions): Chunk[];
/**
 * Chunk JSONL (line-delimited JSON, e.g. Copilot transcripts).
 * Each line is parsed independently; invalid lines included as raw content.
 */
export declare function chunkJSONL(text: string, options?: ChunkOptions): Chunk[];
/**
 * Auto-detect format and chunk accordingly.
 */
export declare function chunkText(text: string, options?: ChunkOptions): Chunk[];
//# sourceMappingURL=rag-chunker.d.ts.map