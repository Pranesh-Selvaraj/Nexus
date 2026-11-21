import { z } from 'zod';
import { chatRoleSchema, messageKindSchema, sourceSchema } from './chat.js';

export const retrievalProfileSchema = z.enum(['fast', 'balanced', 'thorough']);
export type RetrievalProfile = z.infer<typeof retrievalProfileSchema>;

export const retrievalCandidateSchema = z.object({
  id: z.string(),
  documentId: z.string(),
  title: z.string(),
  page: z.number().nullable(),
  headingPath: z.array(z.string()).nullable().optional(),
  vectorScore: z.number(),
  keywordScore: z.number(),
  fusedScore: z.number(),
  /** 1-based position in the fused ordering before reranking. */
  rank: z.number().int(),
  /** Final position after reranking, when reranking ran. */
  rerankedRank: z.number().int().nullable().optional(),
  selected: z.boolean(),
  contentPreview: z.string(),
});
export type RetrievalCandidate = z.infer<typeof retrievalCandidateSchema>;

export const retrievalDebugSchema = z.object({
  profile: retrievalProfileSchema,
  originalQuery: z.string(),
  searchQuery: z.string(),
  rewritten: z.boolean(),
  reranked: z.boolean(),
  vectorCandidates: z.number().int(),
  keywordCandidates: z.number().int(),
  minScore: z.number(),
  tokenBudget: z.number().int(),
  usedTokens: z.number().int(),
  candidates: z.array(retrievalCandidateSchema),
});
export type RetrievalDebug = z.infer<typeof retrievalDebugSchema>;

export const usageSchema = z.object({
  promptTokens: z.number().int().nonnegative(),
  completionTokens: z.number().int().nonnegative(),
  totalTokens: z.number().int().nonnegative(),
});
export type Usage = z.infer<typeof usageSchema>;

export const messageDTOSchema = z.object({
  id: z.string().uuid(),
  conversationId: z.string().uuid(),
  role: chatRoleSchema,
  kind: messageKindSchema,
  content: z.string(),
  sources: z.array(sourceSchema).nullable(),
  /** Images attached to a user turn (vision chat). */
  attachments: z
    .object({ imageDocumentIds: z.array(z.string().uuid()) })
    .nullable()
    .optional(),
  usage: usageSchema.nullable(),
  feedback: z.enum(['up', 'down']).nullable(),
  retrievalDebug: retrievalDebugSchema.nullable().optional(),
  createdAt: z.string(),
});

export const chatFeedbackInputSchema = z.object({
  messageId: z.string().uuid(),
  feedback: z.enum(['up', 'down']).nullable(),
});
export type MessageDTO = z.infer<typeof messageDTOSchema>;

export const chatEventSchema = z.discriminatedUnion('type', [
  z.object({
    type: z.literal('conversation'),
    conversationId: z.string().uuid(),
  }),
  z.object({
    type: z.literal('sources'),
    sources: z.array(sourceSchema),
    /** The query actually used for retrieval (may be rewritten). */
    query: z.string(),
    /** Inspector payload (candidates, scores, profile, budget). */
    retrieval: retrievalDebugSchema.optional(),
  }),
  z.object({
    type: z.literal('token'),
    token: z.string(),
  }),
  z.object({
    type: z.literal('done'),
    sources: z.array(sourceSchema),
    /** Persisted assistant message id (client replaces its optimistic id). */
    messageId: z.string().uuid(),
  }),
  z.object({
    type: z.literal('error'),
    message: z.string(),
  }),
]);
export type ChatEvent = z.infer<typeof chatEventSchema>;
