-- An HNSW index binds the column to its original dimension (1536) and
-- pgvector enforces that dimension on inserts even after the ALTER.
-- Drop it: dynamic-dimension embeddings (local models) require exact scans,
-- which is fine at personal-corpus scale.
DROP INDEX IF EXISTS "chunks_embedding_hnsw_idx";
ALTER TABLE "chunks" ALTER COLUMN "embedding" SET DATA TYPE vector;