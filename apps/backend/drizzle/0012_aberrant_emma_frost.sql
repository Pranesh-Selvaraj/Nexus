DROP INDEX "vocabulary_items_lemma_idx";--> statement-breakpoint
DROP INDEX "cefr_estimates_workspace_skill_idx";--> statement-breakpoint
CREATE UNIQUE INDEX "vocabulary_items_workspace_lemma_language_idx" ON "vocabulary_items" USING btree ("workspace_id","lemma","language");--> statement-breakpoint
CREATE UNIQUE INDEX "cefr_estimates_workspace_skill_idx" ON "cefr_estimates" USING btree ("workspace_id","skill");