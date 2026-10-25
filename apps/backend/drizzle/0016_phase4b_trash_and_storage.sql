ALTER TYPE "public"."document_status" ADD VALUE 'deleted';--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "size_bytes" bigint DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "deleted_at" timestamp with time zone;