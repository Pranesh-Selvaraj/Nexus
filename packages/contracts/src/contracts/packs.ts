import { z } from 'zod';
import { workspacePlanSchema } from './workspaces.js';

export const domainPackSchema = z.object({
  id: z.string(),
  name: z.string(),
  domain: z.string(),
  icon: z.string(),
  description: z.string(),
  personaId: z.string(),
  starterPrompts: z.array(z.string()).min(1),
  plan: workspacePlanSchema,
  /** Number of starter flashcards the pack installs. */
  cardCount: z.number().int().nonnegative(),
});
export type DomainPack = z.infer<typeof domainPackSchema>;

export const packsOverviewSchema = z.object({
  packs: z.array(domainPackSchema),
  /** packId -> the workspace it was installed into, for "Open" buttons. */
  installed: z.record(z.string(), z.string()),
});
export type PacksOverview = z.infer<typeof packsOverviewSchema>;

export const installPackInputSchema = z.object({
  packId: z.string().min(1).max(80),
  /** Optional custom topic name; defaults to the pack name. */
  name: z.string().trim().min(1).max(80).optional(),
});
