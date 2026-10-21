CREATE TABLE "audio_assets" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid,
	"kind" text NOT NULL,
	"cache_key" text,
	"voice" text,
	"speed" real,
	"mime_type" text NOT NULL,
	"format" text DEFAULT 'mp3' NOT NULL,
	"size_bytes" integer DEFAULT 0 NOT NULL,
	"duration_ms" integer,
	"file_path" text NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL,
	"expires_at" timestamp with time zone,
	CONSTRAINT "audio_assets_cache_key_unique" UNIQUE("cache_key")
);
--> statement-breakpoint
CREATE TABLE "cefr_estimates" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"skill" text NOT NULL,
	"level" text NOT NULL,
	"score" real DEFAULT 0 NOT NULL,
	"evidence" integer DEFAULT 0 NOT NULL,
	"updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "pronunciation_attempts" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"user_id" uuid NOT NULL,
	"workspace_id" uuid,
	"target" text NOT NULL,
	"transcript" text NOT NULL,
	"overall" real NOT NULL,
	"words" jsonb,
	"language" text,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
CREATE TABLE "vocabulary_items" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"workspace_id" uuid NOT NULL,
	"term" text NOT NULL,
	"lemma" text NOT NULL,
	"language" text DEFAULT '' NOT NULL,
	"translation" text,
	"part_of_speech" text,
	"example" text,
	"frequency_rank" integer,
	"state" text DEFAULT 'learning' NOT NULL,
	"card_id" uuid,
	"source_chunk_id" uuid,
	"source_message_id" uuid,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "audio_assets" ADD CONSTRAINT "audio_assets_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "audio_assets" ADD CONSTRAINT "audio_assets_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "cefr_estimates" ADD CONSTRAINT "cefr_estimates_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pronunciation_attempts" ADD CONSTRAINT "pronunciation_attempts_user_id_users_id_fk" FOREIGN KEY ("user_id") REFERENCES "public"."users"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "pronunciation_attempts" ADD CONSTRAINT "pronunciation_attempts_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary_items" ADD CONSTRAINT "vocabulary_items_workspace_id_workspaces_id_fk" FOREIGN KEY ("workspace_id") REFERENCES "public"."workspaces"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary_items" ADD CONSTRAINT "vocabulary_items_card_id_flashcards_id_fk" FOREIGN KEY ("card_id") REFERENCES "public"."flashcards"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary_items" ADD CONSTRAINT "vocabulary_items_source_chunk_id_chunks_id_fk" FOREIGN KEY ("source_chunk_id") REFERENCES "public"."chunks"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "vocabulary_items" ADD CONSTRAINT "vocabulary_items_source_message_id_messages_id_fk" FOREIGN KEY ("source_message_id") REFERENCES "public"."messages"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "audio_assets_user_id_idx" ON "audio_assets" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "audio_assets_expires_at_idx" ON "audio_assets" USING btree ("expires_at");--> statement-breakpoint
CREATE INDEX "cefr_estimates_workspace_id_idx" ON "cefr_estimates" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "cefr_estimates_workspace_skill_idx" ON "cefr_estimates" USING btree ("workspace_id","skill");--> statement-breakpoint
CREATE INDEX "pronunciation_attempts_user_id_idx" ON "pronunciation_attempts" USING btree ("user_id");--> statement-breakpoint
CREATE INDEX "pronunciation_attempts_workspace_id_idx" ON "pronunciation_attempts" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "vocabulary_items_workspace_id_idx" ON "vocabulary_items" USING btree ("workspace_id");--> statement-breakpoint
CREATE INDEX "vocabulary_items_lemma_idx" ON "vocabulary_items" USING btree ("workspace_id","lemma");