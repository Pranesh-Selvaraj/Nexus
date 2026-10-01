ALTER TABLE "chunks" ADD COLUMN "embedding_model" text;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "embedding_dims" integer;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "embedding_version" integer;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "content_hash" text;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "token_count" integer;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "language" text;--> statement-breakpoint
ALTER TABLE "chunks" ADD COLUMN "content_fts" "tsvector";--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "feedback" text;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "retrieval_debug" jsonb;--> statement-breakpoint
CREATE INDEX "chunks_embedding_model_idx" ON "chunks" USING btree ("embedding_model");--> statement-breakpoint
-- The 0000 migration created an English-only expression index under this
-- name (never declared in schema.ts). It cannot serve other languages and
-- is replaced by the language-agnostic index on the populated column.
DROP INDEX IF EXISTS "chunks_content_fts_idx";--> statement-breakpoint
CREATE INDEX "chunks_content_fts_idx" ON "chunks" USING gin ("content_fts");--> statement-breakpoint
-- Backfill full-text vectors and language for chunks indexed before this
-- migration. The configured search language is read from settings when
-- present (the app writes it there), falling back to English. Existing
-- chunks keep embedding_model = NULL and are matched by vector dimension
-- until they are re-indexed, so retrieval keeps working.
UPDATE "chunks" SET
  "content_fts" = to_tsvector(
    COALESCE((SELECT "value" FROM "settings" WHERE "key" = 'retrieval.language'), 'english')::regconfig,
    "content"
  ),
  "language" = COALESCE((SELECT "value" FROM "settings" WHERE "key" = 'retrieval.language'), 'english'),
  "token_count" = GREATEST(1, CEIL(LENGTH("content")::numeric / 4)::int)
WHERE "content_fts" IS NULL;
