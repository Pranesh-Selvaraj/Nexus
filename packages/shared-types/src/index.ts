import { z } from 'zod';

// ---------------------------------------------------------------------------
// Users (single local user, no authentication)
// ---------------------------------------------------------------------------

export const userDTOSchema = z.object({
  id: z.string().uuid(),
  email: z.string().email(),
  name: z.string().nullable(),
});
export type UserDTO = z.infer<typeof userDTOSchema>;

// ---------------------------------------------------------------------------
// Workspaces
// ---------------------------------------------------------------------------

export const workspaceDTOSchema = z.object({
  id: z.string().uuid(),
  name: z.string(),
  description: z.string().nullable(),
  documentCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type WorkspaceDTO = z.infer<typeof workspaceDTOSchema>;

export const createWorkspaceInputSchema = z.object({
  name: z.string().trim().min(1).max(80),
  description: z.string().trim().max(240).optional(),
});
export type CreateWorkspaceInput = z.infer<typeof createWorkspaceInputSchema>;

export const updateWorkspaceInputSchema = z.object({
  workspaceId: z.string().uuid(),
  name: z.string().trim().min(1).max(80).optional(),
  description: z.string().trim().max(240).optional(),
});
export type UpdateWorkspaceInput = z.infer<typeof updateWorkspaceInputSchema>;

export const workspaceIdSchema = z.object({
  workspaceId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Documents
// ---------------------------------------------------------------------------

export const documentStatusSchema = z.enum(['processing', 'ready', 'failed']);
export type DocumentStatus = z.infer<typeof documentStatusSchema>;

export const documentDTOSchema = z.object({
  id: z.string().uuid(),
  workspaceId: z.string().uuid(),
  title: z.string(),
  fileType: z.string().nullable(),
  status: documentStatusSchema,
  chunkCount: z.number().int().nonnegative(),
  createdAt: z.string(),
});
export type DocumentDTO = z.infer<typeof documentDTOSchema>;

export const listDocumentsInputSchema = z.object({
  workspaceId: z.string().uuid(),
});

export const documentIdSchema = z.object({
  documentId: z.string().uuid(),
});

// ---------------------------------------------------------------------------
// Chat / RAG
// ---------------------------------------------------------------------------

export const chatRoleSchema = z.enum(['user', 'assistant']);
export type ChatRole = z.infer<typeof chatRoleSchema>;

export const chatHistoryMessageSchema = z.object({
  role: chatRoleSchema,
  content: z.string().min(1).max(8000),
});
export type ChatHistoryMessage = z.infer<typeof chatHistoryMessageSchema>;

export const chatStreamInputSchema = z.object({
  workspaceId: z.string().uuid(),
  message: z.string().min(1).max(4000),
  conversationId: z.string().uuid().optional(),
  history: z.array(chatHistoryMessageSchema).max(20).default([]),
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
  page: z.number().nullable(),
  similarity: z.number().min(0).max(1),
});
export type Source = z.infer<typeof sourceSchema>;

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
  content: z.string(),
  sources: z.array(sourceSchema).nullable(),
  usage: usageSchema.nullable(),
  createdAt: z.string(),
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
  }),
  z.object({
    type: z.literal('token'),
    token: z.string(),
  }),
  z.object({
    type: z.literal('done'),
    sources: z.array(sourceSchema),
  }),
  z.object({
    type: z.literal('error'),
    message: z.string(),
  }),
]);
export type ChatEvent = z.infer<typeof chatEventSchema>;

// ---------------------------------------------------------------------------
// Usage (token tracking)
// ---------------------------------------------------------------------------

// ---------------------------------------------------------------------------
// Workspace archive (export/import)
// ---------------------------------------------------------------------------

export const archiveMessageSchema = z.object({
  role: chatRoleSchema,
  content: z.string(),
  sources: z.array(sourceSchema).nullable(),
  usage: usageSchema.nullable(),
  createdAt: z.string(),
});

export const archiveConversationSchema = z.object({
  title: z.string(),
  messages: z.array(archiveMessageSchema),
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
