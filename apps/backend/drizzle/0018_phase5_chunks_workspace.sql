-- R-17: denormalise the workspace onto chunks.
--
-- Retrieval filters by workspace and orders by embedding distance. With the
-- workspace only on `documents`, the planner has to join before it can filter,
-- which makes the HNSW index unusable for the common query. `chunks.workspace_id`
-- lets the ANN scan apply the workspace predicate directly, and gives the
-- keyword arm the same benefit. Written idempotently so an installation that
-- already backfilled (or a retried migration) is safe.
ALTER TABLE "chunks" ADD COLUMN IF NOT EXISTS "workspace_id" uuid;--> statement-breakpoint
UPDATE "chunks" c
SET "workspace_id" = d."workspace_id"
FROM "documents" d
WHERE d."id" = c."document_id" AND c."workspace_id" IS NULL;--> statement-breakpoint
ALTER TABLE "chunks" ALTER COLUMN "workspace_id" SET NOT NULL;--> statement-breakpoint
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'chunks_workspace_id_workspaces_id_fk'
  ) THEN
    ALTER TABLE "chunks"
      ADD CONSTRAINT "chunks_workspace_id_workspaces_id_fk"
      FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id")
      ON DELETE cascade ON UPDATE no action;
  END IF;
END $$;--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "chunks_workspace_id_idx" ON "chunks" USING btree ("workspace_id");--> statement-breakpoint
-- ANN with a filter: let pgvector keep scanning the graph when the workspace
-- filter removes candidates, instead of silently returning fewer rows. The
-- database name is resolved at runtime, and older pgvector versions without
-- the setting (pre-0.8) are skipped instead of failing the migration.
DO $$
BEGIN
  EXECUTE format(
    'ALTER DATABASE %I SET hnsw.iterative_scan = relaxed_order',
    current_database()
  );
EXCEPTION WHEN others THEN
  RAISE NOTICE 'hnsw.iterative_scan is not supported by this pgvector version; skipping';
END $$;
