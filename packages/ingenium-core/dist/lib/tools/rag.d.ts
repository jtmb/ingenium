/**
 * RAG (Retrieval-Augmented Generation) — manage sources, chunks, and search.
 *
 * Uses the established schema:
 * - rag_sources: id, project_id, title, source_type, source_path, ...
 * - rag_chunks: id (UUID), source_id, chunk_index, content, token_count, heading_path, ...
 * - rag_chunks_fts: FTS5 index
 * - rag_embeddings: chunk_id, embedding, model_id, dimensions
 */
import type { RagSource, RagSearchResult } from "../schema.js";
import type { Chunk } from "./rag-chunker.js";
/**
 * Minimal source view returned by createSource/ingestSource.
 * Maps DB field `title` to the public `name` for backward compat.
 */
export interface Source {
    id: string;
    project_id: string;
    name: string;
    chunk_count: number;
    metadata: string;
    created_at: string;
}
export interface RagPage<T> {
    data: T[];
    total: number;
    limit: number;
    offset: number;
}
export interface IngestSourceOptions {
    sourceType?: "file" | "text" | "url";
    sourcePath?: string;
    mimeType?: string;
    metadata?: Record<string, unknown>;
    priority?: number;
    tags?: string[];
}
/**
 * Create a new RAG source.
 * Returns a Source object with chunk_count = 0.
 */
export declare function createSource(projectId: string, title: string, metadata?: string): Source;
/**
 * Ingest chunks into a source.
 * Returns the number of chunks stored.
 */
export declare function ingestChunks(sourceId: string, chunks: Chunk[]): number;
/** Atomically replace a source's chunks and lifecycle state. No partially-indexed source is visible. */
export declare function replaceSourceContent(sourceId: string, content: string, options?: Pick<IngestSourceOptions, "priority" | "tags">): number;
/** Idempotently create or replace a canonical source. */
export declare function ingestCanonicalSource(projectId: string, title: string, content: string, options?: IngestSourceOptions): RagSource;
/**
 * BM25 full-text search across all sources in a project.
 */
export declare function searchChunks(projectId: string, query: string, limit?: number, includeGlobal?: boolean): RagSearchResult[];
/**
 * Delete a source and cascade-delete all chunks + FTS entries.
 */
export declare function deleteSource(sourceId: string): void;
/**
 * Full pipeline: chunk text, create source, ingest chunks.
 * Returns the updated Source (with chunk_count).
 */
export declare function ingestSource(projectId: string, name: string, content: string): Source;
/**
 * List all sources for a project.
 */
export declare function listSources(projectId: string, limit?: number, offset?: number): RagPage<RagSource>;
/** Index configured repository Markdown files without following symlinks outside the root. */
export declare function indexConfiguredDocs(globalProjectId: string, root?: string | undefined): {
    indexed: number;
    unchanged: number;
    deleted: number;
};
/** Keep a published Docs Workspace page synchronized at its lifecycle boundary. */
export declare function indexPublishedDoc(page: {
    id: number;
    title: string;
    slug: string;
    content: string;
    status: string;
}): void;
/**
 * Generate a deterministic 384-dimensional embedding vector.
 */
export declare function generateEmbedding(text: string): number[];
/**
 * Cosine similarity between two vectors.
 */
export declare function cosineSimilarity(a: number[], b: number[]): number;
/**
 * Store a chunk's embedding in the rag_embeddings table.
 */
export declare function updateChunkEmbedding(chunkId: number, embedding: number[], sourceId?: string): void;
/**
 * Hybrid search: fuses BM25 FTS scores with vector similarity.
 * Falls back to FTS-only when no embeddings are stored.
 */
export declare function hybridSearch(projectId: string, query: string): Array<{
    chunk_id: number;
    source_id: string;
    source_name: string;
    content: string;
    heading: string | null;
    fts_score: number;
    vector_score: number;
    combined_score: number;
    rank: number;
}>;
//# sourceMappingURL=rag.d.ts.map