-- CTX-100: chunked uploads retain the same opaque source reference as direct uploads.
ALTER TABLE context_rag_upload_sessions ADD COLUMN source_reference TEXT CHECK(
  source_reference IS NULL OR length(source_reference) BETWEEN 1 AND 256
);

-- A context upload's source is append-only once its immutable upload record
-- exists, including through generic RAG routes that share rag_sources.
CREATE TRIGGER IF NOT EXISTS rag_sources_context_upload_immutable_update
BEFORE UPDATE ON rag_sources
WHEN EXISTS (
  SELECT 1 FROM context_rag_uploads upload
  WHERE upload.project_id = old.project_id AND upload.rag_source_id = old.id
)
BEGIN
  SELECT RAISE(ABORT, 'context upload RAG sources are immutable — UPDATE rejected');
END;

CREATE TRIGGER IF NOT EXISTS rag_sources_context_upload_immutable_delete
BEFORE DELETE ON rag_sources
WHEN EXISTS (
  SELECT 1 FROM context_rag_uploads upload
  WHERE upload.project_id = old.project_id AND upload.rag_source_id = old.id
)
BEGIN
  SELECT RAISE(ABORT, 'context upload RAG sources are immutable — DELETE rejected');
END;

CREATE TRIGGER IF NOT EXISTS rag_chunks_context_upload_immutable_insert
BEFORE INSERT ON rag_chunks
WHEN EXISTS (
  SELECT 1 FROM context_rag_uploads upload
  WHERE upload.rag_source_id = new.source_id
)
BEGIN
  SELECT RAISE(ABORT, 'context upload RAG chunks are immutable — INSERT rejected');
END;

CREATE TRIGGER IF NOT EXISTS rag_chunks_context_upload_immutable_update
BEFORE UPDATE ON rag_chunks
WHEN EXISTS (
  SELECT 1 FROM context_rag_uploads upload
  WHERE upload.rag_source_id = old.source_id OR upload.rag_source_id = new.source_id
)
BEGIN
  SELECT RAISE(ABORT, 'context upload RAG chunks are immutable — UPDATE rejected');
END;

CREATE TRIGGER IF NOT EXISTS rag_chunks_context_upload_immutable_delete
BEFORE DELETE ON rag_chunks
WHEN EXISTS (
  SELECT 1 FROM context_rag_uploads upload
  WHERE upload.rag_source_id = old.source_id
)
BEGIN
  SELECT RAISE(ABORT, 'context upload RAG chunks are immutable — DELETE rejected');
END;
