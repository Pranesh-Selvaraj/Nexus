-- R-17: approximate nearest-neighbour indexes for retrieval.
--
-- `chunks.embedding` is a dimensionless `vector` so different embedding models
-- (768/1024/1536/...) can share the column. pgvector can only build HNSW on a
-- fixed dimension, so this adds one partial HNSW index per supported dimension
-- over a cast expression. Retrieval pins the active dimension with a literal,
-- which lets the planner match the matching partial index.
--
-- The dimensions covered are the ones Nexus can be configured for out of the
-- box (OpenAI text-embedding-3 small/large, local bge/nomic/qwen models).
UPDATE "chunks"
SET "embedding_dims" = vector_dims("embedding")
WHERE "embedding_dims" IS NULL;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chunks_embedding_384_hnsw_idx" ON "chunks" USING hnsw ((embedding::vector(384)) vector_cosine_ops) WHERE embedding_dims = 384;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chunks_embedding_512_hnsw_idx" ON "chunks" USING hnsw ((embedding::vector(512)) vector_cosine_ops) WHERE embedding_dims = 512;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chunks_embedding_768_hnsw_idx" ON "chunks" USING hnsw ((embedding::vector(768)) vector_cosine_ops) WHERE embedding_dims = 768;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chunks_embedding_1024_hnsw_idx" ON "chunks" USING hnsw ((embedding::vector(1024)) vector_cosine_ops) WHERE embedding_dims = 1024;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chunks_embedding_1536_hnsw_idx" ON "chunks" USING hnsw ((embedding::vector(1536)) vector_cosine_ops) WHERE embedding_dims = 1536;--> statement-breakpoint
-- HNSW on `vector` supports at most 2000 dimensions, so the two large-dimension
-- models use halfvec (max 4000) instead. Retrieval picks the same cast.
CREATE INDEX IF NOT EXISTS "chunks_embedding_2048_hnsw_idx" ON "chunks" USING hnsw ((embedding::halfvec(2048)) halfvec_cosine_ops) WHERE embedding_dims = 2048;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chunks_embedding_3072_hnsw_idx" ON "chunks" USING hnsw ((embedding::halfvec(3072)) halfvec_cosine_ops) WHERE embedding_dims = 3072;
