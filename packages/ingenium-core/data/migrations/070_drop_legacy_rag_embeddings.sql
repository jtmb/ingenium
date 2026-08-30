-- Deterministic embeddings were never part of canonical RAG retrieval.
-- FTS-backed rag_sources and rag_chunks remain the active corpus contract.
DROP TABLE IF EXISTS rag_embeddings;
