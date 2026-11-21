import { z } from 'zod';
export const chatRoleSchema = z.enum(['user', 'assistant']);
export type ChatRole = z.infer<typeof chatRoleSchema>;

export const messageKindSchema = z.enum(['answer', 'error']);
export type MessageKind = z.infer<typeof messageKindSchema>;

export const chatHistoryMessageSchema = z.object({
  role: chatRoleSchema,
  content: z.string().min(1).max(8000),
});
export type ChatHistoryMessage = z.infer<typeof chatHistoryMessageSchema>;

export const chatStreamInputSchema = z.object({
  workspaceId: z.string().uuid(),
  message: z.string().min(1).max(4000),
  conversationId: z.string().uuid().optional(),
  // Kept for backward compatibility; the server now builds history from the
  // persisted conversation so client-supplied turns can never be trusted.
  history: z.array(chatHistoryMessageSchema).max(20).default([]),
  /** Re-answer the last user message without inserting a duplicate turn. */
  regenerate: z.boolean().optional(),
  /** Tutor persona id (see chat.personas); falls back to the setting. */
  persona: z.string().max(40).optional(),
  /** Image documents attached to this turn (vision chat). */
  imageDocumentIds: z.array(z.string().uuid()).max(4).optional(),
  /** Instruction preset used when images are attached. */
  visionMode: z.enum(['general', 'art', 'diagram', 'equation']).optional(),
});
export type ChatStreamInput = z.infer<typeof chatStreamInputSchema>;

export const conversationIdSchema = z.object({
  conversationId: z.string().uuid(),
});

export const conversationDTOSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  title: z.string(),
  messageCount: z.number().int().nonnegative(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type ConversationDTO = z.infer<typeof conversationDTOSchema>;

export const sourceSchema = z.object({
  id: z.string().uuid(),
  documentId: z.string().uuid(),
  title: z.string(),
  content: z.string(),
  /** Detected format of the source document (image/pdf/epub/...). */
  fileType: z.string().nullable().optional(),
  /** True when this source came from an image attached to the question. */
  attached: z.boolean().optional(),
  page: z.number().nullable(),
  pageEnd: z.number().nullable().optional(),
  headingPath: z.array(z.string()).nullable().optional(),
  /** Displayed relevance (vector cosine similarity, 0..1). */
  similarity: z.number().min(0).max(1),
  /** Raw vector similarity before fusion. */
  vectorScore: z.number().min(0).max(1).optional(),
  /** Keyword (full-text rank) contribution, normalized to 0..1. */
  keywordScore: z.number().min(0).optional(),
  /** Reciprocal-rank-fusion score used for ordering. */
  fusedScore: z.number().min(0).optional(),
  /** True when the final answer cited this source by number. */
  cited: z.boolean().optional(),
});
export type Source = z.infer<typeof sourceSchema>;
