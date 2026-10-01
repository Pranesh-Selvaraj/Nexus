CREATE TYPE "public"."message_kind" AS ENUM('answer', 'error');--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "error_message" text;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "attempts" integer DEFAULT 0 NOT NULL;--> statement-breakpoint
ALTER TABLE "documents" ADD COLUMN "updated_at" timestamp with time zone DEFAULT now() NOT NULL;--> statement-breakpoint
ALTER TABLE "messages" ADD COLUMN "kind" "message_kind" DEFAULT 'answer' NOT NULL;