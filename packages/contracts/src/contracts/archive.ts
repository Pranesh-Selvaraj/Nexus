import { z } from 'zod';
import { chatRoleSchema, sourceSchema } from './chat.js';
import { usageSchema } from './retrieval.js';

export const archiveMessageSchema = z.object({
  role: chatRoleSchema,
  content: z.string(),
  sources: z.array(sourceSchema).nullable(),
  usage: usageSchema.nullable(),
  feedback: z.enum(['up', 'down']).nullable().optional(),
  createdAt: z.string(),
});

export const archiveConversationSchema = z.object({
  title: z.string(),
  messages: z.array(archiveMessageSchema),
});

export const archiveDeckSchema = z.object({
  name: z.string(),
  cards: z.array(
    z.object({
      front: z.string(),
      back: z.string(),
      dueAt: z.string(),
      state: z.number().int(),
      reps: z.number().int(),
      lapses: z.number().int(),
    }),
  ),
});

export const archiveDocumentSchema = z.object({
  title: z.string(),
  fileType: z.string().nullable(),
  contentBase64: z.string(),
});

export const workspaceArchiveSchema = z.object({
  version: z.literal(1),
  exportedAt: z.string(),
  workspace: z.object({
    name: z.string(),
    description: z.string().nullable(),
  }),
  documents: z.array(archiveDocumentSchema),
  conversations: z.array(archiveConversationSchema),
});
export type WorkspaceArchive = z.infer<typeof workspaceArchiveSchema>;
