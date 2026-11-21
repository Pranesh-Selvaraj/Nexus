import { z } from 'zod';
import { sourceSchema } from './chat.js';
import { documentDTOSchema } from './documents.js';

export const shareLinkDTOSchema = z.object({
  id: z.string().uuid(),
  label: z.string().nullable(),
  createdAt: z.string(),
  expiresAt: z.string().nullable(),
  revokedAt: z.string().nullable(),
  active: z.boolean(),
});
export type ShareLinkDTO = z.infer<typeof shareLinkDTOSchema>;

export const createdShareLinkSchema = shareLinkDTOSchema.extend({
  /** Full URL including the token. Returned exactly once at creation. */
  url: z.string(),
});
export type CreatedShareLink = z.infer<typeof createdShareLinkSchema>;

export const createShareLinkInputSchema = z.object({
  workspaceId: z.string().uuid(),
  label: z.string().trim().max(80).optional(),
  /** 0/omitted = no expiry. */
  expiresInDays: z.number().int().min(0).max(365).optional(),
});
export type CreateShareLinkInput = z.infer<typeof createShareLinkInputSchema>;

export const shareLinkIdSchema = z.object({ id: z.string().uuid() });

export const sharedWorkspaceSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  createdAt: z.string(),
  documents: z.array(documentDTOSchema),
});
export type SharedWorkspace = z.infer<typeof sharedWorkspaceSchema>;

export const shareAskInputSchema = z.object({
  question: z.string().trim().min(1).max(4000),
});
export type ShareAskInput = z.infer<typeof shareAskInputSchema>;

export const shareAskResultSchema = z.object({
  answer: z.string(),
  sources: z.array(sourceSchema),
  query: z.string(),
});
export type ShareAskResult = z.infer<typeof shareAskResultSchema>;
